import { beforeAll, beforeEach, afterAll, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { describeInt, iso, utcDay } from "./helpers";
import { createStayFixture, type StayFixture } from "./fixtures";
import {
  completeCheckoutSession,
  createCheckoutSession,
  getCheckoutSession,
  updateCheckoutSession,
} from "@/lib/agentic/checkout";
import { registerEventHandlers } from "@/lib/events/register";
import { inlineFlow, setFulfilmentFlowForTests } from "@/lib/saga/booking-saga";
import { redis } from "@/lib/redis";
import { mandated } from "../support/mandate";

describeInt("ajan checkout oturumları (P1-11, integration)", () => {
  const prisma = new PrismaClient();
  let fx: StayFixture;
  let strangerId = "";
  let day = 10;

  function stay(nights = 2) {
    const start = day;
    day += nights + 1;
    return {
      room_id: fx.roomId,
      check_in: iso(utcDay(start)),
      check_out: iso(utcDay(start + nights)),
      guests: 1,
    };
  }
  const key = () => `k-${Math.random().toString(36).slice(2)}`;

  beforeAll(async () => {
    registerEventHandlers();
    setFulfilmentFlowForTests(inlineFlow);
    fx = await createStayFixture(prisma, { tag: "acs", units: 3 });
    const stranger = await prisma.user.create({
      data: {
        email: `acs-s-${Date.now()}@t.test`,
        passwordHash: "x",
        firstName: "S",
        lastName: "T",
      },
    });
    strangerId = stranger.id;
  });

  beforeEach(async () => {
    await redis.del(
      `fraud:v:user:${fx.userId}`,
      "fraud:v:card:tok_mock_ok_0000",
      "fraud:v:card:tok_mock_3ds_0000"
    );
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("regression: v3#11 oluşturma teklifi sabitler; aynı anahtar + gövde aynı oturumu döner", async () => {
    const k = key();
    const input = stay();
    const first = await createCheckoutSession(fx.userId, k, input);
    expect(first.created).toBe(true);
    expect(first.session.status).toBe("ready_for_payment");
    expect(first.session.stay.property_id).toBe(fx.propertyId);
    const total = first.session.totals.find((t) => t.type === "total")!.amount;
    expect(total).toBeGreaterThan(0);

    const replay = await createCheckoutSession(fx.userId, k, input);
    expect(replay.created).toBe(false);
    expect(replay.session.id).toBe(first.session.id);
  });

  it("regression: v3#11 aynı Idempotency-Key farklı gövdeyle 409", async () => {
    const k = key();
    await createCheckoutSession(fx.userId, k, stay());
    await expect(createCheckoutSession(fx.userId, k, stay())).rejects.toMatchObject({
      status: 409,
      code: "IDEMPOTENCY_KEY_REUSED",
    });
  });

  it("regression: v3#11 başka kullanıcı oturumu göremez/güncelleyemez/tamamlayamaz (404)", async () => {
    const { session } = await createCheckoutSession(fx.userId, key(), stay());
    await expect(getCheckoutSession(strangerId, session.id)).rejects.toMatchObject({ status: 404 });
    await expect(
      updateCheckoutSession(strangerId, session.id, { guests: 2 })
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      completeCheckoutSession(
        strangerId,
        session.id,
        key(),
        await mandated(fx.userId, session, "spt_mock_ok")
      )
    ).rejects.toMatchObject({ status: 404 });
  });

  it("güncelleme yeniden teklif üretir", async () => {
    const { session } = await createCheckoutSession(fx.userId, key(), stay(1));
    const updated = await updateCheckoutSession(fx.userId, session.id, stay(3));
    const t = (s: typeof session) => s.totals.find((x) => x.type === "total")!.amount;
    expect(t(updated)).toBeGreaterThan(t(session));
  });

  it("regression: v3#11 spt_mock_ok aynı saga ile CONFIRMED; tekrar tamamlama idempotent", async () => {
    const { session } = await createCheckoutSession(fx.userId, key(), stay());
    const payKey = key();
    const done = await completeCheckoutSession(
      fx.userId,
      session.id,
      payKey,
      await mandated(fx.userId, session, "spt_mock_ok")
    );
    expect(done.status).toBe("completed");
    expect(done.order).not.toBeNull();
    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: done.order!.id } });
    expect(booking.status).toBe("CONFIRMED");
    expect(booking.userId).toBe(fx.userId);

    const again = await completeCheckoutSession(
      fx.userId,
      session.id,
      payKey,
      await mandated(fx.userId, session, "spt_mock_ok")
    );
    expect(again.order).toEqual(done.order);
    expect(await prisma.payment.count({ where: { bookingId: booking.id } })).toBe(1);
  });

  it("3DS gerektiren SPT oturumu in_progress + next_action yapar", async () => {
    const { session } = await createCheckoutSession(fx.userId, key(), stay());
    const res = await completeCheckoutSession(
      fx.userId,
      session.id,
      key(),
      await mandated(fx.userId, session, "spt_mock_3ds")
    );
    expect(res.status).toBe("in_progress");
    expect(res.next_action?.type).toBe("three_ds");
    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: res.order!.id } });
    expect(booking.status).toBe("HELD");
  });

  it("red 402 döner, oturum açık kalır", async () => {
    const { session } = await createCheckoutSession(fx.userId, key(), stay());
    await expect(
      completeCheckoutSession(
        fx.userId,
        session.id,
        key(),
        await mandated(fx.userId, session, "spt_mock_decline")
      )
    ).rejects.toMatchObject({ status: 402 });
    const after = await getCheckoutSession(fx.userId, session.id);
    expect(after.status).toBe("ready_for_payment");
  });

  it("tanınmayan SPT 400 ve PSP'ye gitmez", async () => {
    const { session } = await createCheckoutSession(fx.userId, key(), stay());
    await expect(
      completeCheckoutSession(
        fx.userId,
        session.id,
        key(),
        await mandated(fx.userId, session, "tok_mock_ok_4242")
      )
    ).rejects.toMatchObject({ status: 400 });
    expect((await getCheckoutSession(fx.userId, session.id)).order).toBeNull();
  });

  it("regression: v3#11 fiyat değiştiyse 409 PRICE_CHANGED ve rezervasyon açılmaz", async () => {
    const input = stay(1);
    const { session } = await createCheckoutSession(fx.userId, key(), input);
    await prisma.inventoryDay.updateMany({
      where: { roomTypeId: fx.roomId, date: new Date(`${input.check_in}T00:00:00.000Z`) },
      data: { priceMinor: 432100n },
    });
    await expect(
      completeCheckoutSession(
        fx.userId,
        session.id,
        key(),
        await mandated(fx.userId, session, "spt_mock_ok")
      )
    ).rejects.toMatchObject({ status: 409, code: "PRICE_CHANGED" });
    const after = await getCheckoutSession(fx.userId, session.id);
    expect(after.order).toBeNull();
    expect(after.totals).not.toEqual(session.totals);
  });

  it("süresi dolan oturum iptal edilir ve tamamlanamaz", async () => {
    const { session } = await createCheckoutSession(fx.userId, key(), stay());
    await prisma.checkoutSession.update({
      where: { id: session.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await getCheckoutSession(fx.userId, session.id)).status).toBe("canceled");
    await expect(
      completeCheckoutSession(
        fx.userId,
        session.id,
        key(),
        await mandated(fx.userId, session, "spt_mock_ok")
      )
    ).rejects.toMatchObject({ status: 409 });
  });
});
