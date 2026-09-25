import { beforeAll, afterAll, afterEach, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { describeInt } from "./helpers";
import { createStayFixture, ledgerNetMinor, type StayFixture } from "./fixtures";
import {
  confirmInTransaction,
  handleWebhookEvent,
  payForBooking,
} from "@/lib/payment/payment-service";
import { MockPsp } from "@/lib/payment/mock-psp";
import { setPaymentProviderForTests } from "@/lib/payment";
import { withSerializableRetry } from "@/lib/db/transactions";
import type { Money } from "@/lib/money/money";

/** MockPsp + çağrı sayaçları (capture / void / refund). */
class CountingPsp extends MockPsp {
  captures: string[] = [];
  voids: string[] = [];
  refunds: Array<{ ref: string; key: string; amount: number }> = [];
  override async capture(ref?: string) {
    this.captures.push(ref ?? "");
    return { status: "captured" as const };
  }
  override async void(ref?: string) {
    this.voids.push(ref ?? "");
    return { status: "voided" as const };
  }
  override async refund(ref: string, amount: Money, key: string) {
    this.refunds.push({ ref, key, amount: amount.amount });
    return super.refund(ref, amount, key);
  }
}

describeInt("v3 ödeme doğruluğu: çift tahsilat ve webhook (integration)", () => {
  const prisma = new PrismaClient();
  let fx: StayFixture;
  let psp: CountingPsp;

  beforeAll(async () => {
    fx = await createStayFixture(prisma, { tag: "payrace" });
  });
  afterEach(() => setPaymentProviderForTests(null));
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("regression: v3#1 50 paralel ödeme (farklı Idempotency-Key) → tam 1 capture, defter = toplam", async () => {
    psp = new CountingPsp();
    setPaymentProviderForTests(psp);
    const b = await fx.hold();
    const results = await Promise.allSettled(
      Array.from({ length: 50 }, (_, i) =>
        payForBooking({
          bookingId: b.id,
          userId: fx.userId,
          cardToken: "tok_mock_ok_4242",
          idempotencyKey: `tab-${i}`,
        })
      )
    );
    const confirmed = results.filter(
      (r) => r.status === "fulfilled" && r.value.status === "confirmed"
    );
    // Kilidi bekleyemeyenler 409 PAYMENT_IN_PROGRESS alabilir; hiçbiri ikinci kez tahsil etmez.
    for (const r of results) {
      if (r.status === "rejected") expect(r.reason).toMatchObject({ status: 409 });
    }
    expect(confirmed.length).toBeGreaterThanOrEqual(1);
    const netCaptures = psp.captures.length - psp.refunds.length;
    expect(netCaptures).toBe(1);
    expect(await ledgerNetMinor(prisma, b.id)).toBe(b.totalMinor);
    const payment = await prisma.payment.findUniqueOrThrow({ where: { bookingId: b.id } });
    expect(payment.status).toBe("PAID");
    // SQL çift-capture sorgusu: aynı rezervasyon için birden fazla CHARGE satırı yok.
    const dup = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM (
        SELECT "bookingId" FROM "LedgerEntry" WHERE kind = 'CHARGE'
        GROUP BY "bookingId" HAVING count(*) > 1
      ) t`;
    expect(Number(dup[0].n)).toBe(0);
  });

  it("regression: v3#1 PAID ödeme satırı başka bir yetkilendirmeyle ezilmez (kilit kaybı senaryosu)", async () => {
    psp = new CountingPsp();
    setPaymentProviderForTests(psp);
    const b = await fx.hold();
    const first = await payForBooking({
      bookingId: b.id,
      userId: fx.userId,
      cardToken: "tok_mock_ok_4242",
      idempotencyKey: "a",
    });
    expect(first.status).toBe("confirmed");
    const paid = await prisma.payment.findUniqueOrThrow({ where: { bookingId: b.id } });
    // Kaybeden bir yetkilendirmenin onayı (ör. kilit süresi dolmuş ikinci süreç) reddedilir.
    await expect(
      withSerializableRetry((tx) => confirmInTransaction(tx, b.id, "pi_mock_loser"))
    ).rejects.toMatchObject({ code: "ALREADY_PAID" });
    // Aynı providerRef ile tekrar → idempotent.
    await expect(
      withSerializableRetry((tx) => confirmInTransaction(tx, b.id, paid.providerRef!))
    ).resolves.toBe(paid.id);
    const after = await prisma.payment.findUniqueOrThrow({ where: { bookingId: b.id } });
    expect(after.providerRef).toBe(paid.providerRef);
    expect(after.status).toBe("PAID");
    expect(await ledgerNetMinor(prisma, b.id)).toBe(b.totalMinor);
  });

  it("regression: v3#2 HOLD_EXPIRED webhook → otomatik iade + PaymentEvent; retry duplicate", async () => {
    psp = new CountingPsp();
    setPaymentProviderForTests(psp);
    const b = await fx.hold();
    const out = await payForBooking({
      bookingId: b.id,
      userId: fx.userId,
      cardToken: "tok_mock_3ds_3220",
      idempotencyKey: "exp",
    });
    expect(out.status).toBe("requires_action");
    const ref = (await prisma.payment.findUniqueOrThrow({ where: { bookingId: b.id } }))
      .providerRef!;
    await prisma.booking.update({
      where: { id: b.id },
      data: { holdExpiresAt: new Date(Date.now() - 60_000) },
    });
    const event = {
      id: `evt_exp_${b.id}`,
      type: "payment.succeeded" as const,
      data: { providerRef: ref, amount: b.totalMinor, currency: "TRY" },
    };
    expect(await handleWebhookEvent(event)).toEqual({ duplicate: false, compensated: true });
    const payment = await prisma.payment.findUniqueOrThrow({ where: { bookingId: b.id } });
    expect(payment.status).toBe("REFUNDED");
    expect(payment.failureCode).toBe("HOLD_EXPIRED");
    expect(psp.refunds).toEqual([
      expect.objectContaining({ ref, key: `compensate:${ref}`, amount: b.totalMinor }),
    ]);
    expect(await prisma.paymentEvent.count({ where: { id: event.id } })).toBe(1);
    expect(await prisma.paymentEvent.count({ where: { id: `comp:${ref}` } })).toBe(1);
    // PSP yeniden dener → etki yok, ikinci iade yok.
    expect(await handleWebhookEvent(event)).toEqual({ duplicate: true });
    expect(psp.refunds).toHaveLength(1);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("HELD");
  });

  it("regression: v3#2 tutar/para birimi uyuşmazlığı → 400 + audit, etki yok", async () => {
    psp = new CountingPsp();
    setPaymentProviderForTests(psp);
    const b = await fx.hold();
    await payForBooking({
      bookingId: b.id,
      userId: fx.userId,
      cardToken: "tok_mock_3ds_3220",
      idempotencyKey: "mm",
    });
    const ref = (await prisma.payment.findUniqueOrThrow({ where: { bookingId: b.id } }))
      .providerRef!;
    const event = {
      id: `evt_mm_${b.id}`,
      type: "payment.succeeded" as const,
      data: { providerRef: ref, amount: 1, currency: "TRY" },
    };
    await expect(handleWebhookEvent(event)).rejects.toMatchObject({
      status: 400,
      code: "WEBHOOK_MISMATCH",
    });
    await expect(
      handleWebhookEvent({
        ...event,
        id: `${event.id}_cur`,
        data: { providerRef: ref, currency: "USD" },
      })
    ).rejects.toMatchObject({ status: 400 });
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("HELD");
    expect(await prisma.paymentEvent.count({ where: { id: event.id } })).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: { action: "payment.webhook_mismatch", entityId: b.id },
      })
    ).toBe(2);
    // Doğru tutarla gelen olay işlenir.
    expect(
      await handleWebhookEvent({
        ...event,
        id: `${event.id}_ok`,
        data: { providerRef: ref, amount: b.totalMinor, currency: "TRY" },
      })
    ).toEqual({ duplicate: false });
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe(
      "CONFIRMED"
    );
  });
});
