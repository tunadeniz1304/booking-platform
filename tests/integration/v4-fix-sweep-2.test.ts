// fix-sweep-2 (ödeme tarafı): kümülatif iade toplamı (talep iadesi + iptal), bölünmüş ödemede
// talep iadesi/depozito, kaybedilen itirazın jurnali, Stripe depozito için kayıtlı kart,
// PSP provizyon hatasının 502 + yeniden denenebilir durumu. Her adımda mizan dengede +
// dokunulan günlerde mutabakat farkı 0 (yalnız bu dosyanın ödemeleri).
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { describeInt } from "./helpers";
import { createStayFixture, type StayFixture } from "./fixtures";
import {
  cancelAndRefund,
  confirmPaymentChallenge,
  payForBooking,
  retryFailedRefund,
} from "@/lib/payment/payment-service";
import { MOCK_3DS_CODE } from "@/lib/payment/card-token";
import { MockPsp } from "@/lib/payment/mock-psp";
import { setPaymentProviderForTests } from "@/lib/payment";
import type { Money } from "@/lib/money/money";
import { isTrialBalanced, reconcile, trialBalance } from "@/lib/ledger";
import { releaseAt } from "@/lib/payout/escrow";
import type { AccessClaims } from "@/lib/auth";
import { decideClaim, openClaim } from "@/lib/resolution/claims";

const HOUR = 3_600_000;
const claims = (userId: string, role: AccessClaims["role"]): AccessClaims => ({
  userId,
  role,
  jti: "j",
  exp: 0,
  tv: 0,
});

/** İade çağrılarını kaydeden, istenirse belirli anahtarda bir kez düşen MockPsp. */
class RecordingPsp extends MockPsp {
  refunds: Array<{ ref: string; amount: number; key: string }> = [];
  failRefundKeys = new Set<string>();
  override async refund(providerRef: string, amount: Money, idempotencyKey: string) {
    if (this.failRefundKeys.delete(idempotencyKey)) {
      const { PaymentProviderError } = await import("@/lib/payment/provider");
      throw new PaymentProviderError("processing_error", "sahte iade hatası");
    }
    this.refunds.push({ ref: providerRef, amount: amount.amount, key: idempotencyKey });
    return super.refund(providerRef, amount, idempotencyKey);
  }
}

