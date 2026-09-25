import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { NotFoundError, ValidationError } from "@/lib/http/errors";
import { invalidatePropertySearchCache } from "@/lib/search";
import { diffDays, nightsBetween, parseIsoDate, toDbDate, addDays } from "@/lib/time/nights";
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
  const room = await prisma.room.findUnique({
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

export const roomSchema = z.object({
  name: z.string().trim().min(1).max(80),
  capacity: z.number().int().min(1).max(20),
  bedType: z.string().trim().min(1).max(60),
  priceModifier: z.number().min(0).max(1_000_000).default(0),
  description: z.string().max(1000).optional(),
});

export async function addRoom(
  actor: AccessClaims,
  propertyId: string,
  input: z.infer<typeof roomSchema>
) {
  await assertPropertyAccess(actor, propertyId);
  return prisma.room.create({
    data: { ...input, propertyId, priceModifier: new Prisma.Decimal(input.priceModifier) },
  });
}

export async function updateRoom(
  actor: AccessClaims,
  roomId: string,
  input: Partial<z.infer<typeof roomSchema>> & { available?: boolean }
) {
  await assertRoomAccess(actor, roomId);
  return prisma.room.update({
    where: { id: roomId },
    data: {
      ...input,
      priceModifier:
        input.priceModifier !== undefined ? new Prisma.Decimal(input.priceModifier) : undefined,
    },
  });
}

export const ariSchema = z
  .object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    price: z.number().positive().max(1_000_000).optional(),
    isAvailable: z.boolean().optional(),
  })
  .refine(
    (v) => v.price !== undefined || v.isAvailable !== undefined,
    "price veya isAvailable gerekli"
  );

/**
 * Toplu ARI güncellemesi (≤ 365 gece). Aktif HELD/CONFIRMED rezervasyonların kilitlediği
 * geceler ASLA ezilmez (atlanır ve sayısı döner).
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

  return prisma.$transaction(async (tx) => {
    const locked = await tx.availability.count({
      where: { roomId, date: { gte: toDbDate(from), lte: toDbDate(to) }, lockedBy: { not: null } },
    });
    const data: Prisma.AvailabilityUpdateManyMutationInput = {};
    if (input.price !== undefined) data.price = new Prisma.Decimal(input.price);
    if (input.isAvailable !== undefined) data.isAvailable = input.isAvailable;
    const updated = await tx.availability.updateMany({
      where: { roomId, date: { gte: toDbDate(from), lte: toDbDate(to) }, lockedBy: null },
      data,
    });
    // Eksik geceler yalnızca fiyat verildiyse oluşturulur (fiyatsız envanter satırı yok).
    const created =
      input.price === undefined
        ? { count: 0 }
        : await tx.availability.createMany({
            data: nights.map((d) => ({
              roomId,
              date: toDbDate(d),
              price: new Prisma.Decimal(input.price!),
              isAvailable: input.isAvailable ?? true,
            })),
            skipDuplicates: true,
          });
    await invalidatePropertySearchCache(room.propertyId);
    return { updated: updated.count, created: created.count, skippedLocked: locked };
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
      rooms: { select: { id: true, name: true, capacity: true, available: true } },
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
