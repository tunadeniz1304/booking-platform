import { beforeAll, afterAll, afterEach, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { describeInt } from "./helpers";
import { createStayFixture, ledgerNetMinor, type StayFixture } from "./fixtures";
import { payForBooking } from "@/lib/payment/payment-service";
import { MockPsp } from "@/lib/payment/mock-psp";
import { setPaymentProviderForTests } from "@/lib/payment";
import { injectSagaFaultForTests, sagaCompensationTotal } from "@/lib/saga/saga";
import {
  FULFILMENT_SAGA,
  PAYMENT_SAGA,
  SAGA_STEPS,
  inlineFlow,
  setFulfilmentFlowForTests,
  startBookingFulfilment,
} from "@/lib/saga/booking-saga";
import type { Money } from "@/lib/money/money";

class CountingPsp extends MockPsp {
  captures: string[] = [];
  voids: string[] = [];
  refunds: string[] = [];
  override async capture(ref?: string) {
    this.captures.push(ref ?? "");
    return { status: "captured" as const };
  }
  override async void(ref?: string) {
    this.voids.push(ref ?? "");
    return { status: "voided" as const };
  }
  override async refund(ref: string, amount: Money, key: string) {
    this.refunds.push(ref);
    return super.refund(ref, amount, key);
  }
}

async function compensations(): Promise<number> {
  const { values } = await sagaCompensationTotal.get();
  return values
    .filter((v) => v.labels.saga === PAYMENT_SAGA && v.labels.outcome === "ok")
    .reduce((acc, v) => acc + v.value, 0);
}

describeInt("P0-7 ödeme sagası: hata enjeksiyonu + telafi (integration)", () => {
  const prisma = new PrismaClient();
  let fx: StayFixture;

  beforeAll(async () => {
    fx = await createStayFixture(prisma, { tag: "saga" });
  });
  afterEach(() => {
    injectSagaFaultForTests(PAYMENT_SAGA, null);
    injectSagaFaultForTests(FULFILMENT_SAGA, null);
    setPaymentProviderForTests(null);
    setFulfilmentFlowForTests(null);
  });
  afterAll(() => prisma.$disconnect());

  const cases = [
    { step: SAGA_STEPS.hold, voided: 1, refunded: 0 },
    { step: SAGA_STEPS.authorize, voided: 1, refunded: 0 },
    { step: SAGA_STEPS.capture, voided: 1, refunded: 0 },
    { step: SAGA_STEPS.confirm, voided: 0, refunded: 1 },
  ];
  for (const c of cases) {
    it(`${c.step} adımında hata → tutma bırakılır, para iade/void, defter dengede`, async () => {
      const psp = new CountingPsp();
      setPaymentProviderForTests(psp);
      const b = await fx.hold();
      const before = await compensations();
      injectSagaFaultForTests(PAYMENT_SAGA, c.step);

      await expect(
        payForBooking({
          bookingId: b.id,
          userId: fx.userId,
          cardToken: "tok_mock_ok_4242",
          idempotencyKey: `saga-${c.step}`,
        })
      ).rejects.toThrow();

      const booking = await prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
      expect(booking.status).toBe("EXPIRED");
      expect(await ledgerNetMinor(prisma, b.id)).toBe(0);
      expect(psp.voids).toHaveLength(c.voided);
      expect(psp.refunds).toHaveLength(c.refunded);
      expect(psp.captures.length - psp.refunds.length).toBe(0);
      const payment = await prisma.payment.findUnique({ where: { bookingId: b.id } });
      expect(payment?.status).not.toBe("PAID");
      expect(await compensations()).toBeGreaterThan(before);
    });
  }

  it("onay sonrası fatura hatası → rezervasyon onaylı kalır, akış yeniden denenince tamamlanır", async () => {
    setPaymentProviderForTests(new CountingPsp());
    setFulfilmentFlowForTests(inlineFlow);
    const b = await fx.hold();
    const out = await payForBooking({
      bookingId: b.id,
      userId: fx.userId,
      cardToken: "tok_mock_ok_4242",
      idempotencyKey: "saga-fulfil",
    });
    expect(out.status).toBe("confirmed");
    const payload = {
      bookingId: b.id,
      propertyId: fx.propertyId,
      roomId: fx.roomId,
      checkIn: b.checkIn,
      checkOut: b.checkOut,
      userId: fx.userId,
      totalMinor: b.totalMinor,
      currency: out.status === "confirmed" ? out.currency : "TRY",
      paymentId: out.status === "confirmed" ? out.paymentId : "",
    };
    const mails = () =>
      prisma.notification.count({ where: { dedupeKey: `booking.confirmed:${b.id}` } });

    injectSagaFaultForTests(FULFILMENT_SAGA, SAGA_STEPS.invoice);
    await expect(startBookingFulfilment(payload)).rejects.toThrow();
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe(
      "CONFIRMED"
    );
    expect(await ledgerNetMinor(prisma, b.id)).toBe(b.totalMinor);
    expect(await mails()).toBe(0);

    injectSagaFaultForTests(FULFILMENT_SAGA, null);
    await startBookingFulfilment(payload);
    await startBookingFulfilment(payload);
    expect(await prisma.invoice.count({ where: { bookingId: b.id } })).toBe(1);
    expect(await mails()).toBe(1);
  });
});
