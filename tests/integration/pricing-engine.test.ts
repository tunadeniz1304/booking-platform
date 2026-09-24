// Predictif fiyat motorunun etkinlik korelasyonunu canlı DB üzerinde doğrular.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient, Prisma } from "@prisma/client";
import { computeDynamicPrice, loadDemandImpact } from "@/lib/pricing/engine";
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
      },
    });
    const property = await prisma.property.create({
      data: {
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

  describe("prediktif fiyat motoru", () => {
    it("etkinlik gününde eventFactor > 1 ve demandSignal > 0 üretir", async () => {
      const impact = await loadDemandImpact(locationId, eventDate);
      expect(impact.eventFactor).toBeGreaterThan(1);
      expect(impact.demandSignal).toBeGreaterThan(0);

      const result = await computeDynamicPrice(
        {
          propertyId,
          roomId: "r",
          date: eventDate.toISOString().slice(0, 10),
          basePrice: 1000,
          occupancyRate: 0.4,
          locationId,
        },
        impact
      );
      expect(result.factors.eventFactor).toBeGreaterThan(1);
      // fiyat tutucu banda [0.6x, 3.0x] içinde kalmalı
      expect(result.price).toBeGreaterThanOrEqual(600);
      expect(result.price).toBeLessThanOrEqual(3000);
    });

    it("etkinlikten uzak tarihte eventFactor ~1 kalır", async () => {
      const farDate = new Date("2026-03-01T00:00:00.000Z"); // etkinlikten aylar önce
      const impact = await loadDemandImpact(locationId, farDate);
      expect(impact.eventFactor).toBeCloseTo(1, 5);
      expect(impact.demandSignal).toBe(0);
    });
  });
});
