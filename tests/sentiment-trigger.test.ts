// Global Sentiment & Event Trigger: sinyal alındığında bölge fiyatlarının
// yeniden fiyatlanması ve stok hedge'inin reversible çalıştığını DB'de doğrular.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient, Prisma } from "@prisma/client";
import { ingestExternalSignal, releaseEventHedge } from "@/lib/sentiment/trigger";

const prisma = new PrismaClient();

let locationId = "";
let propertyId = "";
let roomId = "";
let eventId = "";
let cityName = "";
const starts = new Date("2026-11-20T00:00:00.000Z");
const ends = new Date("2026-11-22T00:00:00.000Z");

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

beforeAll(async () => {
  cityName = `SentimentCity-${Date.now()}`;
  const location = await prisma.location.create({
    data: { city: cityName, country: "TEST" },
  });
  locationId = location.id;
  const host = await prisma.user.create({
    data: { email: `senti-host-${Date.now()}@t.test`, passwordHash: "x", firstName: "H", lastName: "S", role: "HOST" },
  });
  const property = await prisma.property.create({
    data: {
      hostId: host.id,
      title: "Sentiment Trigger Oteli",
      description: "sentiment integration test",
      propertyType: "HOTEL",
      locationId,
      basePrice: new Prisma.Decimal(1000),
      currency: "TRY",
      isActive: true,
    },
  });
  propertyId = property.id;
  const room = await prisma.room.create({
    data: { propertyId, name: "Sinyal Odası", capacity: 2, bedType: "Çift Kişilik", priceModifier: new Prisma.Decimal(0), available: true },
  });
  roomId = room.id;
  // pencere: starts-1 .. ends+1 — hepsini 1000 TRY / müsait başlat
  const d = new Date(starts);
  d.setUTCDate(d.getUTCDate() - 1);
  const rows = [];
  const endPlus = new Date(ends);
  endPlus.setUTCDate(endPlus.getUTCDate() + 2);
  while (d < endPlus) {
    rows.push({ roomId, date: new Date(d), isAvailable: true, price: new Prisma.Decimal(1000) });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  await prisma.availability.createMany({ data: rows });
});

afterAll(async () => {
  await prisma.availability.deleteMany({ where: { roomId } });
  await prisma.room.deleteMany({ where: { id: roomId } });
  await prisma.property.deleteMany({ where: { id: propertyId } });
  await prisma.demandEvent.deleteMany({ where: { locationId } });
  await prisma.location.deleteMany({ where: { id: locationId } });
  await prisma.user.deleteMany({ where: { email: { startsWith: "senti-host-" } } });
  await prisma.$disconnect();
});

describe("Global Sentiment & Event Trigger", () => {
  it("sinyal: fiyat artar, ilk gece hedge edilir, release ile geri döner", async () => {
    const result = await ingestExternalSignal({
      title: "Büyük Şehir Konseri Açıklandı",
      city: cityName,
      startsOn: iso(starts),
      endsOn: iso(ends),
      impact: 9,
      source: "news-feed",
      hedgeLastN: 1,
    });
    eventId = result.eventId;
    expect(result.affectedProperties).toBeGreaterThanOrEqual(1);
    expect(result.repricedRooms).toBeGreaterThanOrEqual(1);
    expect(result.hedgedNights).toBeGreaterThanOrEqual(1);

    // DemandEvent oluştu
    const ev = await prisma.demandEvent.findUnique({ where: { id: eventId } });
    expect(ev).not.toBeNull();
    expect(ev?.impact).toBe(9);

    // Pencere fiyatları motorun etkinlik çarpanıyla arttı (1000 > 1000)
    const windowPrices = await prisma.availability.findMany({
      where: { roomId, date: { gte: starts, lt: ends } , isAvailable: true },
      select: { price: true },
    });
    for (const p of windowPrices) {
      expect(Number(p.price)).toBeGreaterThan(1000);
    }

    // Hedge: en az bir gece kilitli (hedge:<eventId>)
    const hedged = await prisma.availability.findMany({
      where: { roomId, isAvailable: false, lockedBy: { startsWith: "hedge:" } },
    });
    expect(hedged.length).toBeGreaterThanOrEqual(1);

    // Reversible: release hedge → kilitli kayıtlar tekrar müsait
    const restored = await releaseEventHedge(eventId);
    expect(restored).toBeGreaterThanOrEqual(1);
    const leftover = await prisma.availability.findMany({
      where: { roomId, lockedBy: { startsWith: "hedge:" } },
    });
    expect(leftover.length).toBe(0);
  }, 30000);
});
