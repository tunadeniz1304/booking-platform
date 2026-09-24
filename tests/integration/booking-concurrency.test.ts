import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient, Prisma } from "@prisma/client";
import { createBooking, BookingConflictError } from "@/lib/booking-service";
import { describeInt } from "./helpers";

describeInt("booking-concurrency (integration)", () => {
  const prisma = new PrismaClient();

  let testUser: { id: string };
  let testHost: { id: string };
  let testProperty: { id: string };
  let testRoom: { id: string };

  function todayUtcMidnight(): Date {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }

  function addDays(date: Date, days: number): Date {
    const d = new Date(date);
    d.setUTCDate(d.getUTCDate() + days);
    return d;
  }

  function pad(n: number): string {
    return n < 10 ? `0${n}` : String(n);
  }

  function iso(date: Date): string {
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  }

  /** fromDays'den itibaren UTC gece yarısı Date nesnesi (service parseDate ile aynı) */
  function utcDay(fromDays: number): Date {
    return addDays(todayUtcMidnight(), fromDays);
  }

  async function makeAvailable(roomId: string, dates: Date[]): Promise<void> {
    await Promise.all(
      dates.map(async (date) => {
        await prisma.availability.upsert({
          where: { roomId_date: { roomId, date } },
          update: { isAvailable: true, lockedBy: null },
          create: {
            roomId,
            date,
            isAvailable: true,
            price: new Prisma.Decimal(1000),
            lockedBy: null,
          },
        });
      })
    );
  }

  beforeAll(async () => {
    testUser = await prisma.user.create({
      data: {
        email: `test-${Date.now()}-user@booking.test`,
        passwordHash: "x",
        firstName: "Test",
        lastName: "User",
      },
    });
    testHost = await prisma.user.create({
      data: {
        email: `test-${Date.now()}-host@booking.test`,
        passwordHash: "x",
        firstName: "Test",
        lastName: "Host",
        role: "HOST",
      },
    });

    const location = await prisma.location.create({
      data: { city: `TestCity-${Date.now()}`, country: "TEST" },
    });
    testProperty = await prisma.property.create({
      data: {
        hostId: testHost.id,
        title: `Concurrency Test ${Date.now()}`,
        description: "Concurrency test property used by vitest.",
        propertyType: "HOTEL",
        locationId: location.id,
        basePrice: new Prisma.Decimal(1000),
        currency: "TRY",
        isActive: true,
      },
    });
    testRoom = await prisma.room.create({
      data: {
        propertyId: testProperty.id,
        name: "Test Room",
        capacity: 2,
        bedType: "Çift Kişilik Yatak",
        priceModifier: new Prisma.Decimal(0),
        available: true,
      },
    });
  });

  afterAll(async () => {
    await prisma.availability.deleteMany({ where: { roomId: testRoom.id } });
    await prisma.booking.deleteMany({ where: { userId: testUser.id } });
    await prisma.room.deleteMany({ where: { id: testRoom.id } });
    await prisma.property.deleteMany({ where: { hostId: testHost.id } });
    await prisma.location.deleteMany({ where: { city: { startsWith: "TestCity-" } } });
    await prisma.user.deleteMany({ where: { id: { in: [testUser.id, testHost.id] } } });
    await prisma.$disconnect();
  });

  describe("rezervasyon eşzamanlılık (double-booking)", () => {
    it("aynı oda ve tarih için iki eşzamanlı istekten yalnız biri rezervasyon yaratır", async () => {
      const nightDates = [utcDay(30), utcDay(31), utcDay(32)];
      await makeAvailable(testRoom.id, nightDates);

      const input = {
        userId: testUser.id,
        propertyId: testProperty.id,
        roomId: testRoom.id,
        checkIn: iso(utcDay(30)),
        checkOut: iso(utcDay(33)),
        guestCount: 2,
      };

      const results = await Promise.allSettled([createBooking(input), createBooking(input)]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const conflict = results.filter(
        (r) => r.status === "rejected" && r.reason instanceof BookingConflictError
      );

      // En az biri başarılı; reddedilenler yalnız çakışma sebebiyle olabilir
      expect(fulfilled.length).toBeGreaterThanOrEqual(1);
      expect(fulfilled.length + conflict.length).toBe(2);

      // Kritik garanti: tek oda/tarih için YALNIZCA 1 rezervasyon kaydı
      const count = await prisma.booking.count({
        where: { userId: testUser.id, propertyId: testProperty.id },
      });
      expect(count).toBe(1);
    }, 30000);
  });

  describe("idempotency anahtarı", () => {
    it("aynı Idempotency-Key ile tekrar eden istek aynı rezervasyonu döndürür", async () => {
      const nightDate = utcDay(40);
      await makeAvailable(testRoom.id, [nightDate]);
      const checkIn = iso(utcDay(40));
      const checkOut = iso(utcDay(41));

      const idempotencyKey = `idem-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const input = {
        userId: testUser.id,
        propertyId: testProperty.id,
        roomId: testRoom.id,
        checkIn,
        checkOut,
        guestCount: 1,
        idempotencyKey,
      };

      const first = await createBooking(input);
      const second = await createBooking(input);

      expect(first.booking.id).toBe(second.booking.id);

      const count = await prisma.booking.count({
        where: { userId: testUser.id, idempotencyKey },
      });
      expect(count).toBe(1);
    }, 30000);
  });
});
