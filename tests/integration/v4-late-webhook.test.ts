import { afterAll, beforeAll, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { describeInt } from "./helpers";
import { createStayFixture, type StayFixture } from "./fixtures";
import {
  handleWebhookEvent,
  latePaymentSuccessTotal,
  payForBooking,
} from "@/lib/payment/payment-service";
import { releaseHold } from "@/lib/booking-service";

/**
 * v4#8: onay penceresi kapandıktan sonra gelen `payment.succeeded` önce mutabakattan geçer.
 */
describeInt("regression: v4#8 geç gelen başarılı webhook önce mutabakat", () => {
  const prisma = new PrismaClient();
  let fx: StayFixture;

  beforeAll(async () => {
    fx = await createStayFixture(prisma, { tag: "v4-8", units: 1 });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function metric(outcome: "reconfirmed" | "refunded"): Promise<number> {
    const { values } = await latePaymentSuccessTotal.get();
    return values.find((v) => v.labels.outcome === outcome)?.value ?? 0;
  }

  /** 3DS bekleyen ödeme; sonra tutma süresi geçer (expire=true → EXPIRED'e döner). */
  async function pendingThenLapsed(startInDays: number, expire: boolean) {
    const b = await fx.hold({ startInDays });
    const out = await payForBooking({
      bookingId: b.id,
      userId: fx.userId,
      cardToken: "tok_mock_3ds_3220",
      idempotencyKey: `v4-8-${b.id}`,
    });
    expect(out.status).toBe("requires_action");
    await prisma.booking.update({
      where: { id: b.id },
      data: { holdExpiresAt: new Date(Date.now() - 1000) },
    });
    if (expire) expect(await releaseHold(b.id)).toBe(true);
    const payment = await prisma.payment.findUniqueOrThrow({ where: { bookingId: b.id } });
    return { booking: b, providerRef: payment.providerRef! };
  }

  function succeeded(providerRef: string, amount: number) {
    return handleWebhookEvent({
      id: `evt_v4_8_${providerRef}`,
      type: "payment.succeeded",
      data: { providerRef, amount, currency: "TRY" },
    });
  }

  it("regression: v4#8 süresi dolmuş rezervasyon, envanter uygunsa yeniden tutulup onaylanır", async () => {
    const before = await metric("reconfirmed");
    const { booking, providerRef } = await pendingThenLapsed(10, true);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe(
      "EXPIRED"
    );

    const res = await succeeded(providerRef, booking.totalMinor);
    expect(res.compensated).toBeUndefined();
    const after = await prisma.booking.findUniqueOrThrow({
      where: { id: booking.id },
      include: { payment: true },
    });
    expect(after.status).toBe("CONFIRMED");
    expect(after.payment?.status).toBe("PAID");
    const day = await prisma.inventoryDay.findFirstOrThrow({
      where: { roomTypeId: fx.roomId, date: after.checkIn },
    });
    expect(day).toMatchObject({ sold: 1, held: 0 });
    expect(await metric("reconfirmed")).toBe(before + 1);
    const log = await prisma.auditLog.findFirstOrThrow({
      where: { action: "payment.late_success", entityId: booking.id },
    });
    expect(log.meta).toMatchObject({ outcome: "reconfirmed" });
    // Aynı olay tekrar: etkisiz.
    expect((await succeeded(providerRef, booking.totalMinor)).duplicate).toBe(true);
  });

  it("regression: v4#8 tutma süresi geçmiş (henüz EXPIRED olmamış) HELD rezervasyon onaylanır", async () => {
    const { booking, providerRef } = await pendingThenLapsed(20, false);
    await succeeded(providerRef, booking.totalMinor);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe(
      "CONFIRMED"
    );
  });

  it("regression: v4#8 envanter artık yoksa iade edilir ve rezervasyon EXPIRED kalır", async () => {
    const before = await metric("refunded");
    const { booking, providerRef } = await pendingThenLapsed(30, true);
    // Bu arada tek oda başka bir misafire satıldı (tutuldu).
    const other = await prisma.user.create({
      data: {
        email: `v4-8-o-${Date.now()}@t.test`,
        passwordHash: "x",
        firstName: "O",
        lastName: "T",
      },
    });
    await fx.hold({ startInDays: 30, userId: other.id });

    const res = await succeeded(providerRef, booking.totalMinor);
    expect(res.compensated).toBe(true);
    const after = await prisma.booking.findUniqueOrThrow({
      where: { id: booking.id },
      include: { payment: true },
    });
    expect(after.status).toBe("EXPIRED");
    expect(after.payment?.status).toBe("REFUNDED");
    expect(after.payment?.failureCode).toBe("BOOKING_NOT_CONFIRMABLE");
    // Telafi olayı kaydedildi; PSP yeniden denemesi ikinci iade üretmez.
    expect(await prisma.paymentEvent.count({ where: { id: `comp:${providerRef}` } })).toBe(1);
    expect((await succeeded(providerRef, booking.totalMinor)).duplicate).toBe(true);
    expect(await metric("refunded")).toBe(before + 1);
    const log = await prisma.auditLog.findFirstOrThrow({
      where: { action: "payment.late_success", entityId: booking.id },
    });
    expect(log.meta).toMatchObject({ outcome: "refunded" });
  });
});
