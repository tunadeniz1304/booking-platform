import { it, expect } from "vitest";
import { PrismaClient, Prisma } from "@prisma/client";
import { describeInt, iso, utcDay } from "./helpers";
import {
  applyEvent,
  approveEvent,
  createYieldHold,
  proposeEvent,
  releaseYieldHold,
  rollbackEvent,
} from "@/lib/pricing/event-signals";

describeInt("regression: #13 olay sinyalleri (integration)", () => {
  it("öneri etkisiz; onay idempotent, bileşiksiz ve tavanlı; geri alma ve yield hold", async () => {
    const prisma = new PrismaClient();
    const stamp = Date.now();
    const host = await prisma.user.create({
      data: {
        email: `ev-${stamp}@t.test`,
        passwordHash: "x",
        firstName: "E",
        lastName: "V",
        role: "HOST",
      },
    });
    const loc = await prisma.location.create({
      data: { city: `EvCity-${stamp}`, country: "TEST" },
    });
    const property = await prisma.property.create({
      data: {
        hostId: host.id,
        title: "Olay Oteli",
        description: "e",
        propertyType: "HOTEL",
        locationId: loc.id,
        basePrice: new Prisma.Decimal(1000),
      },
    });
    const rooms = await Promise.all(
      [1, 2, 3, 4, 5].map((i) =>
        prisma.room.create({
          data: { propertyId: property.id, name: `O${i}`, capacity: 2, bedType: "Ç" },
        })
      )
    );
    await prisma.availability.createMany({
      data: rooms.flatMap((r) =>
        Array.from({ length: 40 }, (_, i) => ({
          roomId: r.id,
          date: utcDay(i + 1),
          price: new Prisma.Decimal(1000),
        }))
      ),
    });
    const prices = async () =>
      (
        await prisma.availability.findMany({
          where: { roomId: rooms[0].id },
          orderBy: { date: "asc" },
          select: { price: true },
        })
      ).map((p) => Number(p.price));

    const event = await proposeEvent({
      locationId: loc.id,
      title: "Büyük konser",
      startsOn: iso(utcDay(20)),
      endsOn: iso(utcDay(21)),
      impact: 10,
    });
    await applyEvent(event.id); // PROPOSED → etkisiz (yalnızca mevsim/hafta günü)
    const baseline = await prices();

    await approveEvent(event.id, host.id);
    const once = await prices();
    for (let i = 0; i < 10; i++) await approveEvent(event.id, host.id);
    expect(await prices()).toEqual(once); // 10 kez = 1 kez (bileşik artış yok)
    expect(once[19]).toBeGreaterThan(baseline[19]);
    expect(Math.max(...once)).toBeLessThanOrEqual(1000 * 2.0); // PRICE_CEILING_MULTIPLIER
    const explained = await prisma.availability.findFirstOrThrow({
      where: { roomId: rooms[0].id, date: utcDay(20) },
    });
    expect((explained.priceExplanation as { events: unknown[] }).events).toHaveLength(1);

    const held = await createYieldHold(event.id, 0.2);
    expect(held).toBeGreaterThan(0);
    const perNight = await prisma.availability.count({
      where: { date: utcDay(20), lockedBy: `yield:${event.id}` },
    });
    expect(perNight).toBeLessThanOrEqual(1); // 5 odanın %20'si
    await expect(createYieldHold(event.id, 0.5)).rejects.toMatchObject({ status: 400 });

    await rollbackEvent(event.id);
    expect(await prices()).toEqual(baseline);
    expect(await releaseYieldHold(event.id)).toBe(0);
    await prisma.$disconnect();
  });
});
