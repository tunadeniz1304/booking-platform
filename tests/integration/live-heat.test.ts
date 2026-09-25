import { beforeAll, afterAll, it, expect } from "vitest";
import { PrismaClient, Prisma } from "@prisma/client";
import { describeInt, iso, utcDay } from "./helpers";
import { getRoomHeat, recordRoomView, type RoomHeat } from "@/lib/live/stats";
import { acquireConnectionSlot, activeChannelCount, subscribeHeat } from "@/lib/live/hub";
import { invalidatePriceCache, updateAvailabilityPrices } from "@/lib/pricing-service";
import { getConfig, resetConfigForTests } from "@/lib/config/app-config";
import { redis } from "@/lib/redis";

/**
 * Canlı ısı haritası (hata #11) ve fiyat servisi: gerçek Postgres + Redis
 * pub/sub üzerinde istatistik, IP başına bağlantı sınırı ve poller dağıtımı.
 */
describeInt("canlı ısı haritası + fiyat servisi (integration)", () => {
  const prisma = new PrismaClient();
  const stamp = Date.now();
  let roomId = "";

  beforeAll(async () => {
    process.env.LIVE_POLL_INTERVAL_MS = "500";
    process.env.LIVE_MAX_CONNECTIONS_PER_IP = "2";
    resetConfigForTests();
    const host = await prisma.user.create({
      data: { email: `live-${stamp}@t.test`, passwordHash: "x", firstName: "L", lastName: "V" },
    });
    const location = await prisma.location.create({
      data: { city: `LiveCity-${stamp}`, country: "TEST" },
    });
    const property = await prisma.property.create({
      data: {
        hostId: host.id,
        title: "Live test",
        description: "live",
        propertyType: "HOTEL",
        locationId: location.id,
        basePrice: new Prisma.Decimal(1000),
      },
    });
    const room = await prisma.roomType.create({
      data: {
        propertyId: property.id,
        name: "Oda",
        maxOccupancy: 2,
        bedType: "Çift",
        ratePlans: { create: [{ code: "STANDARD", name: "Standart", isDefault: true }] },
      },
    });
    roomId = room.id;
    // 4 gecenin 3'ü dolu → kıtlık 0.75 ("limited")
    await prisma.inventoryDay.createMany({
      data: Array.from({ length: 4 }, (_, i) => ({
        roomTypeId: roomId,
        date: utcDay(i + 1),
        price: new Prisma.Decimal(1000),
        total: 1,
        sold: i === 0 ? 0 : 1,
      })),
    });
  });

  afterAll(async () => {
    delete process.env.LIVE_POLL_INTERVAL_MS;
    delete process.env.LIVE_MAX_CONNECTIONS_PER_IP;
    resetConfigForTests();
    await prisma.$disconnect();
  });

  it("görüntülenme IP başına tekilleştirilir ve ısıya yansır", async () => {
    expect(await recordRoomView(roomId, "10.0.0.1")).toBe(true);
    expect(await recordRoomView(roomId, "10.0.0.1")).toBe(false);
    expect(await recordRoomView(roomId, "10.0.0.2")).toBe(true);

    const heat = await getRoomHeat(roomId, iso(utcDay(1)), iso(utcDay(5)));
    expect(heat).toMatchObject({
      roomId,
      totalNights: 4,
      bookedNights: 3,
      availableNights: 1,
      scarcity: 0.75,
      views: 2,
      status: "limited",
    });
    expect(heat!.currentNightlyPrice).toBeGreaterThan(0);
    expect(heat!.demandSignal).toBeGreaterThanOrEqual(0);
    expect(heat!.demandSignal).toBeLessThanOrEqual(1);
  });

  it("tamamen dolu aralık sold_out; bilinmeyen oda null; ters aralık hata", async () => {
    const soldOut = await getRoomHeat(roomId, iso(utcDay(2)), iso(utcDay(5)));
    expect(soldOut!.status).toBe("sold_out");
    expect(await getRoomHeat("yok-boyle-oda")).toBeNull();
    await expect(getRoomHeat(roomId, iso(utcDay(5)), iso(utcDay(1)))).rejects.toThrow();
    // Tarihsiz çağrı önümüzdeki 7 geceyi kullanır.
    const defaultRange = await getRoomHeat(roomId);
    expect(defaultRange!.totalNights).toBeGreaterThan(0);
  });

  it("IP başına eşzamanlı bağlantı sınırı uygulanır; bırakılan yuva yeniden kullanılır", async () => {
    const ip = `192.0.2.${stamp % 200}`;
    const a = await acquireConnectionSlot(ip);
    const b = await acquireConnectionSlot(ip);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(await acquireConnectionSlot(ip)).toBeNull();
    await a!();
    await a!(); // idempotent: ikinci bırakma sayacı düşürmez
    const c = await acquireConnectionSlot(ip);
    expect(c).not.toBeNull();
    expect(await acquireConnectionSlot(ip)).toBeNull();
    await b!();
    await c!();
    expect(Number(await redis.get(`live:conn:${ip}`))).toBe(0);
  });

  it("tek poller ısıyı pub/sub ile tüm abonelere dağıtır; son abone ayrılınca durur", async () => {
    expect(getConfig().LIVE_POLL_INTERVAL_MS).toBe(500);
    const start = iso(utcDay(1));
    const end = iso(utcDay(5));
    const received: RoomHeat[] = [];
    const second: RoomHeat[] = [];
    const before = activeChannelCount();
    const off1 = subscribeHeat(roomId, start, end, (h) => received.push(h));
    const off2 = subscribeHeat(roomId, start, end, (h) => second.push(h));
    expect(activeChannelCount()).toBe(before + 1); // aynı anahtar → tek kanal

    const deadline = Date.now() + 10_000;
    while ((received.length === 0 || second.length === 0) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(received[0]).toMatchObject({ roomId, bookedNights: 3 });
    expect(second[0]).toMatchObject({ roomId });

    off1();
    expect(activeChannelCount()).toBe(before + 1);
    off2();
    expect(activeChannelCount()).toBe(before);
    off2(); // ikinci çağrı zararsız
  });

  it("updateAvailabilityPrices motor fiyatını önbelleğe ve müsaitlik satırlarına yazar", async () => {
    const dates = [iso(utcDay(1)), iso(utcDay(10))];
    const results = await updateAvailabilityPrices(roomId, dates, 1000, "TRY");
    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r.roomId).toBe(roomId);
      expect(r.price).toBeGreaterThan(0);
      expect(JSON.parse((await redis.get(`price:${roomId}:${r.date}`))!).price).toBe(r.price);
    }
    const rows = await prisma.inventoryDay.findMany({
      where: { roomTypeId: roomId, date: { in: dates.map((d) => new Date(d)) } },
      orderBy: { date: "asc" },
    });
    expect(rows).toHaveLength(2); // 10. gün satırı upsert ile oluşturuldu
    expect(Number(rows[1].price)).toBe(results[1].price);
    // Yeni gece satılabilir: tek birim, hiçbiri satılmamış/tutulmamış
    expect(rows[1]).toMatchObject({ total: 1, sold: 0, held: 0 });

    await invalidatePriceCache(roomId, dates[0]);
    expect(await redis.get(`price:${roomId}:${dates[0]}`)).toBeNull();
  });
});
