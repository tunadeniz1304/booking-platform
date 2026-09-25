import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { NotFoundError, ValidationError } from "@/lib/http/errors";
import { invalidatePropertySearchCache } from "@/lib/search";
import {
  diffDays,
  fromDate,
  nightsBetween,
  parseIsoDate,
  toDbDate,
  addDays,
} from "@/lib/time/nights";
import type { AccessClaims } from "@/lib/auth";

/**
 * Host extranet (P1-7). Tüm işlemler sahiplik kontrollüdür: HOST yalnızca kendi
 * mülklerini görür/düzenler (başkasınınki 404 — varlık sızdırılmaz), ADMIN hepsini.
 */

/** Turizm İşletme Belgesi / 7464 izin no: il plaka kodu + sıra (+ opsiyonel yıl). */
export const LICENSE_RE = /^(0[1-9]|[1-7]\d|8[01])-\d{3,6}(-\d{4})?$/;
export const licenseSchema = z
  .string()
  .trim()
  .regex(LICENSE_RE, "Geçersiz belge numarası (ör. 34-12345)");

export async function assertPropertyAccess(actor: AccessClaims, propertyId: string) {
  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    select: { id: true, hostId: true, licenseNumber: true },
  });
  if (!property || (actor.role !== "ADMIN" && property.hostId !== actor.userId)) {
    throw new NotFoundError("Mülk bulunamadı");
  }
  return property;
}

export async function assertRoomAccess(actor: AccessClaims, roomId: string) {
  const room = await prisma.roomType.findUnique({
    where: { id: roomId },
    select: { id: true, propertyId: true, property: { select: { hostId: true } } },
  });
  if (!room || (actor.role !== "ADMIN" && room.property.hostId !== actor.userId)) {
    throw new NotFoundError("Oda bulunamadı");
  }
  return room;
}

export const propertyPatchSchema = z
  .object({
    title: z.string().trim().min(2).max(120),
    description: z.string().trim().min(10).max(5000),
    basePrice: z.number().positive().max(1_000_000),
    licenseNumber: licenseSchema,
    isActive: z.boolean(),
    cancellationPolicyId: z.string().max(64),
  })
  .partial();

export async function updateProperty(
  actor: AccessClaims,
  propertyId: string,
  patch: z.infer<typeof propertyPatchSchema>
) {
  const property = await assertPropertyAccess(actor, propertyId);
  const license = patch.licenseNumber ?? property.licenseNumber;
  if (patch.isActive && !license) {
    throw new ValidationError("Belge numarası olmadan ilan yayınlanamaz");
  }
  // v3#8: var olmayan politika kimliği FK hatasıyla 500 değil, 400 döner.
  if (
    patch.cancellationPolicyId &&
    !(await prisma.cancellationPolicy.findUnique({
      where: { id: patch.cancellationPolicyId },
      select: { id: true },
    }))
  ) {
    throw new ValidationError("İptal politikası bulunamadı");
  }
  const updated = await prisma.property.update({
    where: { id: propertyId },
    data: {
      ...patch,
      basePrice: patch.basePrice !== undefined ? new Prisma.Decimal(patch.basePrice) : undefined,
    },
    select: { id: true, title: true, isActive: true, licenseNumber: true, basePrice: true },
  });
  await invalidatePropertySearchCache(propertyId);
  return updated;
}

/**
 * Oda tipi girdisi. `capacity` bir sürüm boyunca `maxOccupancy`'nin eşanlamlısı olarak
 * kabul edilir (geriye uyum, ADR 0010). `units`: bu tipten kaç oda satılabilir.
 */
export const roomSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    maxOccupancy: z.number().int().min(1).max(20).optional(),
    capacity: z.number().int().min(1).max(20).optional(),
    units: z.number().int().min(1).max(500).default(1),
    bedType: z.string().trim().min(1).max(60),
    priceModifier: z.number().min(0).max(1_000_000).default(0),
    description: z.string().max(1000).optional(),
  })
  .refine((v) => v.maxOccupancy !== undefined || v.capacity !== undefined, {
    message: "maxOccupancy (veya capacity) gerekli",
    path: ["maxOccupancy"],
  })
  .transform(({ capacity, maxOccupancy, ...rest }) => ({
    ...rest,
    maxOccupancy: (maxOccupancy ?? capacity) as number,
  }));