describeInt("fix-sweep-2: ödeme düzeltmeleri", () => {
  const prisma = new PrismaClient();
  let fx: StayFixture;
  let adminId = "";
  let key = 0;
  const psp = new RecordingPsp();
  const touchedBookings = new Set<string>();

  beforeAll(async () => {
    fx = await createStayFixture(prisma, {
      tag: "v4-fix-sweep-2",
      days: 150,
      country: "Türkiye",
      policyId: "policy_flexible_v1",
    });
    adminId = (
      await prisma.user.create({
        data: {
          email: `fs2-admin-${Date.now()}@t.test`,
          passwordHash: "x",
          firstName: "Yönetici",
          lastName: "Test",
          role: "ADMIN",
          emailVerifiedAt: new Date(),
        },
      })
    ).id;
    setPaymentProviderForTests(psp);
  });
  afterEach(() => {
    psp.failRefundKeys.clear();
  });
  afterAll(async () => {
    setPaymentProviderForTests(null);
    await prisma.$disconnect();
  });

  const admin = () => claims(adminId, "ADMIN");

  async function pay(bookingId: string, userId = fx.userId) {
    let out = await payForBooking({
      bookingId,
      userId,
      cardToken: "tok_mock_ok_4242",
      idempotencyKey: `fs2-${++key}-${Date.now()}`,
    });
    if (out.status === "requires_action") {
      out = await confirmPaymentChallenge({ bookingId, userId, code: MOCK_3DS_CODE });
    }
    expect(out.status).toBe("confirmed");
    touchedBookings.add(bookingId);
    return prisma.payment.findUniqueOrThrow({ where: { bookingId } });
  }

  async function checkInOf(bookingId: string): Promise<Date> {
    const b = await prisma.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: { checkIn: true, property: { select: { timeZone: true, checkInTime: true } } },
    });
    return releaseAt(b.checkIn, b.property, 0);
  }

  /** Mizan dengede + bu dosyanın rezervasyonlarının jurnal/ödeme günlerinde fark 0. */
  async function assertBooksClean(): Promise<void> {
    expect(isTrialBalanced(await trialBalance(prisma))).toBe(true);
    const ids = [...touchedBookings];
    const [entries, payments] = await Promise.all([
      prisma.journalEntry.findMany({
        where: { bookingId: { in: ids } },
        select: { occurredAt: true },
      }),
      prisma.payment.findMany({
        where: { bookingId: { in: ids } },
        select: { id: true, paidAt: true, refundedAt: true },
      }),
    ]);
    const days = new Set<string>();
    for (const e of entries) days.add(e.occurredAt.toISOString().slice(0, 10));
    for (const p of payments)
      for (const d of [p.paidAt, p.refundedAt]) if (d) days.add(d.toISOString().slice(0, 10));
    const paymentIds = new Set(payments.map((p) => p.id));
    for (const day of days) {
      const report = await reconcile(day, prisma);
      expect(report.imbalancedEntries).toBe(0);
      expect(
        report.differences.filter((d) => paymentIds.has(d.subjectId) || ids.includes(d.bookingId))
      ).toEqual([]);
    }
  }

  async function guestRefundClaim(bookingId: string, amountMinor: number) {
    const checkInAt = await checkInOf(bookingId);
    const claim = await openClaim(
      claims(fx.userId, "USER"),
      { bookingId, type: "GUEST_REFUND", amountMinor, description: "Klima çalışmadı" },
      new Date(checkInAt.getTime() + HOUR)
    );
    return decideClaim(
      admin(),
      claim.id,
      { decision: "APPROVE", note: "Haklı" },
      new Date(checkInAt.getTime() + 2 * HOUR)
    );
  }

  async function cancelCardCredit(bookingId: string): Promise<bigint> {
    const entry = await prisma.journalEntry.findUnique({
      where: { idempotencyKey: `refund-issued:cancel:${bookingId}` },
      select: { lines: { select: { side: true, amountMinor: true, account: true } } },
    });
    return (entry?.lines ?? [])
      .filter((l) => l.side === "CREDIT" && l.account.kind === "PSP_CLEARING")
      .reduce((s, l) => s + l.amountMinor, 0n);
  }

  it("[BUG] talep iadesi sonrası iptal (konaklama başladıktan sonra): iade toplamı ezilmez", async () => {
    const g = await fx.hold({ nights: 2 });
    const payment = await pay(g.id);
    const res = await guestRefundClaim(g.id, 10_000);
    expect(res.settledMinor).toBe(10_000n);

    const checkInAt = await checkInOf(g.id);
    const out = await cancelAndRefund(g.id, fx.userId, new Date(checkInAt.getTime() + 3 * HOUR));
    expect(out.refund.refundMinor).toBe(0); // no-show kuralı
    const after = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    // Eskiden 0'a ezilip PAID'e dönüyordu → mutabakat farkı 10_000.
    expect(after).toMatchObject({
      refundedAmountMinor: 10_000n,
      status: "PARTIALLY_REFUNDED",
    });
    expect(await cancelCardCredit(g.id)).toBe(0n);
    await assertBooksClean();
  });

  it("talep iadesi + iptal: iptal yalnız KALAN tutarı iade eder; toplam = tahsilat; çift iade yok", async () => {
    const g = await fx.hold({ nights: 2 });
    const payment = await pay(g.id);
    await guestRefundClaim(g.id, 12_345);
    const paid = Number(payment.amountMinor);
    const remaining = paid - 12_345;

    // Politika tam iade dönemindeyken iptal (kalan üzerinden %100).
    psp.refunds = [];
    const out = await cancelAndRefund(g.id, fx.userId, new Date(Date.now() + 60_000));
    expect(out.refund.refundMinor).toBe(remaining);
    expect(psp.refunds).toEqual([
      expect.objectContaining({ amount: remaining, key: `refund:${g.id}` }),
    ]);
    const after = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(after).toMatchObject({ refundedAmountMinor: BigInt(paid), status: "REFUNDED" });
    expect(await cancelCardCredit(g.id)).toBe(BigInt(remaining));
    await assertBooksClean();
  });

  it("refund-retry: talep iadesinden sonra düşen iptal iadesi yalnız iptal tutarıyla yeniden denenir", async () => {
    const g = await fx.hold({ nights: 2 });
    const payment = await pay(g.id);
    await guestRefundClaim(g.id, 5_000);
    const remaining = Number(payment.amountMinor) - 5_000;

    psp.failRefundKeys.add(`refund:${g.id}`);
    await cancelAndRefund(g.id, fx.userId, new Date(Date.now() + 60_000));
    const failed = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(failed).toMatchObject({
      failureCode: "REFUND_FAILED",
      refundedAmountMinor: payment.amountMinor,
    });

    psp.refunds = [];
    expect(await retryFailedRefund(g.id)).toBe("refunded");
    // Kümülatif toplam (talep dahil) DEĞİL, yalnız iptalin kart iadesi.
    expect(psp.refunds).toEqual([
      expect.objectContaining({ amount: remaining, key: `refund:${g.id}` }),
    ]);
    const done = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(done).toMatchObject({ failureCode: null, refundedAmountMinor: payment.amountMinor });
    await assertBooksClean();
  });
});
