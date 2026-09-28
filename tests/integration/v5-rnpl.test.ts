// P1-3 RNPL (ADR 0028): zamanında tahsilat, başarısız tahsilat → otomatik iptal + envanter geri,
// ücretsiz iptal süresinde iptal → hiç tahsilat yok, Σ=0, RNPL_ENABLED=false.
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { describeInt, utcDay } from "./helpers";
import { createStayFixture, ledgerNetMinor, type StayFixture } from "./fixtures";
import { resetConfigForTests } from "@/lib/config/app-config";
import { MockPsp } from "@/lib/payment/mock-psp";
import { setPaymentProviderForTests } from "@/lib/payment";
import { cancelAndRefund } from "@/lib/payment/payment-service";
import {
  chargeRnplSchedule,
  getRnplOffer,
  getRnplPlan,
  reserveNowPayLater,
  sweepRnplCharges,
} from "@/lib/payment/rnpl";
import { isTrialBalanced, trialBalance } from "@/lib/ledger";

const prisma = new PrismaClient();
const CARD = "tok_mock_ok_424242_4242";
const HOUR = 3_600_000;

/** Kayıtlı kartı kaydeden ama vadede tahsil edemeyen PSP (Stripe 4000…0341 benzeri). */
class LateDeclinePsp extends MockPsp {
  async chargeSaved(input: Parameters<MockPsp["chargeSaved"]>[0]) {
    return {
      status: "declined" as const,
      providerRef: `pi_declined_${input.idempotencyKey}`,
      declineCode: "insufficient_funds",
    };
  }
}

