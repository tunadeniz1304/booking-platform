// P1-4 KK: payout yalnızca escrow süresi sonrası; iptal edilen rezervasyon payout üretmez;
// komisyon + rezerv hesapları; her adımda mizan dengede ve mutabakat farkı 0; DAC7 export.
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { PrismaClient } from "@prisma/client";
import { describeInt } from "./helpers";
import { createStayFixture, type StayFixture } from "./fixtures";
import {
  cancelAndRefund,
  confirmPaymentChallenge,
  payForBooking,
} from "@/lib/payment/payment-service";
import { MOCK_3DS_CODE } from "@/lib/payment/card-token";
import { getConfig, resetConfigForTests } from "@/lib/config/app-config";
import { withSerializableRetry } from "@/lib/db/transactions";
import {
  account,
  getAccountBalance,
  isTrialBalanced,
  ledgerImbalanceTotal,
  postRefundFromEscrow,
  reconcile,
  trialBalance,
} from "@/lib/ledger";
import {
  bookingEscrowMinor,
  computeReleaseSplit,
  releaseAt,
  runEscrowRelease,
} from "@/lib/payout/escrow";
import { onboardHostAccount, setPayoutsPaused } from "@/lib/payout/host-account";
import { MockPayoutProvider, PayoutProviderError, setPayoutProviderForTests } from "@/lib/payout";
import { getHostPayoutOverview } from "@/lib/payout/overview";
import { buildDac7Report, loadDac7Activities } from "@/lib/payout/dac7";
import { runPayouts } from "@/worker/jobs/payouts";
import { signAccessToken } from "@/lib/auth/tokens";
import { GET as hostPayoutsGet, POST as hostPayoutsPost } from "@/app/api/host/payouts/route";
import { GET as adminPayoutsGet } from "@/app/api/admin/payouts/route";
import { POST as adminPausePost } from "@/app/api/admin/payouts/[userId]/route";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describeInt("P1-4 escrow → serbest bırakma → payout (+ rezerv, iptal, durdurma, DAC7)", () => {
  const prisma = new PrismaClient();
  let fx: StayFixture;
  let adminId = "";
  let key = 0;
  const touchedPayments = new Set<string>();

  beforeAll(async () => {
    fx = await createStayFixture(prisma, {
      tag: "v4-payouts",
      days: 120,
      country: "Türkiye",
      policyId: "policy_flexible_v1",
    });
    adminId = (
      await prisma.user.create({
        data: {
          email: `po-admin-${Date.now()}@t.test`,
          passwordHash: "x",
          firstName: "Yönetici",
          lastName: "Test",
          role: "ADMIN",
          emailVerifiedAt: new Date(),
        },
      })
    ).id;
  });
  afterEach(() => {
    setPayoutProviderForTests(null);
    delete process.env.PAYOUT_REQUIRE_IDENTITY_VERIFIED;
    resetConfigForTests();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function pay(bookingId: string) {
    let out = await payForBooking({
      bookingId,
      userId: fx.userId,
      cardToken: "tok_mock_ok_4242",
      idempotencyKey: `po-${++key}-${Date.now()}`,
    });
    if (out.status === "requires_action") {
      out = await confirmPaymentChallenge({ bookingId, userId: fx.userId, code: MOCK_3DS_CODE });
    }
    expect(out.status).toBe("confirmed");
    const p = await prisma.payment.findUniqueOrThrow({ where: { bookingId } });
    touchedPayments.add(p.id);
    return p;
  }

  async function bal(kind: "payable" | "reserve", currency = "TRY"): Promise<bigint> {
    const ref =
      kind === "payable" ? account.hostPayable(fx.hostId) : account.hostReserve(fx.hostId);
    return (await getAccountBalance(prisma, ref, currency)).balanceMinor;
  }

  async function imbalanceCount(): Promise<number> {
    const m = await ledgerImbalanceTotal.get();
    return m.values.reduce((s, v) => s + v.value, 0);
  }

  /** Mizan dengede + bu dosyanın ödemeleri için dokunulan günlerde mutabakat farkı 0. */
  async function assertBooksClean(): Promise<void> {
    expect(isTrialBalanced(await trialBalance(prisma))).toBe(true);
    const payments = await prisma.payment.findMany({
      where: { id: { in: [...touchedPayments] } },
      select: { paidAt: true, refundedAt: true },
    });
    const days = new Set<string>();
    for (const p of payments)
      for (const d of [p.paidAt, p.refundedAt]) if (d) days.add(d.toISOString().slice(0, 10));
    for (const day of days) {
      const report = await reconcile(day, prisma);
      expect(report.imbalancedEntries).toBe(0);
      expect(report.differences.filter((d) => touchedPayments.has(d.subjectId))).toEqual([]);
    }
    expect(await imbalanceCount()).toBe(0);
  }

  async function releaseMoment(bookingId: string): Promise<Date> {
    const b = await prisma.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: { checkIn: true, property: { select: { timeZone: true, checkInTime: true } } },
    });
    return releaseAt(b.checkIn, b.property);
  }

  it("payout yalnızca escrow süresi sonrası; komisyon + rezerv; rezerv gün sonra açılır", async () => {
    const cfg = getConfig();
    await onboardHostAccount(fx.hostId);
    const hosts = { userIds: [fx.hostId], hostIds: [fx.hostId] };

    const a = await fx.hold({ nights: 2 });
    await pay(a.id);
    const escrowA = (await bookingEscrowMinor(prisma, a.id)).get("TRY")!;
    expect(escrowA).toBeGreaterThan(0n);
    const due = await releaseMoment(a.id);
    await assertBooksClean();

    // Süre dolmadan: serbest bırakma yok, payout yok.
    const before = new Date(due.getTime() - 60_000);
    expect(await runEscrowRelease(before, { bookingIds: [a.id] })).toEqual({
      released: 0,
      reservesReleased: 0,
    });
    const early = await runPayouts(before, hosts);
    expect(early.hostCreated).toBe(0);
    expect(await prisma.hostPayout.count({ where: { userId: fx.hostId } })).toBe(0);
    expect(await bal("payable")).toBe(0n);

    // Süre dolunca: Dr escrow / Cr platform_revenue + host_reserve + host_payable.
    const after = new Date(due.getTime() + 60_000);
    expect((await runEscrowRelease(after, { bookingIds: [a.id] })).released).toBe(1);
    expect((await runEscrowRelease(after, { bookingIds: [a.id] })).released).toBe(0); // idempotent
    const split = computeReleaseSplit(escrowA, cfg.PLATFORM_COMMISSION_BPS, cfg.PAYOUT_RESERVE_BPS);
    expect(split.feeMinor).toBeGreaterThan(0n);
    expect(split.reserveMinor).toBeGreaterThan(0n);
    expect((await bookingEscrowMinor(prisma, a.id)).get("TRY")).toBe(0n);
    expect(await bal("payable")).toBe(split.hostNetMinor);
    expect(await bal("reserve")).toBe(split.reserveMinor);
    const rel = await prisma.journalEntry.findUniqueOrThrow({
      where: { idempotencyKey: `escrow-released:${a.id}` },
      include: { lines: { include: { account: true } } },
    });
    expect(rel.lines.find((l) => l.account.kind === "PLATFORM_REVENUE")?.amountMinor).toBe(
      split.feeMinor
    );
    await assertBooksClean();

    // Payout: yalnız serbest host_payable (rezerv ödenmez).
    const run1 = await runPayouts(after, hosts);
    expect(run1).toMatchObject({ hostCreated: 1, hostPaid: 1, hostFailed: 0 });
    const p1 = await prisma.hostPayout.findFirstOrThrow({ where: { userId: fx.hostId } });
    expect(p1).toMatchObject({ status: "PAID", amountMinor: split.hostNetMinor, currency: "TRY" });
    expect(p1.reference).toMatch(/^po_mock_[0-9a-f]{24}$/);
    expect(await bal("payable")).toBe(0n);
    expect(await bal("reserve")).toBe(split.reserveMinor);
    // Aynı gün tekrar: takvim (DAILY) + bakiye 0 → yeni payout yok.
    expect((await runPayouts(after, hosts)).hostCreated).toBe(0);
    await assertBooksClean();

    // Rezerv RESERVE_RELEASE_DAYS sonra host_payable'a geçer ve ertesi payout'ta ödenir.
    const almost = new Date(after.getTime() + (cfg.RESERVE_RELEASE_DAYS * DAY - HOUR));
    expect((await runEscrowRelease(almost, hosts)).reservesReleased).toBe(0);
    const later = new Date(after.getTime() + cfg.RESERVE_RELEASE_DAYS * DAY + HOUR);
    expect((await runEscrowRelease(later, hosts)).reservesReleased).toBe(1);
    expect(await bal("reserve")).toBe(0n);
    expect(await bal("payable")).toBe(split.reserveMinor);
    const run2 = await runPayouts(later, hosts);
    expect(run2).toMatchObject({ hostCreated: 1, hostPaid: 1 });
    expect(await bal("payable")).toBe(0n);
    await assertBooksClean();

    // Bakiye özeti + API.
    const overview = await getHostPayoutOverview(fx.hostId);
    const tryRow = overview.balances.find((b) => b.currency === "TRY")!;
    expect(tryRow).toMatchObject({
      availableMinor: 0,
      reserveMinor: 0,
      pendingMinor: 0,
      paidMinor: Number(split.hostNetMinor + split.reserveMinor),
    });
    expect(overview.history.filter((h) => h.kind === "host")).toHaveLength(2);
    const { token } = await signAccessToken(fx.hostId, "HOST", 900);
    const res = await hostPayoutsGet(
      new NextRequest("http://localhost/api/host/payouts", {
        headers: { authorization: `Bearer ${token}` },
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.account).toMatchObject({ provider: "mock", payoutsEnabled: true, connected: true });
    expect(body.history).toHaveLength(2);

    // DAC7: serbest bırakılan bedel, komisyon, 1 işlem, 2 gece.
    const year = after.getUTCFullYear();
    const { activities, sellers } = await loadDac7Activities(year, { hostIds: [fx.hostId] });
    const report = buildDac7Report(year, activities, sellers, { timestamp: new Date() });
    const seller = report.reportableSellers.find((s) => s.sellerRef === fx.hostId)!;
    expect(seller.numberOfActivities.total).toBe(1);
    expect(seller.numberOfDaysRented).toBe(2);
    expect(seller.consideration.total).toBe((Number(escrowA) / 100).toFixed(2));
    expect(seller.fees.total).toBe((Number(split.feeMinor) / 100).toFixed(2));
    expect(seller.identity.name).toBe("Host Test");
  });

  it("iptal edilen (tam iade) rezervasyon serbest bırakılmaz ve payout üretmez", async () => {
    const hosts = { userIds: [fx.hostId] };
    const b = await fx.hold({ nights: 1 });
    await pay(b.id);
    const out = await cancelAndRefund(b.id, fx.userId);
    expect(out.refund.refundPercent).toBe(100);
    expect((await bookingEscrowMinor(prisma, b.id)).get("TRY")).toBe(0n);
    const after = new Date((await releaseMoment(b.id)).getTime() + 90 * DAY);
    expect((await runEscrowRelease(after, { bookingIds: [b.id] })).released).toBe(0);
    expect(
      await prisma.journalEntry.count({ where: { idempotencyKey: `escrow-released:${b.id}` } })
    ).toBe(0);
    const payable = await bal("payable");
    const r = await runPayouts(after, hosts);
    expect(r.hostCreated).toBe(0);
    expect(await bal("payable")).toBe(payable);
    await assertBooksClean();
  });

  it("serbest bırakma sonrası iade önce rezervden + komisyondan düşer (P1-5); defter tutarlı", async () => {
    const cfg = getConfig();
    const c = await fx.hold({ nights: 1 });
    const pc = await pay(c.id);
    const after = new Date((await releaseMoment(c.id)).getTime() + HOUR);
    const escrowC = (await bookingEscrowMinor(prisma, c.id)).get("TRY")!;
    expect((await runEscrowRelease(after, { bookingIds: [c.id] })).released).toBe(1);
    const payableBefore = await bal("payable");
    const reserveBefore = await bal("reserve");
    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: c.id } });
    // İyi niyet iadesi (ör. yönetici): PSP tarafı Payment satırında, defter "released" dalında.
    const refund = 1_000n;
    await withSerializableRetry(async (tx) => {
      await postRefundFromEscrow(tx, {
        refundRef: `goodwill:${c.id}`,
        bookingId: c.id,
        paymentId: pc.id,
        guestId: fx.userId,
        currency: "TRY",
        grossMinor: pc.amountMinor,
        priceBreakdown: booking.priceBreakdown,
        refundMinor: refund,
      });
      await tx.payment.update({
        where: { id: pc.id },
        data: { refundedAmountMinor: refund, refundedAt: new Date() },
      });
    });
    const entry = await prisma.journalEntry.findUniqueOrThrow({
      where: { idempotencyKey: `refund-issued:goodwill:${c.id}` },
      include: { lines: { include: { account: true } } },
    });
    const kinds = entry.lines.map((l) => `${l.side}:${l.account.kind}`).sort();
    // P1-5: ev sahibi payı önce rezervden karşılanır (rezerv yeterli → host_payable'a dokunulmaz).
    expect(kinds).toContain("DEBIT:HOST_RESERVE");
    expect(kinds).not.toContain("DEBIT:HOST_PAYABLE");
    expect(kinds).toContain("DEBIT:PLATFORM_REVENUE");
    expect(kinds).not.toContain("DEBIT:ESCROW");
    const hostDebit = entry.lines.find((l) => l.account.kind === "HOST_RESERVE")!.amountMinor;
    expect(await bal("reserve")).toBe(reserveBefore - hostDebit);
    expect(await bal("payable")).toBe(payableBefore);
    const split = computeReleaseSplit(escrowC, cfg.PLATFORM_COMMISSION_BPS, cfg.PAYOUT_RESERVE_BPS);
    expect(split.hostNetMinor).toBeGreaterThan(hostDebit);
    await assertBooksClean();
  });

  it("yönetici durdurması payout'u engeller, devam ettirince ödenir; sağlayıcı hatası FAILED", async () => {
    const hosts = { userIds: [fx.hostId] };
    const d = await fx.hold({ nights: 1 });
    await pay(d.id);
    const after = new Date((await releaseMoment(d.id)).getTime() + 200 * DAY);
    await runEscrowRelease(after, { bookingIds: [d.id] });
    const available = await bal("payable");
    expect(available).toBeGreaterThan(0n);

    // API ile durdur (ADMIN) → payout açılmaz.
    const { token } = await signAccessToken(adminId, "ADMIN", 900);
    const auth = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const paused = await adminPausePost(
      new NextRequest(`http://localhost/api/admin/payouts/${fx.hostId}`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ paused: true, reason: "şüpheli etkinlik incelemesi" }),
      }),
      { params: Promise.resolve({ userId: fx.hostId }) }
    );
    expect(paused.status).toBe(200);
    expect((await runPayouts(after, hosts)).hostCreated).toBe(0);
    const list = await (
      await adminPayoutsGet(
        new NextRequest("http://localhost/api/admin/payouts", { headers: auth })
      )
    ).json();
    expect(
      list.accounts.find((x: { userId: string }) => x.userId === fx.hostId).payoutsPaused
    ).toBe(true);
    expect(
      await prisma.auditLog.count({ where: { action: "payout.paused", actorId: adminId } })
    ).toBe(1);

    // Devam + sağlayıcı hatası → FAILED, tutar bakiyeye döner.
    await setPayoutsPaused(adminId, fx.hostId, false);
    setPayoutProviderForTests(
      Object.assign(new MockPayoutProvider(), {
        sendPayout: async () => {
          throw new PayoutProviderError("bank_down", "test");
        },
      })
    );
    const failedRun = await runPayouts(after, hosts);
    expect(failedRun).toMatchObject({ hostCreated: 1, hostPaid: 0, hostFailed: 1 });
    const failed = await prisma.hostPayout.findFirstOrThrow({
      where: { userId: fx.hostId, status: "FAILED" },
    });
    expect(failed.failureCode).toBe("bank_down");
    expect(await bal("payable")).toBe(available);

    // Sağlayıcı düzelince aynı gün yeniden açılıp ödenir (FAILED takvimi tüketmez).
    setPayoutProviderForTests(null);
    const ok = await runPayouts(after, hosts);
    expect(ok).toMatchObject({ hostCreated: 1, hostPaid: 1 });
    expect(await bal("payable")).toBe(0n);
    await assertBooksClean();
  });

  it("PAYOUT_REQUIRE_IDENTITY_VERIFIED açıkken doğrulanmamış ev sahibine payout yok", async () => {
    process.env.PAYOUT_REQUIRE_IDENTITY_VERIFIED = "true";
    resetConfigForTests();
    const e = await fx.hold({ nights: 1 });
    await pay(e.id);
    const after = new Date((await releaseMoment(e.id)).getTime() + 300 * DAY);
    await runEscrowRelease(after, { bookingIds: [e.id] });
    expect(await bal("payable")).toBeGreaterThan(0n);
    expect((await runPayouts(after, { userIds: [fx.hostId] })).hostCreated).toBe(0);
    const { token } = await signAccessToken(fx.hostId, "HOST", 900);
    const res = await hostPayoutsPost(
      new NextRequest("http://localhost/api/host/payouts", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ schedule: "WEEKLY" }),
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.account).toMatchObject({
      blockedReason: "IDENTITY_UNVERIFIED",
      payoutSchedule: "WEEKLY",
      kycStatus: "NOT_STARTED",
    });
    await assertBooksClean();
  });
});
