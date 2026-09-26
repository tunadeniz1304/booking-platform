import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createBooking } from "@/lib/booking-service";
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
        await prisma.inventoryDay.upsert({
          where: { roomTypeId_date: { roomTypeId: roomId, date } },
          update: { total: 1, sold: 0, held: 0 },
          create: {
            roomTypeId: roomId,
            date,
            total: 1,
            priceMinor: 100000n,
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
        licenseStatus: "VERIFIED",
        hostId: testHost.id,
        title: `Concurrency Test ${Date.now()}`,
        description: "Concurrency test property used by vitest.",
        propertyType: "HOTEL",
        locationId: location.id,
        basePriceMinor: 100000n,
        currency: "TRY",
        isActive: true,
      },
    });
    testRoom = await prisma.roomType.create({
      data: {
        propertyId: testProperty.id,
        name: "Test Room",
        maxOccupancy: 2,
        bedType: "Çift Kişilik Yatak",
        priceModifierMinor: 0n,
        available: true,
        ratePlans: { create: [{ code: "STANDARD", name: "Standart", isDefault: true }] },
      },
    });
  });

  afterAll(async () => {
    await prisma.inventoryDay.deleteMany({ where: { roomTypeId: testRoom.id } });
    await prisma.booking.deleteMany({ where: { userId: testUser.id } });
    await prisma.ratePlan.deleteMany({ where: { roomTypeId: testRoom.id } });
    await prisma.roomType.deleteMany({ where: { id: testRoom.id } });
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
        (r) => r.status === "rejected" && (r.reason as { status?: number }).status === 409
      );

      // En az biri başarılı; reddedilenler yalnız çakışma sebebiyle olabilir
      expect(fulfilled.length).toBeGreaterThanOrEqual(1);
      expect(fulfilled.length + conflict.length).toBe(2);

      // Kritik garanti: tek oda/tarih için YALNIZCA 1 rezervasyon kaydı
      const count = await prisma.booking.count({
        where: { userId: testUser.id, propertyId: testProperty.id },
      });
      expect(count).toBe(1);

      // Sayaç: her gece tam 1 birim tutuldu, hiçbir gecede fazla satış yok
      const days = await prisma.inventoryDay.findMany({
        where: { roomTypeId: testRoom.id, date: { in: nightDates } },
        select: { sold: true, held: true },
      });
      expect(days.map((d) => d.sold + d.held)).toEqual([1, 1, 1]);
      const [{ over }] = await prisma.$queryRaw<{ over: bigint }[]>`
        SELECT count(*) AS over FROM "InventoryDay" WHERE sold + held > total`;
      expect(Number(over)).toBe(0);
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
      // Tekrar eden istek sayacı ikinci kez hareket ettirmez
      const day = await prisma.inventoryDay.findUniqueOrThrow({
        where: { roomTypeId_date: { roomTypeId: testRoom.id, date: nightDate } },
      });
      expect(day.held + day.sold).toBe(1);
    }, 30000);
  });
});
