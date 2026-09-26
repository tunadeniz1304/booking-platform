// test-stabilization (c)2: kilit bekleme bütçesi config'ten gelir (LOCK_WAIT_BUDGET_MS) ve
// bütçe dolduğunda doluluk yeniden kontrol edilir → dolu ise 409 SOLD_OUT, değilse 409 ROOM_BUSY.
// Oda kilidi dışarıdan tutulur; doluluk, kilit denemesi başladığı anda (ilk SET NX) yazılır →
// hızlı yol (kilitsiz ön kontrol) odayı boş görür, kilitli yol bütçeyi tüketir.
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { describeInt, iso, utcDay } from "./helpers";
import { createStayFixture, type StayFixture } from "./fixtures";
import { createBooking } from "@/lib/booking-service";
import { addCartItem, holdCart } from "@/lib/cart";
import { redis } from "@/lib/redis";
import { resetConfigForTests } from "@/lib/config/app-config";
import { HttpError } from "@/lib/http/errors";

const BUDGET_MS = 400;

describeInt("kilit bekleme bütçesi + SOLD_OUT/ROOM_BUSY ayrımı", () => {
  const prisma = new PrismaClient();
  const previous = process.env.LOCK_WAIT_BUDGET_MS;

  beforeAll(() => {
    process.env.LOCK_WAIT_BUDGET_MS = String(BUDGET_MS);
    resetConfigForTests();
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    if (previous === undefined) delete process.env.LOCK_WAIT_BUDGET_MS;
    else process.env.LOCK_WAIT_BUDGET_MS = previous;
    resetConfigForTests();
    await prisma.$disconnect();
  });

  const lockKey = (roomId: string) => `booking:lock:room:${roomId}`;

  /** Başka bir sahibin kilidini taklit eder; dönen fonksiyon kilidi siler. */
  async function holdForeignLock(fx: StayFixture): Promise<() => Promise<void>> {
    await redis.set(lockKey(fx.roomId), "foreign-owner", { ex: 30 });
    return async () => {
      await redis.del(lockKey(fx.roomId));
    };
  }

  /** İlk kilit denemesinde odayı `start..start+nights` için doldurur (sold = total = 1). */
  function fillOnFirstLockAttempt(fx: StayFixture, start: number, nights: number) {
    const original = redis.set.bind(redis);
    let filled = false;
    vi.spyOn(redis, "set").mockImplementation(async (key, value, opts) => {
      if (!filled && key === lockKey(fx.roomId) && opts?.nx) {
        filled = true;
        await prisma.inventoryDay.updateMany({
          where: {
            roomTypeId: fx.roomId,
            date: { gte: utcDay(start), lt: utcDay(start + nights) },
          },
          data: { sold: 1 },
        });
      }
      return original(key, value, opts);
    });
  }

  function book(fx: StayFixture, start: number, nights = 2) {
    return createBooking({
      userId: fx.userId,
      propertyId: fx.propertyId,
      roomId: fx.roomId,
      checkIn: iso(utcDay(start)),
      checkOut: iso(utcDay(start + nights)),
      guestCount: 1,
    });
  }

  function cartItem(fx: StayFixture, start: number, nights = 2) {
    return {
      propertyId: fx.propertyId,
      roomTypeId: fx.roomId,
      checkIn: iso(utcDay(start)),
      checkOut: iso(utcDay(start + nights)),
      adults: 1,
      children: 0,
      quantity: 1,
    };
  }

  it("tekil rezervasyon: kilit meşgul, oda boş → 409 ROOM_BUSY (bütçe config'ten)", async () => {
    const fx = await createStayFixture(prisma, { tag: "lockb-busy" });
    const release = await holdForeignLock(fx);
    try {
      const t0 = Date.now();
      const err = await book(fx, 10).catch((e: unknown) => e);
      const elapsed = Date.now() - t0;
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).status).toBe(409);
      expect((err as HttpError).code).toBe("ROOM_BUSY");
      // Eski sabit bütçe ≈7,5 sn idi; config'teki 400 ms uygulanır.
      expect(elapsed).toBeLessThan(5_000);
    } finally {
      await release();
    }
  });

  it("tekil rezervasyon: kilit beklerken oda doldu → 409 SOLD_OUT", async () => {
    const fx = await createStayFixture(prisma, { tag: "lockb-sold" });
    const release = await holdForeignLock(fx);
    try {
      fillOnFirstLockAttempt(fx, 12, 2);
      const err = await book(fx, 12).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).status).toBe(409);
      expect((err as HttpError).code).toBe("SOLD_OUT");
    } finally {
      await release();
    }
  });

  it("sepet tutma: kilit beklerken kalemin odası doldu → 409 SOLD_OUT + itemId", async () => {
    const fx = await createStayFixture(prisma, { tag: "lockb-cart" });
    const cart = await addCartItem(fx.userId, cartItem(fx, 20));
    const release = await holdForeignLock(fx);
    try {
      fillOnFirstLockAttempt(fx, 20, 2);
      const err = await holdCart(fx.userId).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).status).toBe(409);
      expect((err as HttpError).code).toBe("SOLD_OUT");
      expect((err as HttpError).details).toMatchObject({ itemId: cart.items[0].id });
    } finally {
      await release();
    }
  });

  it("sepet tutma: kilit meşgul, oda boş → 409 ROOM_BUSY", async () => {
    const fx = await createStayFixture(prisma, { tag: "lockb-cartbusy" });
    await addCartItem(fx.userId, cartItem(fx, 30));
    const release = await holdForeignLock(fx);
    try {
      const err = await holdCart(fx.userId).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).code).toBe("ROOM_BUSY");
    } finally {
      await release();
    }
  });
});