export const roomPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    maxOccupancy: z.number().int().min(1).max(20),
    capacity: z.number().int().min(1).max(20),
    units: z.number().int().min(0).max(500),
    bedType: z.string().trim().min(1).max(60),
    priceModifier: z.number().min(0).max(1_000_000),
    description: z.string().max(1000),
    available: z.boolean(),
  })
  .partial()
  .transform(({ capacity, maxOccupancy, ...rest }) => ({
    ...rest,
    ...((maxOccupancy ?? capacity) ? { maxOccupancy: (maxOccupancy ?? capacity) as number } : {}),
  }));

/** Varsayılan fiyat planları: standart (iade edilebilir) ve iade edilemez (−%10). */
export const DEFAULT_RATE_PLANS = [
  { code: "STANDARD", name: "Standart", refundable: true, priceModifierBps: 0, isDefault: true },
  {
    code: "NONREF",
    name: "İade edilemez",
    refundable: false,
    priceModifierBps: -1000,
    isDefault: false,
  },
] as const;

export async function addRoom(
  actor: AccessClaims,
  propertyId: string,
  input: z.infer<typeof roomSchema>
) {
  await assertPropertyAccess(actor, propertyId);
  const room = await prisma.roomType.create({
    data: {
      ...input,
      propertyId,
      priceModifier: new Prisma.Decimal(input.priceModifier),
      ratePlans: { create: DEFAULT_RATE_PLANS.map((p) => ({ ...p })) },
    },
  });
  await invalidatePropertySearchCache(propertyId);
  return room;
}

/**
 * Oda tipi güncelleme. `units` değişirse gelecekteki `InventoryDay.total` güncellenir; satılmış +
 * tutulmuş odaların altına inilemez (CHECK kısıtı) — o geceler olduğu gibi bırakılır ve sayısı döner.
 */
export async function updateRoom(
  actor: AccessClaims,
  roomId: string,
  input: z.infer<typeof roomPatchSchema>
) {
  const access = await assertRoomAccess(actor, roomId);
  const { units, ...rest } = input;
  const room = await prisma.$transaction(async (tx) => {
    const updated = await tx.roomType.update({
      where: { id: roomId },
      data: {
        ...rest,
        ...(units !== undefined ? { units } : {}),
        priceModifier:
          rest.priceModifier !== undefined ? new Prisma.Decimal(rest.priceModifier) : undefined,
      },
    });
    let skipped = 0;
    if (units !== undefined) {
      const today = toDbDate(fromDate(new Date()));
      const applied = await tx.$executeRaw`
        UPDATE "InventoryDay" SET total = ${units}
        WHERE "roomTypeId" = ${roomId} AND date >= ${today} AND sold + held <= ${units}`;
      const all = await tx.inventoryDay.count({
        where: { roomTypeId: roomId, date: { gte: today } },
      });
      skipped = all - applied;
    }
    return { ...updated, skippedNights: skipped };
  });
  await invalidatePropertySearchCache(access.propertyId);
  return room;
}

export const ariSchema = z
  .object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    price: z.number().positive().max(1_000_000).optional(),
    /** false → satış durdurma (stop-sell); true → satışa aç. */
    isAvailable: z.boolean().optional(),
    /** Gecelik satılabilir oda (allotment); satılmış + tutulmuşun altına inilemez. */
    total: z.number().int().min(0).max(500).optional(),
    minStay: z.number().int().min(1).max(60).nullable().optional(),
    maxStay: z.number().int().min(1).max(365).nullable().optional(),
    closedToArrival: z.boolean().optional(),
    closedToDeparture: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.price !== undefined ||
      v.isAvailable !== undefined ||
      v.total !== undefined ||
      v.minStay !== undefined ||
      v.maxStay !== undefined ||
      v.closedToArrival !== undefined ||
      v.closedToDeparture !== undefined,
    "En az bir alan (price, isAvailable, total, minStay, maxStay, closedToArrival/Departure) gerekli"
  );

