import { it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { describeInt } from "./helpers";
import { appendOutbox, relayOutbox } from "@/lib/cqrs";
import { EventTypes, makeEvent } from "@/lib/events/events";
import { registerEventHandlers } from "@/lib/events/register";

describeInt("regression: #22 yeni mülk embedding'i (integration)", () => {
  it("PropertyCreated olayı işçide tüketilince embedding yazılır", async () => {
    const prisma = new PrismaClient();
    registerEventHandlers();
    const stamp = Date.now();
    const host = await prisma.user.create({
      data: { email: `emb-${stamp}@t.test`, passwordHash: "x", firstName: "E", lastName: "M" },
    });
    const loc = await prisma.location.create({
      data: { city: `EmbCity-${stamp}`, country: "TEST" },
    });
    const property = await prisma.property.create({
      data: {
        licenseStatus: "VERIFIED",
        hostId: host.id,
        title: "Deniz manzaralı butik otel",
        description: "Kahvaltı dahil, havuzlu",
        propertyType: "HOTEL",
        locationId: loc.id,
        basePriceMinor: 90000n,
      },
    });
    await appendOutbox(
      prisma,
      makeEvent(EventTypes.PropertyCreated, property.id, "property", {
        propertyId: property.id,
        hostId: host.id,
      })
    );
    await relayOutbox(500);
    const rows = await prisma.$queryRaw<
      Array<{ has: boolean }>
    >`SELECT embedding IS NOT NULL AS has FROM "Property" WHERE id = ${property.id}`;
    expect(rows[0].has).toBe(true);
    await prisma.$disconnect();
  });
});
