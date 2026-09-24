import { it, expect } from "vitest";
import { PrismaClient, Prisma } from "@prisma/client";
import { describeInt, utcDay } from "./helpers";
import { rollAvailabilityForward } from "@/lib/booking/availability-rollover";

describeInt("P0-9 availability rollover (integration)", () => {
  it("ileri ufuk tamamlanır, mevcut satır ezilmez, tekrar çalıştırma idempotent", async () => {
    const prisma = new PrismaClient();
    const stamp = Date.now();
    const host = await prisma.user.create({
      data: { email: `roll-${stamp}@t.test`, passwordHash: "x", firstName: "R", lastName: "O" },
    });
    const loc = await prisma.location.create({
      data: { city: `RollCity-${stamp}`, country: "TEST" },
    });
    const property = await prisma.property.create({
      data: {
        hostId: host.id,
        title: "Roll",
        description: "roll",
        propertyType: "HOTEL",
        locationId: loc.id,
        basePrice: new Prisma.Decimal(750),
      },
    });
    const room = await prisma.room.create({
      data: { propertyId: property.id, name: "O", capacity: 2, bedType: "Ç" },
    });
    await prisma.availability.create({
      data: {
        roomId: room.id,
        date: utcDay(3),
        price: new Prisma.Decimal(999),
        isAvailable: false,
      },
    });

    await rollAvailabilityForward(30);
    expect(await prisma.availability.count({ where: { roomId: room.id } })).toBe(30);
    const kept = await prisma.availability.findUniqueOrThrow({
      where: { roomId_date: { roomId: room.id, date: utcDay(3) } },
    });
    expect(Number(kept.price)).toBe(999);
    expect(kept.isAvailable).toBe(false);

    await rollAvailabilityForward(30);
    expect(await prisma.availability.count({ where: { roomId: room.id } })).toBe(30);
    await prisma.$disconnect();
  });
});