/**
 * Toplu ARI güncellemesi (≤ 365 gece): fiyat, allotment (`total`) ve satış kısıtları.
 * Satılmış + tutulmuş odaların altına `total` indirilmez (o geceler atlanır ve sayısı döner);
 * mevcut rezervasyonlar hiçbir koşulda etkilenmez.
 */
export async function bulkUpdateAvailability(
  actor: AccessClaims,
  roomId: string,
  input: z.infer<typeof ariSchema>
) {
  const room = await assertRoomAccess(actor, roomId);
  const from = parseIsoDate(input.from);
  const to = parseIsoDate(input.to);
  const span = diffDays(from, to) + 1;
  if (span < 1 || span > 365) throw new ValidationError("Tarih aralığı 1–365 gece olmalı");
  const nights = nightsBetween(from, addDays(to, 1));
  const units = (
    await prisma.roomType.findUniqueOrThrow({ where: { id: roomId }, select: { units: true } })
  ).units;

  return prisma.$transaction(async (tx) => {
    const range = { gte: toDbDate(from), lte: toDbDate(to) };
    let updated = 0;
    let skippedLocked = 0;
    if (input.price !== undefined) {
      const r = await tx.inventoryDay.updateMany({
        where: { roomTypeId: roomId, date: range },
        data: { price: new Prisma.Decimal(input.price) },
      });
      updated = Math.max(updated, r.count);
    }
    if (input.total !== undefined) {
      const applied = await tx.$executeRaw`
        UPDATE "InventoryDay" SET total = ${input.total}
        WHERE "roomTypeId" = ${roomId} AND date >= ${range.gte} AND date <= ${range.lte}
          AND sold + held <= ${input.total}`;
      const all = await tx.inventoryDay.count({ where: { roomTypeId: roomId, date: range } });
      skippedLocked = all - applied;
      updated = Math.max(updated, applied);
    }
    // Eksik geceler yalnızca fiyat verildiyse oluşturulur (fiyatsız envanter satırı yok).
    const created =
      input.price === undefined
        ? { count: 0 }
        : await tx.inventoryDay.createMany({
            data: nights.map((d) => ({
              roomTypeId: roomId,
              date: toDbDate(d),
              price: new Prisma.Decimal(input.price!),
              total: input.total ?? units,
            })),
            skipDuplicates: true,
          });
    const restriction: Prisma.RestrictionUpdateInput = {};
    if (input.isAvailable !== undefined) restriction.stopSell = !input.isAvailable;
    if (input.minStay !== undefined) restriction.minStay = input.minStay;
    if (input.maxStay !== undefined) restriction.maxStay = input.maxStay;
    if (input.closedToArrival !== undefined) restriction.closedToArrival = input.closedToArrival;
    if (input.closedToDeparture !== undefined) {
      restriction.closedToDeparture = input.closedToDeparture;
    }
    if (Object.keys(restriction).length > 0) {
      for (const d of nights) {
        await tx.restriction.upsert({
          where: { roomTypeId_date: { roomTypeId: roomId, date: toDbDate(d) } },
          update: restriction,
          create: {
            roomTypeId: roomId,
            date: toDbDate(d),
            ...(restriction as Omit<Prisma.RestrictionCreateInput, "roomType" | "date">),
          },
        });
      }
      updated = Math.max(updated, nights.length);
    }
    await invalidatePropertySearchCache(room.propertyId);
    return { updated, created: created.count, skippedLocked };
  });
}

export async function listHostProperties(actor: AccessClaims) {
  return prisma.property.findMany({
    where: actor.role === "ADMIN" ? {} : { hostId: actor.userId },
    select: {
      id: true,
      title: true,
      description: true,
      isActive: true,
      licenseNumber: true,
      basePrice: true,
      currency: true,
      ratingAvg: true,
      rooms: {
        select: { id: true, name: true, maxOccupancy: true, units: true, available: true },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

export async function listHostBookings(actor: AccessClaims) {
  return prisma.booking.findMany({
    where: actor.role === "ADMIN" ? {} : { property: { hostId: actor.userId } },
    select: {
      id: true,
      status: true,
      checkIn: true,
      checkOut: true,
      totalPrice: true,
      currency: true,
      propertyId: true,
      roomId: true,
      guestCount: true,
    },
    orderBy: { checkIn: "asc" },
    take: 200,
  });
}
