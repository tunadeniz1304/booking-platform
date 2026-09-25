// Tek fiyat motorunun (event-signals, v3#9) olay korelasyonunu canlı DB üzerinde doğrular.
import { it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient, Prisma } from "@prisma/client";
import { eventSignal, priceNights } from "@/lib/pricing/event-signals";
import { getConfig } from "@/lib/config/app-config";
import { describeInt } from "./helpers";

describeInt("pricing-engine (integration)", () => {
  const prisma = new PrismaClient();

  let locationId = "";
  let propertyId = "";
  const eventDate = new Date("2026-11-14T00:00:00.000Z");

  beforeAll(async () => {
    const location = await prisma.location.create({
      data: { city: `TestEventCity-${Date.now()}`, country: "TEST" },
    });
    locationId = location.id;
    await prisma.demandEvent.create({
      data: {
        locationId,
        title: "Büyük Konser",
        startsAt: eventDate,
        endsAt: eventDate,
        impact: 9,
        status: "APPROVED",
      },
    });
    const property = await prisma.property.create({
      data: {
        licenseStatus: "VERIFIED",
        hostId: (
          await prisma.user.create({
            data: {
              email: `evt-host-${Date.now()}@t.test`,
              passwordHash: "x",
              firstName: "H",
              lastName: "E",
              role: "HOST",
            },
          })
        ).id,
        title: "Etkinlik Test Oteli",
        description: "predictive pricing test",
        propertyType: "HOTEL",
        locationId,
        basePrice: new Prisma.Decimal(1000),
        currency: "TRY",
        isActive: true,
      },
    });
    propertyId = property.id;
  });

  afterAll(async () => {
    await prisma.demandEvent.deleteMany({ where: { locationId } });
    await prisma.property.deleteMany({ where: { id: propertyId } });
    await prisma.location.deleteMany({ where: { id: locationId } });
    await prisma.user.deleteMany({ where: { email: { startsWith: "evt-host-" } } });
    await prisma.$disconnect();
  });

  it("regression: v3#9 olay gecesi çarpanı yapılandırılmış taban/tavan içinde, uzak gece olaysız", async () => {
    const { PRICE_FLOOR_MULTIPLIER, PRICE_CEILING_MULTIPLIER } = getConfig();
    const priced = await priceNights({
      locationId,
      nights: ["2026-11-14", "2027-03-03"],
      baseMinor: 100_000,
      currency: "TRY",
    });
    const onEvent = priced.get("2026-11-14")!;
    expect(onEvent.factors.event).toBeGreaterThan(1);
    expect(onEvent.events.map((e) => e.title)).toContain("Büyük Konser");
    expect(onEvent.multiplier).toBeGreaterThanOrEqual(PRICE_FLOOR_MULTIPLIER);
    expect(onEvent.multiplier).toBeLessThanOrEqual(PRICE_CEILING_MULTIPLIER);
    expect(Number.isInteger(onEvent.price)).toBe(true);
    expect(eventSignal(onEvent)).toBeGreaterThan(0);

    const far = priced.get("2027-03-03")!;
    expect(far.factors.event).toBe(1);
    expect(far.events).toEqual([]);
    expect(eventSignal(far)).toBe(0);
  });

  it("konumsuz fiyatlama olaysız (mevsim × hafta günü) döner", async () => {
    const priced = await priceNights({
      locationId: null,
      nights: ["2026-11-14"],
      baseMinor: 100_000,
      currency: "TRY",
    });
    expect(priced.get("2026-11-14")!.factors.event).toBe(1);
    expect(propertyId).not.toBe("");
  });
});
