// v4#19: kanal ARI fiyatları minor-unit / ondalık string; float kabul edilmez.
import { beforeAll, afterAll, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { describeInt, iso, utcDay } from "./helpers";
import { createStayFixture, type StayFixture } from "./fixtures";
import { applyAriMessage } from "@/lib/channel/channel";

describeInt("regression: v4#19 ARI fiyatı parseMoney ile (integration)", () => {
  const prisma = new PrismaClient();
  let fx: StayFixture;
  let seq = 0;

  const priceOf = async (day: number) =>
    (
      await prisma.inventoryDay.findUniqueOrThrow({
        where: { roomTypeId_date: { roomTypeId: fx.roomId, date: utcDay(day) } },
      })
    ).price.toString();

  const msg = (updates: unknown[]) => ({
    roomId: fx.roomId,
    sequence: ++seq,
    idempotencyKey: `v4ari-${seq}-${Date.now()}`,
    updates: updates as never,
  });

  beforeAll(async () => {
    fx = await createStayFixture(prisma, { tag: "v4ari" });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("ondalık string ve priceMinor tam kuruşla yazılır", async () => {
    const res = await applyAriMessage(
      msg([
        { date: iso(utcDay(10)), price: "1234.56" },
        { date: iso(utcDay(11)), priceMinor: 99_999 },
      ])
    );
    expect(res).toEqual({ status: "applied", applied: 2 });
    expect(await priceOf(10)).toBe("1234.56");
    expect(await priceOf(11)).toBe("999.99");
  });

  it("float (number) fiyat, fazla basamak ve float artığı 400; hiçbir gece değişmez", async () => {
    const before = await priceOf(12);
    for (const bad of [1234.5, "12.345", String(0.1 + 0.2), "1e3"]) {
      await expect(
        applyAriMessage(
          msg([
            { date: iso(utcDay(13)), price: "500" },
            { date: iso(utcDay(12)), price: bad },
          ])
        )
      ).rejects.toMatchObject({ status: 400 });
    }
    expect(await priceOf(12)).toBe(before);
    expect(await priceOf(13)).not.toBe("500");
  });
});
