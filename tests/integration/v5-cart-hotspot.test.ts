// v5 P1-8: sepet sıcak noktası — kilit kuyruğunda bekleyen tutma, stok tükenince bütçe sonunu
// beklemeden SOLD_OUT döner; kilidi alan ama stoğu tükenmiş tutma SERIALIZABLE işlemi açmaz.
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { describeInt, iso, utcDay } from "./helpers";
import { createStayFixture, type StayFixture } from "./fixtures";
import { addCartItem, holdCart } from "@/lib/cart";
import { redis } from "@/lib/redis";
import { registry } from "@/lib/observability/metrics";
import { resetConfigForTests } from "@/lib/config/app-config";
import { HttpError } from "@/lib/http/errors";

const BUDGET_MS = 5_000;

describeInt("v5 P1-8 — sepet tutması: stok tükenince kuyruktan erken çıkış", () => {
  const prisma = new PrismaClient();
  const previous = {
    budget: process.env.LOCK_WAIT_BUDGET_MS,
    check: process.env.CART_HOLD_SOLDOUT_CHECK_MS,
  };

  beforeAll(() => {
    process.env.LOCK_WAIT_BUDGET_MS = String(BUDGET_MS);
    process.env.CART_HOLD_SOLDOUT_CHECK_MS = "50";
    resetConfigForTests();
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    for (const [name, value] of [
      ["LOCK_WAIT_BUDGET_MS", previous.budget],
      ["CART_HOLD_SOLDOUT_CHECK_MS", previous.check],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    resetConfigForTests();
    await prisma.$disconnect();
  });

  const lockKey = (roomId: string) => `booking:lock:room:${roomId}`;

  function cartItem(fx: StayFixture, start: number) {
    return {
      propertyId: fx.propertyId,
      roomTypeId: fx.roomId,
      checkIn: iso(utcDay(start)),
      checkOut: iso(utcDay(start + 2)),
      adults: 1,
      children: 0,
      quantity: 1,
    };
  }

  async function metricValue(name: string, match: (labels: Record<string, unknown>) => boolean) {
    const json = await registry.getSingleMetric(name)?.get();
    return json?.values.find((v) => match(v.labels as Record<string, unknown>))?.value ?? 0;
  }
  const holdOutcome = (outcome: string) =>
    metricValue("cart_hold_total", (l) => l.outcome === outcome);
  const criticalCount = () =>
    metricValue("cart_hold_phase_seconds", (l) => l.phase === "critical" && l.le === undefined);

  async function sellOut(fx: StayFixture, start: number) {
    await prisma.inventoryDay.updateMany({
      where: { roomTypeId: fx.roomId, date: { gte: utcDay(start), lt: utcDay(start + 2) } },
      data: { sold: 1 },
    });
  }

  it("kilit başkasında, beklerken oda doldu → bütçe (5 s) dolmadan 409 SOLD_OUT + itemId", async () => {
    const fx = await createStayFixture(prisma, { tag: "p18-wait" });
    const cart = await addCartItem(fx.userId, cartItem(fx, 40));
    await redis.set(lockKey(fx.roomId), "foreign-owner", { ex: 30 });
    try {
      const started = Date.now();
      const pending = holdCart(fx.userId).catch((e: unknown) => e);
      await new Promise((r) => setTimeout(r, 150));
      await sellOut(fx, 40);
      const err = await pending;
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).code).toBe("SOLD_OUT");
      expect((err as HttpError).details).toMatchObject({ itemId: cart.items[0].id });
      expect(Date.now() - started).toBeLessThan(BUDGET_MS / 2);
      // Tümü-ya-hiç: hiçbir tutma kalmadı, sepet OPEN.
      const after = await prisma.cart.findUniqueOrThrow({ where: { id: cart.id } });
      expect(after.status).toBe("OPEN");
      expect(await prisma.booking.count({ where: { cartId: cart.id } })).toBe(0);
    } finally {
      await redis.del(lockKey(fx.roomId));
    }
  });

  it("kilidi alan ama stoğu tükenmiş tutma işlem açmadan SOLD_OUT döner", async () => {
    const fx = await createStayFixture(prisma, { tag: "p18-under" });
    const cart = await addCartItem(fx.userId, cartItem(fx, 50));
    // Yeniden fiyatlama geçtikten sonra, kilit ediniminde oda dolar.
    const originalSet = redis.set.bind(redis);
    vi.spyOn(redis, "set").mockImplementation(async (key, value, opts) => {
      if (key === lockKey(fx.roomId) && opts?.nx) await sellOut(fx, 50);
      return originalSet(key, value, opts);
    });
    const failedBefore = await holdOutcome("failed");
    const criticalBefore = await criticalCount();

    const err = await holdCart(fx.userId).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).code).toBe("SOLD_OUT");
    // İşlem açılmadı: kritik bölge ölçülmedi, sonuç "failed" değil "unavailable".
    expect(await criticalCount()).toBe(criticalBefore);
    expect(await holdOutcome("failed")).toBe(failedBefore);
    expect(await prisma.booking.count({ where: { cartId: cart.id } })).toBe(0);
    expect(await redis.get(lockKey(fx.roomId))).toBeNull(); // kilit bırakıldı
  });
});
