import { it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
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
        licenseStatus: "VERIFIED",
        hostId: host.id,
        title: "Roll",
        description: "roll",
        propertyType: "HOTEL",
        locationId: loc.id,
        basePriceMinor: 75000n,
      },
    });
    const room = await prisma.roomType.create({
      data: { propertyId: property.id, name: "O", maxOccupancy: 2, bedType: "Ç", units: 2 },
    });
    // Mevcut gece: farklı fiyat + dolu sayaçlar (2 birimin ikisi satılmış)
    await prisma.inventoryDay.create({
      data: {
        roomTypeId: room.id,
        date: utcDay(3),
        priceMinor: 99900n,
        total: 2,
        sold: 2,
      },
    });

    await rollAvailabilityForward(30);
    expect(await prisma.inventoryDay.count({ where: { roomTypeId: room.id } })).toBe(30);
    const kept = await prisma.inventoryDay.findUniqueOrThrow({
      where: { roomTypeId_date: { roomTypeId: room.id, date: utcDay(3) } },
    });
    expect(Number(kept.priceMinor)).toBe(99900);
    expect(kept).toMatchObject({ total: 2, sold: 2, held: 0 });
    // Yeni geceler taban fiyat ve total = units ile açılır
    const fresh = await prisma.inventoryDay.findUniqueOrThrow({
      where: { roomTypeId_date: { roomTypeId: room.id, date: utcDay(10) } },
    });
    expect(Number(fresh.priceMinor)).toBe(75000);
    expect(fresh).toMatchObject({ total: 2, sold: 0, held: 0 });

    await rollAvailabilityForward(30);
    expect(await prisma.inventoryDay.count({ where: { roomTypeId: room.id } })).toBe(30);
    await prisma.$disconnect();
  });
});
