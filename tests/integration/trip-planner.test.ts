import { it, expect } from "vitest";
import { PrismaClient, Prisma } from "@prisma/client";
import { describeInt, utcDay } from "./helpers";
import { planTrip } from "@/lib/ai/trip-planner";
import { optimizeRoute } from "@/lib/routing/optimizer";
import { loadQuote } from "@/lib/pricing/quote";
import { monthOf, parseIsoDate } from "@/lib/time/nights";

describeInt("P1-6 trip-planner (integration, demo)", () => {
  it("İstanbul, Kapadokya, İzmir 7 gün 2 kişi → optimizer sırası, toplam = teklifler toplamı", async () => {
    const prisma = new PrismaClient();
    const stamp = Date.now();
    const host = await prisma.user.create({
      data: {
        email: `trip-${stamp}@t.test`,
        passwordHash: "x",
        firstName: "T",
        lastName: "P",
        role: "HOST",
      },
    });
    const cities = [
      { city: "İstanbul", lat: 41.0082, lng: 28.9784, price: 2000 },
      { city: "Kapadokya", lat: 38.6431, lng: 34.8289, price: 1500 },
      { city: "İzmir", lat: 38.4192, lng: 27.1287, price: 1200 },
    ];
    for (const c of cities) {
      const loc = await prisma.location.upsert({
        where: { city_country: { city: c.city, country: "Türkiye" } },
        update: { latitude: c.lat, longitude: c.lng },
        create: { city: c.city, country: "Türkiye", latitude: c.lat, longitude: c.lng },
      });
      const p = await prisma.property.create({
        data: {
          licenseStatus: "VERIFIED",
          hostId: host.id,
          title: `${c.city} Konak`,
          description: "gezi",
          propertyType: "HOTEL",
          locationId: loc.id,
          basePrice: new Prisma.Decimal(c.price),
        },
      });
      const room = await prisma.roomType.create({
        data: {
          propertyId: p.id,
          name: "Çift",
          maxOccupancy: 2,
          bedType: "Çift",
          ratePlans: { create: [{ code: "STANDARD", name: "Standart", isDefault: true }] },
        },
      });
      await prisma.inventoryDay.createMany({
        data: Array.from({ length: 60 }, (_, i) => ({
          roomTypeId: room.id,
          total: 1,
          date: utcDay(i + 1),
          price: new Prisma.Decimal(c.price),
        })),
        skipDuplicates: true,
      });
    }
    const start = utcDay(20).toISOString().slice(0, 10);
    const plan = await planTrip({
      cities: ["İstanbul", "Kapadokya", "İzmir"],
      days: 7,
      guests: 2,
      startDate: start,
    });
    expect(plan.llmMode).toBe("demo");
    const expected = optimizeRoute(
      cities.slice(1).map((c) => ({ id: c.city, name: c.city, lat: c.lat, lng: c.lng })),
      { id: "İstanbul", name: "İstanbul", lat: 41.0082, lng: 28.9784 },
      monthOf(parseIsoDate(start))
    );
    expect(plan.route.order).toEqual(expected.order);
    expect(plan.stops.map((s) => s.nights).reduce((a, b) => a + b, 0)).toBe(7);
    expect(plan.stops.every((s) => s.stay)).toBe(true);
    const sum = plan.stops.reduce((s, x) => s + x.stay!.total, 0);
    expect(plan.total).toBe(sum);
    for (const s of plan.stops)
      expect((await loadQuote(s.stay!.quoteId))?.total).toBe(s.stay!.total);
    expect(plan.narrative).toContain("Rezervasyon yapılmadı");
    await prisma.$disconnect();
  });
});
