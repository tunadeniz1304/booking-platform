import { beforeAll, afterAll, it, expect } from "vitest";
import { PrismaClient, Prisma } from "@prisma/client";
import { describeInt, iso, utcDay } from "./helpers";
import { createBooking, cancelBooking, expireHolds } from "@/lib/booking-service";
import { createQuote } from "@/lib/pricing/quote";
import { claimBatch, relayOutbox } from "@/lib/cqrs/outbox";
import { eventBus } from "@/lib/cqrs";

describeInt("rezervasyon çekirdeği (integration)", () => {
  const prisma = new PrismaClient();
  const stamp = Date.now();
  let hostId = "";
  let tryProperty = { id: "", roomId: "" };
  let usdProperty = { id: "", roomId: "" };
  const userIds: string[] = [];

  async function makeProperty(currency: string, price: number) {
    const location = await prisma.location.create({
      data: { city: `CoreCity-${currency}-${stamp}`, country: "TEST" },
    });
    const property = await prisma.property.create({
      data: {
        hostId,
        title: `Core ${currency}`,
        description: "core test",
        propertyType: "HOTEL",
        locationId: location.id,
        basePrice: new Prisma.Decimal(price),
        currency,
      },
    });
    const room = await prisma.room.create({
      data: {
        propertyId: property.id,
        name: "Son Oda",
        capacity: 2,
        bedType: "Çift",
        priceModifier: new Prisma.Decimal(50),
      },
    });
    await prisma.availability.createMany({
      data: Array.from({ length: 80 }, (_, i) => ({
        roomId: room.id,
        date: utcDay(i + 1),
        price: new Prisma.Decimal(price),
        isAvailable: true,
      })),
    });
    return { id: property.id, roomId: room.id };
  }

  beforeAll(async () => {
    const host = await prisma.user.create({
      data: {
        email: `core-host-${stamp}@t.test`,
        passwordHash: "x",
        firstName: "H",
        lastName: "C",
        role: "HOST",
      },
    });
    hostId = host.id;
    await prisma.user.createMany({
      data: Array.from({ length: 100 }, (_, i) => ({
        email: `core-u${i}-${stamp}@t.test`,
        passwordHash: "x",
        firstName: "U",
        lastName: String(i),
      })),
    });
    const users = await prisma.user.findMany({
      where: { email: { startsWith: "core-u", endsWith: `-${stamp}@t.test` } },
      select: { id: true },
    });
    userIds.push(...users.map((u) => u.id));
    tryProperty = await makeProperty("TRY", 1000);
    usdProperty = await makeProperty("USD", 120);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("P0-2: aynı son oda için 100 paralel istek → tam 1 başarı, 99 SOLD_OUT", async () => {
    const input = (userId: string) => ({
      userId,
      propertyId: tryProperty.id,
      roomId: tryProperty.roomId,
      checkIn: iso(utcDay(10)),
      checkOut: iso(utcDay(12)),
      guestCount: 2,
    });
    const results = await Promise.allSettled(userIds.map((u) => createBooking(input(u))));
    const ok = results.filter((r) => r.status === "fulfilled");
    const codes = results
      .filter((r): r is PromiseRejectedResult => r.status === "rejected")
      .map((r) => (r.reason as { code?: string }).code);
    expect(ok).toHaveLength(1);
    expect(codes).toHaveLength(99);
    expect(new Set(codes)).toEqual(new Set(["SOLD_OUT"]));

    // SQL ile doğrulanmış overbooking = 0: her gece en fazla bir aktif rezervasyon
    const overbooked = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*)::bigint AS n FROM (
        SELECT a.date FROM "Availability" a
        JOIN "Booking" b ON b."roomId" = a."roomId"
          AND a.date >= b."checkIn" AND a.date < b."checkOut"
          AND b.status IN ('PENDING','HELD','CONFIRMED')
        WHERE a."roomId" = ${tryProperty.roomId}
        GROUP BY a.date HAVING COUNT(*) > 1
      ) x`;
    expect(Number(overbooked[0].n)).toBe(0);
  }, 120_000);

  it("regression: #4 hold süresi dolunca EXPIRED olur ve envanter geri gelir", async () => {
    const { booking } = await createBooking({
      userId: userIds[1],
      propertyId: tryProperty.id,
      roomId: tryProperty.roomId,
      checkIn: iso(utcDay(20)),
      checkOut: iso(utcDay(22)),
      guestCount: 1,
    });
    expect(booking.status).toBe("HELD");
    expect(booking.holdExpiresAt).not.toBeNull();

    // Süre dolmadan: hiçbir şey olmaz
    expect(await expireHolds(new Date())).toBe(0);

    const later = new Date(Date.now() + 16 * 60_000);
    expect(await expireHolds(later)).toBeGreaterThanOrEqual(1);
    const after = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(after.status).toBe("EXPIRED");
    const locked = await prisma.availability.count({
      where: { roomId: tryProperty.roomId, lockedBy: booking.id },
    });
    expect(locked).toBe(0);

    // Oda yeniden rezerve edilebilir
    const again = await createBooking({
      userId: userIds[2],
      propertyId: tryProperty.id,
      roomId: tryProperty.roomId,
      checkIn: iso(utcDay(20)),
      checkOut: iso(utcDay(22)),
      guestCount: 1,
    });
    expect(again.booking.status).toBe("HELD");
  }, 60_000);

  it("regression: #4 eski sürümden kalan PENDING kayıtlar da süre aşımında temizlenir", async () => {
    const { booking } = await createBooking({
      userId: userIds[3],
      propertyId: tryProperty.id,
      roomId: tryProperty.roomId,
      checkIn: iso(utcDay(30)),
      checkOut: iso(utcDay(31)),
      guestCount: 1,
    });
    await prisma.booking.update({
      where: { id: booking.id },
      data: { status: "PENDING", holdExpiresAt: null, createdAt: new Date(Date.now() - 3_600_000) },
    });
    await expireHolds(new Date());
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe(
      "EXPIRED"
    );
  });

  it("regression: #8 teklif = rezervasyon toplamı; fiyat değişirse 409 PRICE_CHANGED", async () => {
    const req = {
      roomId: tryProperty.roomId,
      propertyId: tryProperty.id,
      checkIn: iso(utcDay(40)),
      checkOut: iso(utcDay(43)),
      guests: 2,
    };
    const quote = await createQuote(req);
    // (1000 + 50) × 3 = 3150 TL = 315000 kuruş, %1 vergi = 3150 → 318150
    expect(quote.subtotal).toBe(315_000);
    expect(quote.total).toBe(318_150);

    const ok = await createBooking({
      userId: userIds[4],
      propertyId: tryProperty.id,
      roomId: tryProperty.roomId,
      checkIn: req.checkIn,
      checkOut: req.checkOut,
      guestCount: 2,
      quoteId: quote.quoteId,
    });
    expect(ok.booking.totalMinor).toBe(quote.total);
    await cancelBooking(ok.booking.id, userIds[4]);

    const stale = await createQuote(req);
    await prisma.availability.updateMany({
      where: { roomId: tryProperty.roomId, date: utcDay(41) },
      data: { price: new Prisma.Decimal(1300) },
    });
    await expect(
      createBooking({
        userId: userIds[5],
        propertyId: tryProperty.id,
        roomId: tryProperty.roomId,
        checkIn: req.checkIn,
        checkOut: req.checkOut,
        guestCount: 2,
        quoteId: stale.quoteId,
      })
    ).rejects.toMatchObject({ status: 409, code: "PRICE_CHANGED" });
  }, 60_000);

  it("regression: #7 para birimi daima mülkün para birimi", async () => {
    const { booking } = await createBooking({
      userId: userIds[6],
      propertyId: usdProperty.id,
      roomId: usdProperty.roomId,
      checkIn: iso(utcDay(15)),
      checkOut: iso(utcDay(16)),
      guestCount: 1,
      // İstemci para birimi alanı artık yok; ekstra alan gönderilse bile yok sayılır.
      ...({ currency: "TRY" } as object),
    });
    expect(booking.currency).toBe("USD");
    const row = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(row.currency).toBe("USD");
  });

  it("iptal: HELD → CANCELLED envanteri iade eder; ikinci iptal 409", async () => {
    const { booking } = await createBooking({
      userId: userIds[7],
      propertyId: tryProperty.id,
      roomId: tryProperty.roomId,
      checkIn: iso(utcDay(50)),
      checkOut: iso(utcDay(52)),
      guestCount: 1,
    });
    const res = await cancelBooking(booking.id, userIds[7]);
    expect(res.status).toBe("CANCELLED");
    expect(await prisma.availability.count({ where: { lockedBy: booking.id } })).toBe(0);
    await expect(cancelBooking(booking.id, userIds[7])).rejects.toMatchObject({ status: 409 });
    // Başkası iptal edemez (404 — IDOR)
    await expect(cancelBooking(booking.id, userIds[8])).rejects.toMatchObject({ status: 404 });
  });

  it("regression: #9 outbox — iki işçi aynı mesajı birlikte kiralayamaz, kira dolunca yeniden alınır", async () => {
    await prisma.outboxMessage.updateMany({ data: { status: "DONE" } });
    await prisma.outboxMessage.createMany({
      data: Array.from({ length: 20 }, (_, i) => ({
        eventType: "test.noop",
        aggregateId: `agg-${i}`,
        aggregateType: "test",
        payload: {},
      })),
    });
    const [a, b] = await Promise.all([claimBatch(15), claimBatch(15)]);
    const ids = [...a, ...b].map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(20);

    // Kira dolmadan tekrar alınamaz; dolduktan sonra alınır
    expect(await claimBatch(50)).toHaveLength(0);
    const future = new Date(Date.now() + 5 * 60_000);
    expect((await claimBatch(50, future)).length).toBe(20);
    await prisma.outboxMessage.updateMany({
      where: { eventType: "test.noop" },
      data: { status: "DONE" },
    });
  });

  it("regression: #9 outbox — azami denemeden sonra DEAD (sonsuz retry yok)", async () => {
    const failing = {
      listens: "test.fail",
      handle: async () => {
        throw new Error("tüketici hatası");
      },
    };
    // EventBus handler hatalarını yutar; yayının kendisini başarısız kılmak için publish'i sar.
    const original = eventBus.publish.bind(eventBus);
    eventBus.publish = async (event) => {
      if (event.type === "test.fail") throw new Error("yayın hatası");
      return original(event);
    };
    try {
      eventBus.on(failing);
      const msg = await prisma.outboxMessage.create({
        data: {
          eventType: "test.fail",
          aggregateId: "x",
          aggregateType: "test",
          payload: {},
          attempts: 7,
        },
      });
      await relayOutbox(100);
      const after = await prisma.outboxMessage.findUniqueOrThrow({ where: { id: msg.id } });
      expect(after.status).toBe("DEAD");
      expect(after.lastError).toContain("yayın hatası");
    } finally {
      eventBus.publish = original;
      eventBus.off(failing);
    }
  });
});
