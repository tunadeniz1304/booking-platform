// P1-7 sadakat & cüzdan: seviye + cashback (outbox tüketicisi), krediyle kısmi ödeme sagası,
// iade simetrisi (property), kart hatasında kredi geri, süre dolumu işi, eşzamanlı çift
// harcama. Her adımda mizan dengede + mutabakat farkı 0 + "defter = lot'lar" değişmezi.
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import fc from "fast-check";
import { NextRequest } from "next/server";
import { PrismaClient } from "@prisma/client";
import { describeInt } from "./helpers";
import { createStayFixture, type StayFixture } from "./fixtures";
import { redis } from "@/lib/redis";
import { signAccessToken } from "@/lib/auth/tokens";
import {
  cancelAndRefund,
  confirmPaymentChallenge,
  payForBooking,
  type PayOutcome,
} from "@/lib/payment/payment-service";
import { MOCK_3DS_CODE } from "@/lib/payment/card-token";
import { setPaymentProviderForTests } from "@/lib/payment";
import { injectSagaFaultForTests } from "@/lib/saga/saga";
import { PAYMENT_SAGA, SAGA_STEPS } from "@/lib/saga/booking-saga";
import { withSerializableRetry } from "@/lib/db/transactions";
import { completeStays } from "@/lib/booking/complete-stays";
import type { BookingCompletedPayload } from "@/lib/events/events";
import {
  account,
  getAccountBalance,
  isTrialBalanced,
  post,
  reconcile,
  trialBalance,
} from "@/lib/ledger";
import {
  expireCredits,
  issueDueCashbacks,
  onStayCompleted,
  releaseStaleReservations,
} from "@/lib/wallet/wallet-service";
import { GET as walletRoute } from "@/app/api/account/wallet/route";
import { GET as creditRoute } from "@/app/api/bookings/[id]/credit/route";
import { POST as payRoute } from "@/app/api/bookings/[id]/pay/route";

const DAY = 86_400_000;

