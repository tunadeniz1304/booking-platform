// fix-sweep-2 (ödeme tarafı): kümülatif iade toplamı (talep iadesi + iptal), bölünmüş ödemede
// talep iadesi/depozito, kaybedilen itirazın jurnali, Stripe depozito için kayıtlı kart,
// PSP provizyon hatasının 502 + yeniden denenebilir durumu. Her adımda mizan dengede +
// dokunulan günlerde mutabakat farkı 0 (yalnız bu dosyanın ödemeleri).
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { PrismaClient } from "@prisma/client";
import { describeInt, iso, utcDay } from "./helpers";
import { createStayFixture, type StayFixture } from "./fixtures";
import {
  cancelAndRefund,
  confirmPaymentChallenge,
  payForBooking,
  retryFailedRefund,
} from "@/lib/payment/payment-service";
import { MOCK_3DS_CODE } from "@/lib/payment/card-token";
import { MockPsp } from "@/lib/payment/mock-psp";
import { PaymentProviderError, setPaymentProviderForTests } from "@/lib/payment";
import { signAccessToken } from "@/lib/auth/tokens";
import { POST as payPost } from "@/app/api/bookings/[id]/pay/route";
import type { Money } from "@/lib/money/money";
import { account, getAccountBalance, isTrialBalanced, reconcile, trialBalance } from "@/lib/ledger";
import { releaseAt, runEscrowRelease } from "@/lib/payout/escrow";
import { getConfig } from "@/lib/config/app-config";
import { handleDisputeEvent } from "@/lib/resolution/disputes";
import { authorizeDeposit } from "@/lib/resolution/deposit";
import {
  addCartItem,
  confirmShareChallenge,
  createSplitPlan,
  holdCart,
  payShare,
  type ShareOutcome,
} from "@/lib/cart";
import type { WebhookEvent } from "@/lib/payment/webhook";
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
  /** Sonraki provizyonlar sağlayıcı hatasıyla düşer (P2-3: 5xx/zaman aşımı taklidi). */
  failAuthorize = 0;
  override async authorize(input: Parameters<MockPsp["authorize"]>[0]) {
    if (this.failAuthorize > 0) {
      this.failAuthorize--;
      throw new PaymentProviderError("api_connection_error", "sahte bağlantı hatası");
    }
    return super.authorize(input);
  }
  override async refund(providerRef: string, amount: Money, idempotencyKey: string) {
    if (this.failRefundKeys.delete(idempotencyKey)) {
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
    psp.failAuthorize = 0;
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
        report.differences.filter(
          (d) => paymentIds.has(d.subjectId) || (d.bookingId !== null && ids.includes(d.bookingId))
        )
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

  it("P2-3: PSP provizyon hatası → 502 PAYMENT_PROVIDER_ERROR; ödeme FAILED ve yeniden denenebilir", async () => {
    const g = await fx.hold({ nights: 1 });
    const { token } = await signAccessToken(fx.userId, "USER", 900);
    const call = (idem: string) =>
      payPost(
        new NextRequest(`http://localhost/api/bookings/${g.id}/pay`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            "idempotency-key": idem,
          },
          body: JSON.stringify({ cardToken: "tok_mock_ok_4242" }),
        }),
        { params: Promise.resolve({ id: g.id }) }
      );
    psp.failAuthorize = 1;
    const res = await call(`fs2-p23-${Date.now()}`);
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({
      code: "PAYMENT_PROVIDER_ERROR",
      details: { providerCode: "api_connection_error" },
    });
    expect(res.headers.get("retry-after")).toBe("5");
    const failed = await prisma.payment.findUniqueOrThrow({ where: { bookingId: g.id } });
    expect(failed).toMatchObject({
      status: "FAILED",
      failureCode: "provider_error:api_connection_error",
      providerRef: null,
    });
    expect(
      (await prisma.booking.findUniqueOrThrow({ where: { id: g.id }, select: { status: true } }))
        .status
    ).toBe("HELD");

    // Aynı rezervasyon yeniden denenir → onay (3DS gerekirse tamamlanır).
    const retry = await call(`fs2-p23b-${Date.now()}`);
    expect([200, 202]).toContain(retry.status);
    if (retry.status === 202) {
      await confirmPaymentChallenge({ bookingId: g.id, userId: fx.userId, code: MOCK_3DS_CODE });
    }
    const paid = await prisma.payment.findUniqueOrThrow({ where: { bookingId: g.id } });
    expect(paid).toMatchObject({ status: "PAID", failureCode: null });
    touchedBookings.add(g.id);
    await assertBooksClean();
  });

  async function loseDispute(providerRef: string, amountMinor: number, now = new Date()) {
    const disputeId = `dp_fs2_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const event = (type: string, n: number, status: string) =>
      ({
        id: `evt_${disputeId}_${n}`,
        type,
        data: {
          providerRef,
          amount: amountMinor,
          currency: "TRY",
          disputeId,
          disputeStatus: status,
          reason: "fraudulent",
        },
      }) as unknown as WebhookEvent;
    await handleDisputeEvent(event("dispute.created", 1, "needs_response"), now);
    await handleDisputeEvent(event("dispute.closed", 2, "lost"), now);
    // Tekrar (replay) ikinci jurnal üretmez.
    expect((await handleDisputeEvent(event("dispute.closed", 2, "lost"), now)).duplicate).toBe(
      true
    );
    const claim = await prisma.claim.findUniqueOrThrow({ where: { externalRef: disputeId } });
    const entry = await prisma.journalEntry.findUnique({
      where: { idempotencyKey: `chargeback-lost:${claim.id}` },
      include: { lines: { include: { account: true } } },
    });
    const debit = (kind: string) =>
      (entry?.lines ?? [])
        .filter((l) => l.account.kind === kind && l.side === "DEBIT")
        .reduce((sum, l) => sum + l.amountMinor, 0n);
    const pspOut = (entry?.lines ?? [])
      .filter((l) => l.account.kind === "PSP_CLEARING" && l.side === "CREDIT")
      .reduce((sum, l) => sum + l.amountMinor, 0n);
    return { claim, entry, debit, pspOut };
  }

  it("kaybedilen itiraz (serbest bırakma öncesi): para emanetten karta döner; talep tutarları; sonraki talep/iptal kalanla sınırlı", async () => {
    const g = await fx.hold({ nights: 2 });
    const payment = await pay(g.id);
    const half = Number(payment.amountMinor) / 2;
    const { claim, entry, debit, pspOut } = await loseDispute(payment.providerRef!, half);
    expect(claim).toMatchObject({
      status: "RESOLVED_APPROVED",
      awardedMinor: BigInt(half),
      settledMinor: BigInt(half),
      platformCoveredMinor: 0n,
      uncollectedMinor: 0n,
    });
    expect(entry?.kind).toBe("CHARGEBACK_LOST");
    expect(pspOut).toBe(BigInt(half));
    expect(debit("ESCROW")).toBeGreaterThan(0n);
    expect(debit("PLATFORM_LOSS")).toBe(0n);
    await assertBooksClean();

    // Misafir talebi artık yalnız kalan tutar kadar olabilir.
    const checkInAt = await checkInOf(g.id);
    await expect(
      openClaim(
        claims(fx.userId, "USER"),
        {
          bookingId: g.id,
          type: "GUEST_REFUND",
          amountMinor: half + 1,
          description: "itirazdan sonra fazla talep",
        },
        new Date(checkInAt.getTime() + HOUR)
      )
    ).rejects.toMatchObject({ code: "CLAIM_AMOUNT_EXCEEDS_REFUNDABLE" });

    // İptal (tam iade döneminde) itirazla dönen parayı ikinci kez iade etmez.
    psp.refunds = [];
    const out = await cancelAndRefund(g.id, fx.userId, new Date(Date.now() + 60_000));
    expect(out.refund.refundMinor).toBe(Number(payment.amountMinor) - half);
    expect(psp.refunds.map((r) => r.amount)).toEqual([Number(payment.amountMinor) - half]);
    await assertBooksClean();
  });

  it("kaybedilen itiraz (serbest bırakma sonrası): ev sahibinden rezerv → bakiye, yetmezse platform_loss; host eksiye düşmez", async () => {
    const fx2 = await createStayFixture(prisma, {
      tag: "v4-fs2-chargeback",
      days: 60,
      country: "Türkiye",
      policyId: "policy_flexible_v1",
    });
    const g = await fx2.hold({ nights: 2 });
    const payment = await pay(g.id, fx2.userId);
    const checkInAt = await checkInOf(g.id);
    const releasedAt = new Date(
      checkInAt.getTime() + getConfig().PAYOUT_RELEASE_HOURS * HOUR + HOUR
    );
    expect((await runEscrowRelease(releasedAt, { bookingIds: [g.id] })).released).toBe(1);
    const bal = async (ref: ReturnType<typeof account.hostPayable>) =>
      (await getAccountBalance(prisma, ref, "TRY")).balanceMinor;
    const reserve0 = await bal(account.hostReserve(fx2.hostId));
    const payable0 = await bal(account.hostPayable(fx2.hostId));
    expect(reserve0).toBeGreaterThan(0n);
    // Kullanılabilir bakiyenin tamamı bekleyen payout'ta → yalnız rezerv kullanılabilir.
    await prisma.hostPayout.create({
      data: { userId: fx2.hostId, amountMinor: payable0, currency: "TRY", provider: "mock" },
    });

    const amount = Number(payment.amountMinor);
    const { claim, debit, pspOut } = await loseDispute(
      payment.providerRef!,
      amount,
      new Date(releasedAt.getTime() + HOUR)
    );
    expect(pspOut).toBe(BigInt(amount));
    expect(debit("HOST_RESERVE")).toBe(reserve0);
    expect(debit("HOST_PAYABLE")).toBe(0n);
    const loss = debit("PLATFORM_LOSS");
    expect(loss).toBeGreaterThan(0n);
    expect(claim).toMatchObject({
      awardedMinor: BigInt(amount),
      platformCoveredMinor: loss,
      settledMinor: BigInt(amount) - loss,
      uncollectedMinor: 0n,
    });
    expect(await bal(account.hostReserve(fx2.hostId))).toBe(0n);
    expect(await bal(account.hostPayable(fx2.hostId))).toBe(payable0);
    expect(
      (await getAccountBalance(prisma, account.platformLoss(), "TRY")).balanceMinor
    ).toBeGreaterThanOrEqual(loss);
    await prisma.hostPayout.deleteMany({ where: { userId: fx2.hostId } });
    await assertBooksClean();
  });

  it("bölünmüş ödeme: talep iadesi paylara oransal; PSP hatasında yeniden deneme çift iade yapmaz; iptal kalanı paylara; depozito organizatör payından", async () => {
    const a = await createStayFixture(prisma, {
      tag: "fs2-split-a",
      units: 2,
      country: "Türkiye",
      policyId: "policy_flexible_v1",
    });
    const b = await createStayFixture(prisma, {
      tag: "fs2-split-b",
      units: 2,
      country: "Türkiye",
      policyId: "policy_flexible_v1",
    });
    const mkUser = async (tag: string) =>
      prisma.user.create({
        data: {
          email: `fs2-${tag}-${Date.now()}@t.test`,
          passwordHash: "x",
          firstName: tag,
          lastName: "Test",
          emailVerifiedAt: new Date(),
        },
      });
    const organizer = await mkUser("org");
    const friend = await mkUser("friend");
    const item = (fxI: StayFixture) => ({
      propertyId: fxI.propertyId,
      roomTypeId: fxI.roomId,
      checkIn: iso(utcDay(20)),
      checkOut: iso(utcDay(22)),
      adults: 1,
      children: 0,
      quantity: 1,
    });
    await addCartItem(organizer.id, item(a));
    await addCartItem(organizer.id, item(b));
    const cart = await holdCart(organizer.id);
    const plan = await createSplitPlan({
      cartId: cart.id,
      userId: organizer.id,
      mode: "equal",
      participants: [{ email: friend.email }],
    });
    const token = (position: number) =>
      decodeURIComponent(
        plan.shares.find((x) => x.position === position)!.inviteUrl!.split("/pay/share/")[1]
      );
    const payAs = async (position: number, userId: string): Promise<ShareOutcome> => {
      let out = await payShare({
        token: token(position),
        userId,
        cardToken: "tok_mock_ok_4242",
        idempotencyKey: `fs2-share-${position}-${Date.now()}`,
        context: { ip: `10.77.0.${position + 1}` },
      });
      if (out.status === "requires_action") {
        out = await confirmShareChallenge({
          token: token(position),
          userId,
          code: MOCK_3DS_CODE,
        });
      }
      return out;
    };
    expect((await payAs(1, friend.id)).status).toBe("authorized");
    expect((await payAs(0, organizer.id)).status).toBe("confirmed");

    const bookings = await prisma.booking.findMany({
      where: { cartId: cart.id },
      include: { payment: true },
      orderBy: { createdAt: "asc" },
    });
    for (const bk of bookings) touchedBookings.add(bk.id);
    const bookingA = bookings.find((x) => x.propertyId === a.propertyId)!;
    const bookingB = bookings.find((x) => x.propertyId === b.propertyId)!;
    expect(bookingA.payment?.providerRef).toBeNull();
    const shares = await prisma.paymentShare.findMany({
      where: { cartId: cart.id },
      orderBy: { position: "asc" },
    });
    expect(shares.every((x) => x.status === "CAPTURED")).toBe(true);

    // (1) Misafir talebi (organizatör) artık açılabilir; ilk karar denemesinde 2. payın
    // iadesi düşer → 502, talep açık kalır; yeniden deneme yalnız eksik payı iade eder.
    const checkInAt = await checkInOf(bookingA.id);
    const guestClaims = claims(organizer.id, "USER");
    const claim = await openClaim(
      guestClaims,
      { bookingId: bookingA.id, type: "GUEST_REFUND", amountMinor: 10_001, description: "Isıtma" },
      new Date(checkInAt.getTime() + HOUR)
    );
    psp.refunds = [];
    psp.failRefundKeys.add(`claim-refund:${claim.id}:${shares[1].id}`);
    await expect(
      decideClaim(
        admin(),
        claim.id,
        { decision: "APPROVE", note: "Haklı" },
        new Date(checkInAt.getTime() + 2 * HOUR)
      )
    ).rejects.toMatchObject({ code: "CLAIM_REFUND_FAILED" });
    expect(psp.refunds).toHaveLength(1);
    expect((await prisma.claim.findUniqueOrThrow({ where: { id: claim.id } })).status).toBe(
      "AWAITING_RESPONSE"
    );
    const res = await decideClaim(
      admin(),
      claim.id,
      { decision: "APPROVE", note: "Haklı" },
      new Date(checkInAt.getTime() + 3 * HOUR)
    );
    expect(res.settledMinor).toBe(10_001n);
    expect(psp.refunds).toHaveLength(2);
    expect(new Set(psp.refunds.map((r) => r.key)).size).toBe(2);
    expect(psp.refunds.reduce((sum, r) => sum + r.amount, 0)).toBe(10_001);
    // Oransal: eşit paylarda kalan kuruş organizatöre (pozisyon 0).
    const splitRows = await prisma.claimShareRefund.findMany({
      where: { claimId: claim.id },
      orderBy: { createdAt: "asc" },
    });
    expect(splitRows.every((r) => r.status === "DONE")).toBe(true);
    const byShare = new Map(splitRows.map((r) => [r.shareId, r.amountMinor]));
    expect(byShare.get(shares[0].id)! - byShare.get(shares[1].id)!).toBeGreaterThanOrEqual(0n);
    expect(byShare.get(shares[0].id)! - byShare.get(shares[1].id)!).toBeLessThanOrEqual(1n);
    const payA = await prisma.payment.findUniqueOrThrow({ where: { bookingId: bookingA.id } });
    expect(payA).toMatchObject({ refundedAmountMinor: 10_001n, status: "PARTIALLY_REFUNDED" });
    await assertBooksClean();

    // (2) İptal: kalan tutar paylara; paylardan iade edilen toplam = A'nın tahsilatı.
    psp.refunds = [];
    const out = await cancelAndRefund(bookingA.id, organizer.id, new Date(Date.now() + 60_000));
    expect(out.refund.refundMinor).toBe(Number(payA.amountMinor) - 10_001);
    expect(psp.refunds.reduce((sum, r) => sum + r.amount, 0)).toBe(
      Number(payA.amountMinor) - 10_001
    );
    const after = await prisma.paymentShare.findMany({ where: { cartId: cart.id } });
    expect(after.reduce((sum, x) => sum + x.refundedAmountMinor, 0n)).toBe(payA.amountMinor);
    expect(
      await prisma.payment.findUniqueOrThrow({ where: { bookingId: bookingA.id } })
    ).toMatchObject({ refundedAmountMinor: payA.amountMinor, status: "REFUNDED" });
    await assertBooksClean();

    // (3) Depozito (B): kaynak organizatörün payı (katılımcı kartı kullanılmaz).
    const deposit = await prisma.damageDeposit.create({
      data: {
        bookingId: bookingB.id,
        amountMinor: 20_000n,
        currency: "TRY",
        provider: "mock",
        authorizeAfter: new Date(Date.now() - 1000),
        voidAfter: new Date(Date.now() + 30 * 24 * HOUR),
      },
    });
    expect(await authorizeDeposit(deposit.id)).toBe("authorized");
    expect(
      await prisma.damageDeposit.findUniqueOrThrow({ where: { id: deposit.id } })
    ).toMatchObject({ status: "AUTHORIZED", sourcePaymentRef: shares[0].providerRef });
  });
});
