import { Prisma, type PrismaClient } from "@prisma/client";
import { createBooking } from "@/lib/booking-service";
import { iso, utcDay } from "./helpers";

/**
 * Entegrasyon testleri için ortak konaklama kurulumu: kullanıcı + mülk + oda + N günlük
 * envanter. Envanter modeli tek yerde kurulur (testler şema ayrıntısını bilmez).
 */
export interface StayFixture {
  userId: string;
  hostId: string;
  propertyId: string;
  roomId: string;
  /** Sıradaki boş tarihlerde HELD rezervasyon oluşturur. */
  hold(opts?: { nights?: number; userId?: string; startInDays?: number }): Promise<{
    id: string;
    totalMinor: number;
    checkIn: string;
    checkOut: string;
  }>;
}

export async function createStayFixture(
  prisma: PrismaClient,
  opts: {
    tag: string;
    nightlyPrice?: number;
    days?: number;
    policyId?: string;
    capacity?: number;
    /** Oda tipi adedi (varsayılan 1). */
    units?: number;
    country?: string;
    timeZone?: string;
  }
): Promise<StayFixture> {
  const stamp = `${opts.tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const user = await prisma.user.create({
    data: {
      email: `u-${stamp}@t.test`,
      passwordHash: "x",
      firstName: "Test",
      lastName: "Kullanıcı",
    },
  });
  const host = await prisma.user.create({
    data: {
      email: `h-${stamp}@t.test`,
      passwordHash: "x",
      firstName: "Host",
      lastName: "Test",
      role: "HOST",
    },
  });
  const location = await prisma.location.create({
    data: { city: `City-${stamp}`, country: opts.country ?? "TEST" },
  });
  const price = new Prisma.Decimal(opts.nightlyPrice ?? 1000);
  const property = await prisma.property.create({
    data: {
      licenseStatus: "VERIFIED",
      hostId: host.id,
      title: `Otel ${stamp}`,
      description: "entegrasyon testi",
      propertyType: "HOTEL",
      locationId: location.id,
      basePrice: price,
      cancellationPolicyId: opts.policyId ?? "policy_moderate_v1",
      ...(opts.timeZone ? { timeZone: opts.timeZone } : {}),
    },
  });
  const units = opts.units ?? 1;
  const room = await prisma.roomType.create({
    data: {
      propertyId: property.id,
      name: "Oda",
      maxOccupancy: opts.capacity ?? 2,
      units,
      bedType: "Çift",
      ratePlans: {
        create: [
          { code: "STANDARD", name: "Standart", isDefault: true },
          { code: "NONREF", name: "İade edilemez", refundable: false, priceModifierBps: -1000 },
        ],
      },
    },
  });
  await prisma.inventoryDay.createMany({
    data: Array.from({ length: opts.days ?? 120 }, (_, i) => ({
      roomTypeId: room.id,
      date: utcDay(i + 1),
      price,
      total: units,
    })),
  });

  let nextDay = 5;
  return {
    userId: user.id,
    hostId: host.id,
    propertyId: property.id,
    roomId: room.id,
    async hold(h = {}) {
      const nights = h.nights ?? 2;
      const start = h.startInDays ?? nextDay;
      if (h.startInDays === undefined) nextDay += nights + 1;
      const { booking } = await createBooking({
        userId: h.userId ?? user.id,
        propertyId: property.id,
        roomId: room.id,
        checkIn: iso(utcDay(start)),
        checkOut: iso(utcDay(start + nights)),
        guestCount: 1,
      });
      return {
        id: booking.id,
        totalMinor: booking.totalMinor,
        checkIn: booking.checkIn,
        checkOut: booking.checkOut,
      };
    },
  };
}

/** Defter bakiyesi (CHARGE − REFUND), minor-unit (TRY: kuruş). */
export async function ledgerNetMinor(prisma: PrismaClient, bookingId: string): Promise<number> {
  const rows = await prisma.ledgerEntry.findMany({ where: { bookingId } });
  return rows.reduce((sum, r) => {
    const minor = Math.round(Number(r.amount) * 100);
    return r.kind === "CHARGE" ? sum + minor : r.kind === "REFUND" ? sum - minor : sum;
  }, 0);
}