describeInt("P1-7 sadakat & cüzdan (integration)", () => {
  const prisma = new PrismaClient();
  let fx: StayFixture;
  let key = 0;
  let lotSeq = 0;
  const touchedPayments = new Set<string>();

  beforeAll(async () => {
    fx = await createStayFixture(prisma, {
      tag: "v4-wallet",
      days: 200,
      units: 3,
      policyId: "policy_flexible_v1",
    });
  });
  beforeEach(async () => {
    await redis.del(`fraud:v:user:${fx.userId}`, "fraud:v:card:tok_mock_ok_4242");
  });
  afterEach(() => {
    injectSagaFaultForTests(PAYMENT_SAGA, null);
    setPaymentProviderForTests(null);
  });
  afterAll(() => prisma.$disconnect());

  /** Test kredisi: platform ikramı jurnali + lot (cashback yolunun aynısı, vade verilebilir). */
  async function grant(userId: string, amountMinor: number, expiresAt: Date): Promise<string> {
    const ref = `test:${Date.now()}:${++lotSeq}`;
    return withSerializableRetry(async (tx) => {
      await post.creditIssued(tx, {
        creditRef: ref,
        guestId: userId,
        amountMinor: BigInt(amountMinor),
        fundedBy: "platform",
        currency: "TRY",
      });
      const lot = await tx.walletCredit.create({
        data: {
          userId,
          currency: "TRY",
          source: "CASHBACK",
          sourceRef: ref,
          amountMinor: BigInt(amountMinor),
          remainingMinor: BigInt(amountMinor),
          expiresAt,
        },
      });
      return lot.id;
    });
  }

  async function ledgerCredit(userId: string): Promise<bigint> {
    return (await getAccountBalance(prisma, account.guestCredit(userId), "TRY")).balanceMinor;
  }

  /** Değişmez: guest_credit = Σ lot kalanı + Σ RESERVED harcama. */
  async function assertWalletInvariant(userId: string): Promise<void> {
    const [lots, reserved] = await Promise.all([
      prisma.walletCredit.aggregate({
        where: { userId, currency: "TRY" },
        _sum: { remainingMinor: true },
      }),
      prisma.creditSpend.aggregate({
        where: { userId, currency: "TRY", status: "RESERVED" },
        _sum: { amountMinor: true },
      }),
    ]);
    expect(await ledgerCredit(userId)).toBe(
      (lots._sum.remainingMinor ?? 0n) + (reserved._sum.amountMinor ?? 0n)
    );
  }

  async function assertBooksClean(userId = fx.userId): Promise<void> {
    expect(isTrialBalanced(await trialBalance(prisma))).toBe(true);
    const payments = await prisma.payment.findMany({
      where: { id: { in: [...touchedPayments] } },
      select: { paidAt: true, refundedAt: true },
    });
    const days = new Set<string>();
    for (const d of payments.flatMap((p) => [p.paidAt, p.refundedAt])) {
      if (d) days.add(d.toISOString().slice(0, 10));
    }
    for (const day of days) {
      const report = await reconcile(day, prisma);
      expect(report.imbalancedEntries).toBe(0);
      expect(report.differences.filter((d) => touchedPayments.has(d.subjectId))).toEqual([]);
    }
    await assertWalletInvariant(userId);
  }

  async function pay(
    bookingId: string,
    creditMinor?: number,
    userId = fx.userId,
    cardToken = "tok_mock_ok_4242"
  ): Promise<PayOutcome> {
    let out = await payForBooking({
      bookingId,
      userId,
      cardToken,
      idempotencyKey: `wallet-${++key}`,
      creditMinor,
    });
    if (out.status === "requires_action") {
      out = await confirmPaymentChallenge({ bookingId, userId, code: MOCK_3DS_CODE });
    }
    const p = await prisma.payment.findUnique({ where: { bookingId } });
    if (p) touchedPayments.add(p.id);
    return out;
  }

  async function escrowAndTax(bookingId: string): Promise<bigint> {
    const lines = await prisma.journalLine.findMany({
      where: { entry: { bookingId }, account: { kind: { in: ["ESCROW", "TAX_PAYABLE"] } } },
      select: { side: true, amountMinor: true },
    });
    return lines.reduce((s, l) => s + (l.side === "CREDIT" ? l.amountMinor : -l.amountMinor), 0n);
  }

  it("konaklama tamamlanınca seviye + iade penceresi sonrası cashback kredisi", async () => {
    const guest = await prisma.user.create({
      data: {
        email: `wallet-cb-${Date.now()}@t.test`,
        passwordHash: "x",
        firstName: "Sadık",
        lastName: "Misafir",
        emailVerifiedAt: new Date(),
      },
    });
    const b = await fx.hold({ nights: 2, userId: guest.id });
    const out = await pay(b.id, undefined, guest.id);
    expect(out.status).toBe("confirmed");

    // Yerel çıkış saati geçtikten sonra (kapsamlı çağrı: yalnız bu rezervasyon).
    const later = new Date(new Date(`${b.checkOut}T00:00:00.000Z`).getTime() + 2 * DAY);
    expect(await completeStays(later, 10, { bookingIds: [b.id] })).toBe(1);
    const msg = await prisma.outboxMessage.findFirstOrThrow({
      where: { aggregateId: b.id, eventType: "booking.completed" },
    });
    const payload = msg.payload as unknown as BookingCompletedPayload;
    await onStayCompleted(payload);
    await onStayCompleted(payload); // tekrar teslim idempotent
    const acct = await prisma.loyaltyAccount.findUniqueOrThrow({ where: { userId: guest.id } });
    expect(acct).toMatchObject({ completedStays: 1, tier: 0 });
    const cb = await prisma.loyaltyCashback.findUniqueOrThrow({ where: { bookingId: b.id } });
    expect(cb).toMatchObject({ status: "PENDING", bps: 100 });

    // Pencere dolmadan verilmez; dolunca kartla ödenen net tutarın %1'i krediye.
    expect(await issueDueCashbacks(new Date(cb.dueAt.getTime() - 1000))).toBe(0);
    expect(await issueDueCashbacks(new Date(cb.dueAt.getTime() + 1000))).toBeGreaterThanOrEqual(1);
    const issued = await prisma.loyaltyCashback.findUniqueOrThrow({ where: { bookingId: b.id } });
    const expected = BigInt(Math.floor((b.totalMinor * 100 + 5_000) / 10_000));
    expect(issued).toMatchObject({ status: "ISSUED", amountMinor: expected });
    expect(await ledgerCredit(guest.id)).toBe(expected);
    const journal = await prisma.journalEntry.findUniqueOrThrow({
      where: { idempotencyKey: `credit-issued:cashback:${b.id}` },
      include: { lines: { include: { account: true } } },
    });
    expect(journal.lines.find((l) => l.account.kind === "PLATFORM_REVENUE")?.side).toBe("DEBIT");
    await assertBooksClean(guest.id);

    // İkinci seviye eşiği (2 konaklama) → seviye 1, cashback oranı 200 bps.
    const b2 = await fx.hold({ nights: 1, userId: guest.id });
    expect((await pay(b2.id, undefined, guest.id)).status).toBe("confirmed");
    const later2 = new Date(new Date(`${b2.checkOut}T00:00:00.000Z`).getTime() + 2 * DAY);
    await completeStays(later2, 10, { bookingIds: [b2.id] });
    const msg2 = await prisma.outboxMessage.findFirstOrThrow({
      where: { aggregateId: b2.id, eventType: "booking.completed" },
    });
    await onStayCompleted(msg2.payload as unknown as BookingCompletedPayload);
    expect(
      await prisma.loyaltyAccount.findUniqueOrThrow({ where: { userId: guest.id } })
    ).toMatchObject({ completedStays: 2, tier: 1 });
    expect(
      await prisma.loyaltyCashback.findUniqueOrThrow({ where: { bookingId: b2.id } })
    ).toMatchObject({ bps: 200 });

    // Cüzdan API'si: bakiye + lot + seviye.
    const { token } = await signAccessToken(guest.id, "USER", 900);
    const res = await (walletRoute as unknown as (req: NextRequest) => Promise<Response>)(
      new NextRequest("http://localhost:3000/api/account/wallet", {
        headers: { authorization: `Bearer ${token}` },
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tier).toBe(1);
    expect(body.balances).toEqual([
      expect.objectContaining({ currency: "TRY", availableMinor: Number(expected) }),
    ]);
    expect(body.lots).toHaveLength(1);
    expect(body.pendingCashback).toHaveLength(1);
  });

  it("krediyle kısmi ödeme: FIFO lot, kart + kredi = toplam, tam iptalde simetrik iade", async () => {
    const soon = await grant(fx.userId, 3_000, new Date(Date.now() + 10 * DAY));
    const late = await grant(fx.userId, 4_000, new Date(Date.now() + 100 * DAY));
    const before = await ledgerCredit(fx.userId);
    await assertBooksClean();

    const b = await fx.hold({ nights: 2 });
    const credit = 5_000;
    const out = await pay(b.id, credit);
    expect(out).toMatchObject({
      status: "confirmed",
      amount: b.totalMinor - credit,
      creditMinor: credit,
    });

    const payment = await prisma.payment.findUniqueOrThrow({ where: { bookingId: b.id } });
    expect(payment.amountMinor).toBe(BigInt(b.totalMinor - credit));
    const spend = await prisma.creditSpend.findFirstOrThrow({
      where: { bookingId: b.id },
      include: { allocations: true },
    });
    expect(spend.status).toBe("SPENT");
    // Son kullanma tarihi yakın lot önce tükenir.
    const byLot = Object.fromEntries(spend.allocations.map((a) => [a.creditId, a.amountMinor]));
    expect(byLot).toEqual({ [soon]: 3_000n, [late]: 2_000n });
    expect(await ledgerCredit(fx.userId)).toBe(before - BigInt(credit));
    // Emanet + vergi = rezervasyon toplamı (kart + kredi).
    expect(await escrowAndTax(b.id)).toBe(BigInt(b.totalMinor));
    await assertBooksClean();

    // Tam iptal (esnek politika, girişe günler var): kart payı karta, kredi payı krediye.
    const cancel = await cancelAndRefund(b.id, fx.userId);
    expect(cancel.refund.refundMinor).toBe(b.totalMinor);
    const refunded = await prisma.payment.findUniqueOrThrow({ where: { bookingId: b.id } });
    expect(refunded.refundedAmountMinor).toBe(BigInt(b.totalMinor - credit));
    expect(await ledgerCredit(fx.userId)).toBe(before);
    expect(await escrowAndTax(b.id)).toBe(0n);
    // İade lot'ları orijinal son kullanma tarihleriyle döner.
    const refundLots = await prisma.walletCredit.findMany({
      where: { userId: fx.userId, source: "REFUND", bookingId: b.id },
    });
    const soonLot = await prisma.walletCredit.findUniqueOrThrow({ where: { id: soon } });
    const lateLot = await prisma.walletCredit.findUniqueOrThrow({ where: { id: late } });
    expect(
      refundLots
        .map((l) => [l.amountMinor, l.expiresAt.getTime()])
        .sort((x, y) => Number(x[1]) - Number(y[1]))
    ).toEqual([
      [3_000n, soonLot.expiresAt.getTime()],
      [2_000n, lateLot.expiresAt.getTime()],
    ]);
    await assertBooksClean();
  });

  it("property: harcama → tam iade sonrası kredi bakiyesi başlangıca eşit", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 100, max: 5_000 }), { minLength: 1, maxLength: 3 }),
        fc.double({ min: 0.05, max: 1, noNaN: true }),
        async (lots, frac) => {
          for (const [i, amount] of lots.entries()) {
            await grant(fx.userId, amount, new Date(Date.now() + (5 + i * 7) * DAY));
          }
          await redis.del(`fraud:v:user:${fx.userId}`, "fraud:v:card:tok_mock_ok_4242");
          const start = await ledgerCredit(fx.userId);
          const b = await fx.hold({ nights: 1 });
          const available = Number(start);
          const cap = Math.min(available, b.totalMinor - 100);
          const use = Math.max(1, Math.floor(cap * frac));
          const out = await pay(b.id, use);
          expect(out.status).toBe("confirmed");
          expect(await ledgerCredit(fx.userId)).toBe(start - BigInt(use));
          await cancelAndRefund(b.id, fx.userId);
          expect(await ledgerCredit(fx.userId)).toBe(start);
          expect(await escrowAndTax(b.id)).toBe(0n);
          await assertBooksClean();
        }
      ),
      { numRuns: 4 }
    );
  });

  it("kart reddi ve saga telafisi → kredi rezervi geri", async () => {
    await grant(fx.userId, 2_000, new Date(Date.now() + 30 * DAY));
    const start = await ledgerCredit(fx.userId);

    // (a) Kart reddi: provizyon yok, rezerv bırakılır.
    const a = await fx.hold({ nights: 1 });
    await expect(pay(a.id, 1_500, fx.userId, "tok_mock_decline_0002")).rejects.toMatchObject({
      code: "PAYMENT_DECLINED",
    });
    const spendA = await prisma.creditSpend.findFirstOrThrow({ where: { bookingId: a.id } });
    expect(spendA).toMatchObject({ status: "RELEASED", releaseReason: "card_declined" });
    await assertWalletInvariant(fx.userId);

    // (b) Capture adımında hata: void + kredi geri + tutma bırakılır.
    const b = await fx.hold({ nights: 1 });
    injectSagaFaultForTests(PAYMENT_SAGA, SAGA_STEPS.capture);
    await expect(pay(b.id, 1_500)).rejects.toThrow();
    injectSagaFaultForTests(PAYMENT_SAGA, null);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe(
      "EXPIRED"
    );
    const spendB = await prisma.creditSpend.findFirstOrThrow({ where: { bookingId: b.id } });
    expect(spendB.status).toBe("RELEASED");

    // (c) Onay adımında hata (capture sonrası): kart iade + kredi geri, jurnalde kredi yok.
    const c = await fx.hold({ nights: 1 });
    injectSagaFaultForTests(PAYMENT_SAGA, SAGA_STEPS.confirm);
    await expect(pay(c.id, 1_500)).rejects.toThrow();
    injectSagaFaultForTests(PAYMENT_SAGA, null);
    const spendC = await prisma.creditSpend.findFirstOrThrow({ where: { bookingId: c.id } });
    expect(spendC.status).toBe("RELEASED");
    expect(
      await prisma.journalEntry.count({ where: { bookingId: c.id, kind: "CREDIT_SPENT" } })
    ).toBe(0);

    expect(await ledgerCredit(fx.userId)).toBe(start);
    await assertBooksClean();
    // Tümü serbest → bir sonraki ödemede aynı kredi kullanılabilir.
    const d = await fx.hold({ nights: 1 });
    expect((await pay(d.id, 1_500)).status).toBe("confirmed");
    await assertBooksClean();
  });

  it("eşzamanlı iki checkout aynı krediyi çift harcayamaz", async () => {
    const racer = await prisma.user.create({
      data: {
        email: `wallet-race-${Date.now()}@t.test`,
        passwordHash: "x",
        firstName: "Yarış",
        lastName: "Test",
        emailVerifiedAt: new Date(),
      },
    });
    await grant(racer.id, 4_000, new Date(Date.now() + 30 * DAY));
    const [x, y] = [
      await fx.hold({ nights: 1, userId: racer.id }),
      await fx.hold({ nights: 1, userId: racer.id }),
    ];
    const results = await Promise.allSettled([
      pay(x.id, 3_000, racer.id),
      pay(y.id, 3_000, racer.id),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0].reason).toMatchObject({ code: "INSUFFICIENT_CREDIT" });
    const spent = await prisma.creditSpend.findMany({
      where: { userId: racer.id, status: { in: ["RESERVED", "SPENT"] } },
    });
    expect(spent).toHaveLength(1);
    expect(await ledgerCredit(racer.id)).toBe(1_000n);
    await assertBooksClean(racer.id);
  });

  it("süre dolumu işi: kalan ters jurnalle düşer, tekrar koşu no-op; bayat rezerv bırakılır", async () => {
    const owner = await prisma.user.create({
      data: {
        email: `wallet-exp-${Date.now()}@t.test`,
        passwordHash: "x",
        firstName: "Süre",
        lastName: "Test",
        emailVerifiedAt: new Date(),
      },
    });
    const expiresAt = new Date(Date.now() + 2 * DAY);
    const lotId = await grant(owner.id, 2_500, expiresAt);
    const after = new Date(expiresAt.getTime() + 1000);
    expect(await expireCredits(new Date(expiresAt.getTime() - 1000))).toBe(0);
    expect(await expireCredits(after)).toBeGreaterThanOrEqual(1);
    expect(await expireCredits(after)).toBe(0);
    const lot = await prisma.walletCredit.findUniqueOrThrow({ where: { id: lotId } });
    expect(lot).toMatchObject({ remainingMinor: 0n, expiredMinor: 2_500n });
    expect(await ledgerCredit(owner.id)).toBe(0n);
    const entry = await prisma.journalEntry.findUniqueOrThrow({
      where: { idempotencyKey: `credit-expired:${lotId}:0` },
    });
    expect(entry.kind).toBe("CREDIT_EXPIRED");

    // Rezervdeyken dolan lot: rezerv bırakılınca dönen tutar ayrı jurnalle düşer.
    const lot2 = await grant(owner.id, 1_000, new Date(Date.now() + 3 * DAY));
    const h = await fx.hold({ nights: 1, userId: owner.id });
    await payForBooking({
      bookingId: h.id,
      userId: owner.id,
      cardToken: "tok_mock_3ds_3220",
      idempotencyKey: `wallet-exp-${++key}`,
      creditMinor: 600,
    }); // 3DS bekliyor → kredi RESERVED
    await assertWalletInvariant(owner.id);
    const exp2 = new Date(Date.now() + 3 * DAY + 1000);
    await expireCredits(exp2); // kalan 400 düşer
    await prisma.booking.update({ where: { id: h.id }, data: { status: "EXPIRED" } });
    expect(await releaseStaleReservations()).toBeGreaterThanOrEqual(1);
    await expireCredits(exp2); // bırakılan 600 düşer
    const l2 = await prisma.walletCredit.findUniqueOrThrow({ where: { id: lot2 } });
    expect(l2).toMatchObject({ remainingMinor: 0n, expiredMinor: 1_000n });
    expect(await ledgerCredit(owner.id)).toBe(0n);
    await assertBooksClean(owner.id);
  });

  it("HTTP: kredi seçenekleri (sahiplik 404) + asgari kart tutarı sınırı 409", async () => {
    const b = await fx.hold({ nights: 1 });
    await grant(fx.userId, b.totalMinor, new Date(Date.now() + 30 * DAY));
    const { token } = await signAccessToken(fx.userId, "USER", 900);
    const auth = { authorization: `Bearer ${token}` };
    const opts = await creditRoute(
      new NextRequest(`http://localhost:3000/api/bookings/${b.id}/credit`, { headers: auth }),
      { params: Promise.resolve({ id: b.id }) }
    );
    expect(opts.status).toBe(200);
    const body = await opts.json();
    expect(body.maxUsableMinor).toBe(b.totalMinor - 100);

    const { token: other } = await signAccessToken(fx.hostId, "HOST", 900);
    const denied = await creditRoute(
      new NextRequest(`http://localhost:3000/api/bookings/${b.id}/credit`, {
        headers: { authorization: `Bearer ${other}` },
      }),
      { params: Promise.resolve({ id: b.id }) }
    );
    expect(denied.status).toBe(404);

    const tooMuch = await payRoute(
      new NextRequest(`http://localhost:3000/api/bookings/${b.id}/pay`, {
        method: "POST",
        headers: { ...auth, "content-type": "application/json", "idempotency-key": `w-${++key}` },
        body: JSON.stringify({ cardToken: "tok_mock_ok_4242", creditMinor: b.totalMinor }),
      }),
      { params: Promise.resolve({ id: b.id }) }
    );
    expect(tooMuch.status).toBe(409);
    expect((await tooMuch.json()).code).toBe("CREDIT_EXCEEDS_LIMIT");
  });
});