describeInt("P1-3 şimdi rezerve et, sonra öde (RNPL)", () => {
  let fx: StayFixture;
  let startDay = 20;

  async function soldOn(roomId: string, day: number): Promise<number> {
    const row = await prisma.inventoryDay.findFirstOrThrow({
      where: { roomTypeId: roomId, date: utcDay(day) },
      select: { sold: true },
    });
    return row.sold;
  }

  async function rnplBooking(key: string) {
    const start = startDay;
    startDay += 3;
    const held = await fx.hold({ startInDays: start, nights: 2 });
    const outcome = await reserveNowPayLater({
      bookingId: held.id,
      userId: fx.userId,
      cardToken: CARD,
      idempotencyKey: key,
    });
    return { held, outcome, start };
  }

  beforeAll(async () => {
    fx = await createStayFixture(prisma, { tag: "rnpl", days: 90 });
    // Yeni hesap risk kuralı RNPL'yi (yalnız `allow`) engellemesin.
    await prisma.user.update({
      where: { id: fx.userId },
      data: { createdAt: new Date(Date.now() - 400 * 24 * HOUR) },
    });
  });

  afterEach(() => {
    setPaymentProviderForTests(null);
    delete process.env.RNPL_ENABLED;
    resetConfigForTests();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("teklif: bugün 0, vade ücretsiz iptal bitiminden 2 gün önce", async () => {
    const held = await fx.hold({ startInDays: 60, nights: 1 });
    const offer = await getRnplOffer(held.id, fx.userId);
    expect(offer.available).toBe(true);
    expect(offer.dueTodayMinor).toBe(0);
    const deadline = new Date(offer.freeCancellationUntil!).getTime();
    expect(deadline - new Date(offer.dueAt!).getTime()).toBe(2 * 24 * HOUR);
  });

  it("zamanında tahsilat: bugün 0, vadede PAID + booking-captured jurnali", async () => {
    const { held, outcome, start } = await rnplBooking("rnpl-ok");
    expect(outcome.status).toBe("scheduled");
    expect(outcome.amount).toBe(0);
    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id: held.id },
      include: { payment: true, paymentSchedule: true },
    });
    expect(booking.status).toBe("CONFIRMED");
    expect(booking.payment?.status).toBe("PENDING");
    expect(booking.paymentSchedule?.status).toBe("SCHEDULED");
    expect(await soldOn(fx.roomId, start)).toBe(1);
    expect(await ledgerNetMinor(prisma, held.id)).toBe(0);
    // P2-1: rezervasyon detayı planı — bugün 0, vadede toplam; başkasına görünmez.
    const plan = await getRnplPlan(held.id, fx.userId);
    expect(plan).toMatchObject({ status: "SCHEDULED", paidTodayMinor: 0 });
    expect(plan?.amountMinor).toBeGreaterThan(0);
    expect(await getRnplPlan(held.id, "someone-else")).toBeNull();

    // Tekrar çağrı idempotent.
    const again = await reserveNowPayLater({
      bookingId: held.id,
      userId: fx.userId,
      cardToken: CARD,
      idempotencyKey: "rnpl-ok",
    });
    expect(again.paymentId).toBe(outcome.paymentId);

    // Vadeden önce tahsilat yok.
    const early = new Date(new Date(outcome.dueAt).getTime() - HOUR);
    expect(await chargeRnplSchedule(booking.paymentSchedule!.id, early)).toBe("not_due");

    const due = new Date(new Date(outcome.dueAt).getTime() + 60_000);
    expect(await chargeRnplSchedule(booking.paymentSchedule!.id, due)).toBe("captured");
    const after = await prisma.booking.findUniqueOrThrow({
      where: { id: held.id },
      include: { payment: true, paymentSchedule: true },
    });
    expect(after.payment?.status).toBe("PAID");
    expect(after.paymentSchedule?.status).toBe("CAPTURED");
    expect(await ledgerNetMinor(prisma, held.id)).toBe(Number(held.totalMinor));
    // İkinci çalıştırma çift tahsilat yapmaz.
    expect(await chargeRnplSchedule(booking.paymentSchedule!.id, due)).toBe("noop");
    expect(isTrialBalanced(await trialBalance(prisma))).toBe(true);
  });

  it("başarısız tahsilat → bildirim + yeniden deneme, ek süre sonunda iptal + envanter geri", async () => {
    const { held, outcome, start } = await rnplBooking("rnpl-fail");
    setPaymentProviderForTests(new LateDeclinePsp());
    const schedule = await prisma.paymentSchedule.findUniqueOrThrow({
      where: { bookingId: held.id },
    });
    const due = new Date(new Date(outcome.dueAt).getTime() + 60_000);
    expect(await chargeRnplSchedule(schedule.id, due)).toBe("retry_scheduled");
    const retrying = await prisma.paymentSchedule.findUniqueOrThrow({
      where: { id: schedule.id },
    });
    expect(retrying.status).toBe("RETRYING");
    expect(retrying.lastFailureCode).toBe("insufficient_funds");
    const notice = await prisma.outboxMessage.findFirst({
      where: { eventType: "payment.rnpl_charge_failed", aggregateId: schedule.id },
    });
    expect(notice).not.toBeNull();

    // Ek süre (48 sa) dolunca son deneme de düşerse otomatik iptal.
    const graceEnd = new Date(due.getTime() + 48 * HOUR);
    const counts = await sweepRnplCharges(graceEnd);
    expect(counts.defaulted).toBeGreaterThanOrEqual(1);
    const after = await prisma.booking.findUniqueOrThrow({
      where: { id: held.id },
      include: { payment: true, paymentSchedule: true },
    });
    expect(after.status).toBe("CANCELLED");
    expect(after.paymentSchedule?.status).toBe("DEFAULTED");
    expect(after.payment?.status).toBe("VOIDED");
    expect(await soldOn(fx.roomId, start)).toBe(0);
    expect(await ledgerNetMinor(prisma, held.id)).toBe(0);
  });

  it("ücretsiz iptal süresinde iptal → hiç tahsilat yok (Σ=0)", async () => {
    const { held, start } = await rnplBooking("rnpl-cancel");
    const cancelled = await cancelAndRefund(held.id, fx.userId);
    expect(cancelled.refund.refundMinor).toBe(0);
    const after = await prisma.booking.findUniqueOrThrow({
      where: { id: held.id },
      include: { payment: true, paymentSchedule: true },
    });
    expect(after.status).toBe("CANCELLED");
    expect(after.paymentSchedule?.status).toBe("CANCELLED");
    expect(after.payment?.status).toBe("VOIDED");
    expect(await soldOn(fx.roomId, start)).toBe(0);
    // Vade gelse de tahsilat yapılmaz.
    const far = new Date(Date.now() + 365 * 24 * HOUR);
    expect(await chargeRnplSchedule(after.paymentSchedule!.id, far)).toBe("noop");
    expect(await ledgerNetMinor(prisma, held.id)).toBe(0);
    expect(isTrialBalanced(await trialBalance(prisma))).toBe(true);
  });

  it("iade edilemez tarife ve RNPL_ENABLED=false → seçenek yok, istek 409", async () => {
    const held = await fx.hold({ startInDays: 70, nights: 1 });
    const nonref = await prisma.ratePlan.findFirstOrThrow({
      where: { roomTypeId: fx.roomId, refundable: false },
    });
    await prisma.booking.update({ where: { id: held.id }, data: { ratePlanId: nonref.id } });
    expect((await getRnplOffer(held.id, fx.userId)).reason).toBe("NON_REFUNDABLE");

    const other = await fx.hold({ startInDays: 75, nights: 1 });
    process.env.RNPL_ENABLED = "false";
    resetConfigForTests();
    const offer = await getRnplOffer(other.id, fx.userId);
    expect(offer).toMatchObject({ available: false, reason: "DISABLED" });
    await expect(
      reserveNowPayLater({
        bookingId: other.id,
        userId: fx.userId,
        cardToken: CARD,
        idempotencyKey: "rnpl-off",
      })
    ).rejects.toMatchObject({ status: 409, code: "RNPL_UNAVAILABLE" });
    const still = await prisma.booking.findUniqueOrThrow({ where: { id: other.id } });
    expect(still.status).toBe("HELD");
  });
});
