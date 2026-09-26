import { type PrismaClient } from "@prisma/client";
import { createBooking } from "@/lib/booking-service";
import { listBookingLedger, netChargedMinor } from "@/lib/ledger";
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
      // v4#6: fixture kullanıcıları varsayılan olarak e-postası doğrulanmış.
      emailVerifiedAt: new Date(),
      firstName: "Test",
      lastName: "Kullanıcı",
    },
  });
  const host = await prisma.user.create({
    data: {
      email: `h-${stamp}@t.test`,
      passwordHash: "x",
      emailVerifiedAt: new Date(),
      firstName: "Host",
      lastName: "Test",
      role: "HOST",
    },
  });
  const location = await prisma.location.create({
    data: { city: `City-${stamp}`, country: opts.country ?? "TEST" },
  });
  const price = BigInt(Math.round((opts.nightlyPrice ?? 1000) * 100));
  const property = await prisma.property.create({
    data: {
      licenseStatus: "VERIFIED",
      hostId: host.id,
      title: `Otel ${stamp}`,
      description: "entegrasyon testi",
      propertyType: "HOTEL",
      locationId: location.id,
      basePriceMinor: price,
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
      priceMinor: price,
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

/**
 * Defter bakiyesi (CHARGE − REFUND), minor-unit (TRY: kuruş). Eski `LedgerEntry` ∪ jurnal
 * (dual-write) uyum görünümünden okunur → aynı olay iki kez sayılmaz (F2c).
 */
export async function ledgerNetMinor(prisma: PrismaClient, bookingId: string): Promise<number> {
  const rows = await listBookingLedger(prisma, bookingId);
  const currencies = [...new Set(rows.map((r) => r.currency))];
  return currencies.reduce((sum, c) => sum + Number(netChargedMinor(rows, c)), 0);
}
