// P1-2 KK: bölünmüş ödeme — 3 kişilik senaryo; 1 kişi ödemezse (a) organizatör kalanını öder
// veya (b) tüm paylar void/iade ve tutmalar serbest; ledger dengede, mutabakat 0. Ayrıca çift
// ödeme yarışı, süre sonu ↔ son ödeme yarışı, imzasız/süresi geçmiş link 4xx ve sepet/pay için
// geç gelen başarılı webhook (v4#8 deseni).
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { PrismaClient } from "@prisma/client";
import { describeInt, iso, utcDay } from "./helpers";
import { createStayFixture, type StayFixture } from "./fixtures";
import {
  addCartItem,
  confirmCartChallenge,
  confirmShareChallenge,
  createSplitPlan,
  expireCarts,
  getSplitPlan,
  holdCart,
  payCart,
  payShare,
  processSplitDeadline,
  releaseCartWithSplit,
  signShareToken,
  sweepSplitDeadlines,
  SPLIT_PAYMENT_SAGA,
  type CartDTO,
  type ShareOutcome,
  type SplitPlanDTO,
} from "@/lib/cart";
import { cartLateSuccessTotal } from "@/lib/cart/cart-webhook";
import { cancelAndRefund, handleWebhookEvent } from "@/lib/payment/payment-service";
import { MOCK_3DS_CODE } from "@/lib/payment/card-token";
import { setPaymentProviderForTests } from "@/lib/payment";
import { MockPsp } from "@/lib/payment/mock-psp";
import { injectSagaFaultForTests } from "@/lib/saga/saga";
import { resetConfigForTests } from "@/lib/config/app-config";
import { isTrialBalanced, ledgerImbalanceTotal, reconcile, trialBalance } from "@/lib/ledger";
import { HttpError } from "@/lib/http/errors";
import { signAccessToken } from "@/lib/auth/tokens";
import { notifySplitShareInvited } from "@/lib/notifications/split-notifications";
import * as shareRoute from "@/app/api/pay/share/[token]/route";
import * as splitRoute from "@/app/api/cart/[id]/split/route";

interface U {
  id: string;
  email: string;
}

/** PSP çağrılarını sayan mock (authorize/capture/void/refund). */
class SpyPsp extends MockPsp {
  authorized: string[] = [];
  captured: string[] = [];
  voided: string[] = [];
  refunded: Array<{ ref: string; amount: number; key: string }> = [];
  override async authorize(input: Parameters<MockPsp["authorize"]>[0]) {
    const r = await super.authorize(input);
    if (r.status !== "declined") this.authorized.push(r.providerRef);
    return r;
  }
  override async capture(ref?: string) {
    if (ref) this.captured.push(ref);
    return super.capture();
  }
  override async void(ref?: string) {
    if (ref) this.voided.push(ref);
    return super.void();
  }
  override async refund(ref: string, amount: Parameters<MockPsp["refund"]>[1], key: string) {
    this.refunded.push({ ref, amount: amount.amount, key });
    return super.refund(ref, amount, key);
  }
}

describeInt("P1-2 bölünmüş ödeme: paylar, süre sonu, yarışlar, geç webhook", () => {
  const prisma = new PrismaClient();
  let seq = 0;
  let psp: SpyPsp;

  async function newUser(tag: string, verified = true): Promise<U> {
    const u = await prisma.user.create({
      data: {
        email: `split-${tag}-${Date.now()}-${++seq}@t.test`,
        passwordHash: "x",
        firstName: `Split${seq}`,
        lastName: "Test",
        emailVerifiedAt: verified ? new Date() : null,
      },
    });
    return { id: u.id, email: u.email };
  }

  function item(fx: StayFixture, start: number, nights = 2) {
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

  async function heldCart(tag: string, start: number, units = 3) {
    const a = await createStayFixture(prisma, { tag: `${tag}-a`, units, nightlyPrice: 1000.01 });
    const b = await createStayFixture(prisma, { tag: `${tag}-b`, units, nightlyPrice: 333.33 });
    const organizer = await newUser(`${tag}-org`);
    await addCartItem(organizer.id, item(a, start));
    await addCartItem(organizer.id, item(b, start));
    const cart = await holdCart(organizer.id);
    expect(cart.status).toBe("HELD");
    return { a, b, organizer, cart };
  }

  const tokenOf = (plan: SplitPlanDTO, position: number) => {
    const url = plan.shares.find((s) => s.position === position)?.inviteUrl;
    expect(url).toBeTruthy();
    return decodeURIComponent(url!.split("/pay/share/")[1]);
  };

  const ctx = () => ({ ip: `10.9.${seq % 250}.${++seq % 250}` });

  async function pay(token: string, user: U, key = `k-${++seq}`): Promise<ShareOutcome> {
    let out = await payShare({
      token,
      userId: user.id,
      cardToken: "tok_mock_ok_4242",
      idempotencyKey: key,
      context: ctx(),
    });
    if (out.status === "requires_action") {
      out = await confirmShareChallenge({ token, userId: user.id, code: MOCK_3DS_CODE });
    }
    return out;
  }

  async function heldUnits(fx: StayFixture, start: number, nights = 2) {
    const rows = await prisma.inventoryDay.findMany({
      where: { roomTypeId: fx.roomId, date: { gte: utcDay(start), lt: utcDay(start + nights) } },
      select: { held: true, sold: true },
    });
    return rows.reduce((s, r) => s + r.held, 0);
  }

  async function forceDeadline(planId: string) {
    await prisma.splitPlan.update({
      where: { id: planId },
      data: { deadlineAt: new Date(Date.now() - 1000) },
    });
  }

  async function imbalanceCount(): Promise<number> {
    const m = await ledgerImbalanceTotal.get();
    return m.values.reduce((s, v) => s + v.value, 0);
  }

  async function expectLedgerClean(cartId: string) {
    const payments = await prisma.payment.findMany({
      where: { booking: { cartId } },
      select: { id: true },
    });
    const mine = new Set(payments.map((p) => p.id));
    const shareRefs = new Set(
      (
        await prisma.paymentShare.findMany({ where: { cartId }, select: { providerRef: true } })
      ).map((s) => s.providerRef)
    );
    expect(isTrialBalanced(await trialBalance(prisma))).toBe(true);
    const report = await reconcile(iso(new Date()), prisma);
    expect(report.imbalancedEntries).toBe(0);
    expect(report.differences.filter((d) => mine.has(d.subjectId))).toEqual([]);
    expect(report.orphanEvents.filter((e) => shareRefs.has(e.providerRef))).toEqual([]);
    expect(await imbalanceCount()).toBe(0);
  }

  beforeAll(async () => {
    expect(await imbalanceCount()).toBe(0);
  });
  afterEach(() => {
    setPaymentProviderForTests(null);
    injectSagaFaultForTests(SPLIT_PAYMENT_SAGA, null);
    delete process.env.SPLIT_PAY_FALLBACK;
    resetConfigForTests();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("3 kişi: hepsi öder → tümü tahsil + CONFIRMED, pay başına jurnal, mizan dengede, mutabakat 0; kalem iadesi paylara", async () => {
    psp = new SpyPsp();
    setPaymentProviderForTests(psp);
    const { a, organizer, cart } = await heldCart("all", 10);
    const [p1, p2] = [await newUser("all-p1"), await newUser("all-p2")];
    const plan = await createSplitPlan({
      cartId: cart.id,
      userId: organizer.id,
      mode: "equal",
      participants: [{ email: p1.email }, { email: p2.email.toUpperCase() }],
    });
    expect(plan.shares).toHaveLength(3);
    const amounts = plan.shares.map((s) => s.amountMinor);
    expect(amounts.reduce((s, x) => s + x, 0)).toBe(cart.totalMinor);
    // Kalan kuruş organizatöre (pozisyon 0), katılımcılar eşit.
    expect(amounts[1]).toBe(Math.floor(cart.totalMinor / 3));
    expect(amounts[2]).toBe(amounts[1]);
    expect(amounts[0]).toBe(cart.totalMinor - 2 * amounts[1]);
    // Tutma süre sonu + yedek kadar uzatıldı; son ödeme tutma bitişinden önce.
    const row = await prisma.cart.findUniqueOrThrow({ where: { id: cart.id } });
    expect(row.holdExpiresAt!.getTime()).toBeGreaterThan(new Date(plan.deadlineAt).getTime());

    // Davet e-postaları outbox'ta (yalnızca e-postalı katılımcılar), bağlantı imzalı.
    const invites = await prisma.outboxMessage.findMany({
      where: {
        eventType: "cart.split_share_invited",
        aggregateId: { in: plan.shares.map((s) => s.id) },
      },
    });
    expect(invites).toHaveLength(2);
    const p1Share = plan.shares.find((s) => s.participantEmail === p1.email)!;
    const invite = invites.find((m) => m.aggregateId === p1Share.id)!;
    expect(await notifySplitShareInvited(invite.payload as never)).toBe("sent");
    const mail = await prisma.notification.findFirstOrThrow({
      where: { to: p1.email },
      orderBy: { createdAt: "desc" },
    });
    expect(mail.text).toContain("/pay/share/");

    // Katılımcılar öder: yalnız yetkilendirme, tahsilat yok, sepet HELD kalır.
    expect((await pay(tokenOf(plan, 1), p1)).status).toBe("authorized");
    expect((await pay(tokenOf(plan, 2), p2)).status).toBe("authorized");
    expect(psp.captured).toHaveLength(0);
    expect((await prisma.cart.findUniqueOrThrow({ where: { id: cart.id } })).status).toBe("HELD");
    // Aynı ödeyenin tekrarı idempotent (ikinci yetkilendirme yok).
    const authBefore = psp.authorized.length;
    expect((await pay(tokenOf(plan, 1), p1)).status).toBe("authorized");
    expect(psp.authorized).toHaveLength(authBefore);

    // Son pay (organizatör) → hepsi tahsil edilir, sepet onaylanır.
    const last = await pay(tokenOf(plan, 0), organizer);
    expect(last.status).toBe("confirmed");
    expect(psp.captured).toHaveLength(3);

    const done = await prisma.cart.findUniqueOrThrow({
      where: { id: cart.id },
      include: {
        bookings: true,
        payment: { include: { payments: true, splitPlans: { include: { shares: true } } } },
      },
    });
    expect(done.status).toBe("CHECKED_OUT");
    expect(done.payment?.status).toBe("PAID");
    expect(done.payment?.providerRef).toBeNull();
    expect(done.bookings.every((b) => b.status === "CONFIRMED")).toBe(true);
    const shares = done.payment!.splitPlans[0].shares;
    expect(done.payment!.splitPlans[0].status).toBe("SETTLED");
    expect(shares.every((s) => s.status === "CAPTURED")).toBe(true);
    expect(shares.reduce((s, x) => s + x.amountMinor, 0n)).toBe(done.payment!.amountMinor);
    const pays = done.payment!.payments;
    expect(pays).toHaveLength(2);
    const captures = await prisma.journalEntry.count({
      where: { paymentId: { in: pays.map((p) => p.id) }, kind: "BOOKING_CAPTURED" },
    });
    expect(captures).toBe(2);
    expect(await heldUnits(a, 10)).toBe(0);
    await expectLedgerClean(cart.id);

    // Kalem iptali: iade tahsil edilmiş paylara dağıtılır (her pay kendi PSP işleminden).
    const target = done.bookings[0];
    const cancelled = await cancelAndRefund(target.id, organizer.id);
    expect(cancelled.status).toBe("CANCELLED");
    const parts = await prisma.paymentShareRefund.findMany({ where: { bookingId: target.id } });
    expect(parts.reduce((s, r) => s + Number(r.amountMinor), 0)).toBe(cancelled.refund.refundMinor);
    if (cancelled.refund.refundMinor > 0) {
      expect(parts.every((r) => r.status === "DONE")).toBe(true);
      const shareRefs = new Set(shares.map((s) => s.providerRef));
      const refundCalls = psp.refunded.filter((r) => r.key.startsWith(`refund:${target.id}:`));
      expect(refundCalls.length).toBe(parts.length);
      expect(refundCalls.every((r) => shareRefs.has(r.ref))).toBe(true);
    }
    await expectLedgerClean(cart.id);
  });

  it("regression: önce reddedilen tek ödeme, sonra bölünmüş ödeme → kalem iadesi eski PSP ref'ine değil paylara", async () => {
    psp = new SpyPsp();
    setPaymentProviderForTests(psp);
    const { organizer, cart: first } = await heldCart("stale", 110);
    const declined = await payCart({
      cartId: first.id,
      userId: organizer.id,
      cardToken: "tok_mock_decline_0002",
      idempotencyKey: "stale-decline",
    }).catch((e: unknown) => e);
    expect((declined as HttpError).code).toBe("PAYMENT_DECLINED");
    const staleRef = (await prisma.cartPayment.findUniqueOrThrow({ where: { cartId: first.id } }))
      .providerRef;
    expect(staleRef).toBeTruthy();
    const cart = await holdCart(organizer.id);
    const p1 = await newUser("stale-p1");
    const plan = await createSplitPlan({
      cartId: cart.id,
      userId: organizer.id,
      mode: "equal",
      participants: [{ email: p1.email }],
    });
    await pay(tokenOf(plan, 1), p1);
    expect((await pay(tokenOf(plan, 0), organizer)).status).toBe("confirmed");
    const booking = await prisma.booking.findFirstOrThrow({
      where: { cartId: cart.id, status: "CONFIRMED" },
    });
    const out = await cancelAndRefund(booking.id, organizer.id);
    if (out.refund.refundMinor > 0) {
      expect(psp.refunded.some((r) => r.ref === staleRef)).toBe(false);
      const parts = await prisma.paymentShareRefund.findMany({ where: { bookingId: booking.id } });
      expect(parts.reduce((s, r) => s + Number(r.amountMinor), 0)).toBe(out.refund.refundMinor);
    }
    await expectLedgerClean(cart.id);
  });

  it("(a) 1 kişi ödemez → süre sonunda kalan organizatörün yedek payına düşer, organizatör öder → onay", async () => {
    const { organizer, cart } = await heldCart("fb", 20);
    const [p1, p2] = [await newUser("fb-p1"), await newUser("fb-p2")];
    const plan = await createSplitPlan({
      cartId: cart.id,
      userId: organizer.id,
      mode: "custom",
      participants: [
        { email: p1.email, amountMinor: 10_000 },
        { email: p2.email, amountMinor: 20_000 },
      ],
    });
    expect(plan.fallbackMode).toBe("ORGANIZER_PAYS");
    const p2Token = tokenOf(plan, 2);
    await pay(tokenOf(plan, 0), organizer);
    await pay(tokenOf(plan, 1), p1);

    await forceDeadline(plan.id);
    expect(await processSplitDeadline(plan.id)).toBe("fallback");
    // İş tekrar çalışsa da (yeni son ödeme gelmedi) değişiklik yok.
    expect(await processSplitDeadline(plan.id)).toBe("not_due");

    const after = (await getSplitPlan(cart.id, organizer.id))!;
    expect(after.status).toBe("FALLBACK");
    const expired = after.shares.find((s) => s.position === 2)!;
    expect(expired.status).toBe("EXPIRED");
    const fallback = after.shares.find((s) => s.isFallback)!;
    expect(fallback.amountMinor).toBe(20_000);
    expect(fallback.status).toBe("INVITED");
    const cartRow = await prisma.cart.findUniqueOrThrow({ where: { id: cart.id } });
    expect(new Date(after.deadlineAt).getTime()).toBeLessThan(cartRow.holdExpiresAt!.getTime());
    expect(
      await prisma.outboxMessage.count({
        where: { eventType: "cart.split_share_invited", aggregateId: fallback.id },
      })
    ).toBe(1);

    // Süresi dolan katılımcı artık ödeyemez.
    const late = await pay(p2Token, p2).catch((e: unknown) => e);
    expect((late as HttpError).code).toBe("SPLIT_DEADLINE_PASSED");
    // Yedek pay yalnız organizatörün.
    const stranger = await pay(tokenOf(after, fallback.position), p1).catch((e: unknown) => e);
    expect((stranger as HttpError).status).toBe(403);

    expect((await pay(tokenOf(after, fallback.position), organizer)).status).toBe("confirmed");
    const done = await prisma.cart.findUniqueOrThrow({
      where: { id: cart.id },
      include: { bookings: true, payment: true },
    });
    expect(done.status).toBe("CHECKED_OUT");
    expect(done.bookings.every((b) => b.status === "CONFIRMED")).toBe(true);
    const captured = await prisma.paymentShare.aggregate({
      where: { cartId: cart.id, status: "CAPTURED" },
      _sum: { amountMinor: true },
    });
    expect(captured._sum.amountMinor).toBe(done.payment!.amountMinor);
    await expectLedgerClean(cart.id);
  });

  it("(b) REFUND_ALL: 1 kişi ödemez → tüm yetkilendirmeler void, tutmalar serbest, sepet yeniden açılabilir", async () => {
    process.env.SPLIT_PAY_FALLBACK = "refund";
    resetConfigForTests();
    psp = new SpyPsp();
    setPaymentProviderForTests(psp);
    const { a, b, organizer, cart } = await heldCart("rf", 30);
    const [p1, p2] = [await newUser("rf-p1"), await newUser("rf-p2")];
    const plan = await createSplitPlan({
      cartId: cart.id,
      userId: organizer.id,
      mode: "equal",
      participants: [{ email: p1.email }, { email: p2.email }],
    });
    expect(plan.fallbackMode).toBe("REFUND_ALL");
    await pay(tokenOf(plan, 0), organizer);
    await pay(tokenOf(plan, 1), p1);
    const authorized = (
      await prisma.paymentShare.findMany({
        where: { planId: plan.id, status: "AUTHORIZED" },
        select: { providerRef: true },
      })
    ).map((s) => s.providerRef!);
    expect(authorized).toHaveLength(2);

    await forceDeadline(plan.id);
    // Gecikmeli iş kaybolsa da dakikalık süpürücü (expire-holds) planı kapatır.
    expect(await sweepSplitDeadlines(new Date(), 500)).toBeGreaterThanOrEqual(1);
    expect(await processSplitDeadline(plan.id)).toBe("noop");

    const shares = await prisma.paymentShare.findMany({
      where: { planId: plan.id },
      orderBy: { position: "asc" },
    });
    expect(shares.map((s) => s.status)).toEqual(["VOIDED", "VOIDED", "EXPIRED"]);
    expect(psp.captured).toHaveLength(0);
    for (const ref of authorized) expect(psp.voided).toContain(ref);
    const row = await prisma.cart.findUniqueOrThrow({
      where: { id: cart.id },
      include: { bookings: true, payment: true },
    });
    expect(row.status).toBe("EXPIRED");
    expect(row.payment?.status).toBe("FAILED");
    expect(row.bookings.every((x) => x.status === "EXPIRED")).toBe(true);
    expect(await heldUnits(a, 30)).toBe(0);
    expect(await heldUnits(b, 30)).toBe(0);
    expect((await prisma.splitPlan.findUniqueOrThrow({ where: { id: plan.id } })).status).toBe(
      "ABORTED"
    );
    await expectLedgerClean(cart.id);
  });

  it("tahsilat sonrası onay hatası → tahsil edilen tüm paylar iade, tutmalar serbest (saga telafisi)", async () => {
    psp = new SpyPsp();
    setPaymentProviderForTests(psp);
    const { a, organizer, cart } = await heldCart("comp", 40);
    const p1 = await newUser("comp-p1");
    const plan = await createSplitPlan({
      cartId: cart.id,
      userId: organizer.id,
      mode: "equal",
      participants: [{ email: p1.email }],
    });
    await pay(tokenOf(plan, 1), p1);
    injectSagaFaultForTests(SPLIT_PAYMENT_SAGA, "confirm");
    await expect(pay(tokenOf(plan, 0), organizer)).rejects.toThrow();

    const shares = await prisma.paymentShare.findMany({ where: { planId: plan.id } });
    expect(shares.every((s) => s.status === "REFUNDED")).toBe(true);
    expect(psp.captured).toHaveLength(2);
    expect(psp.refunded.filter((r) => r.key.startsWith("compensate:"))).toHaveLength(2);
    const row = await prisma.cart.findUniqueOrThrow({ where: { id: cart.id } });
    expect(row.status).toBe("OPEN");
    expect(await heldUnits(a, 40)).toBe(0);
    expect(await prisma.payment.count({ where: { booking: { cartId: cart.id } } })).toBe(0);
    await expectLedgerClean(cart.id);
  });

  it("yarış: aynı pay iki kişi tarafından eşzamanlı ödenemez; süre sonu ↔ son ödeme tutarlı", async () => {
    psp = new SpyPsp();
    setPaymentProviderForTests(psp);
    const { organizer, cart } = await heldCart("race", 50);
    const plan = await createSplitPlan({
      cartId: cart.id,
      userId: organizer.id,
      mode: "equal",
      participants: [{}, {}], // e-postasız: linki alan her doğrulanmış hesap
    });
    const users = await Promise.all([1, 2, 3, 4].map((i) => newUser(`race-${i}`)));
    const token = tokenOf(plan, 1);
    const results = await Promise.allSettled(users.map((u) => pay(token, u)));
    const ok = results.filter((r) => r.status === "fulfilled");
    expect(ok).toHaveLength(1);
    for (const r of results) {
      if (r.status === "rejected") {
        expect((r.reason as HttpError).code).toBe("SHARE_ALREADY_PAID");
      }
    }
    const share1 = await prisma.paymentShare.findFirstOrThrow({
      where: { planId: plan.id, position: 1 },
    });
    expect(share1.status).toBe("AUTHORIZED");
    // Kalan tüm yetkilendirmeler void → PSP'de askıda para yok.
    const dangling = psp.authorized.filter(
      (ref) => ref !== share1.providerRef && !psp.voided.includes(ref)
    );
    expect(dangling).toEqual([]);

    // Süre sonu ile son iki ödeme yarışır: ya tümü onaylanır ya da süre sonu kazanır;
    // hiçbir durumda yetkilendirilmiş ama işlenmemiş pay kalmaz.
    await prisma.splitPlan.update({
      where: { id: plan.id },
      data: { deadlineAt: new Date(Date.now() + 200) },
    });
    const race = await Promise.allSettled([
      pay(tokenOf(plan, 2), users[1]),
      pay(tokenOf(plan, 0), organizer),
      new Promise((r) => setTimeout(r, 200)).then(() => processSplitDeadline(plan.id)),
    ]);
    const final = await prisma.splitPlan.findUniqueOrThrow({
      where: { id: plan.id },
      include: { shares: true },
    });
    const cartRow = await prisma.cart.findUniqueOrThrow({ where: { id: cart.id } });
    if (final.status === "SETTLED") {
      expect(cartRow.status).toBe("CHECKED_OUT");
      expect(final.shares.every((s) => s.status === "CAPTURED")).toBe(true);
    } else {
      expect(["FALLBACK", "ABORTED"]).toContain(final.status);
      for (const r of race.slice(0, 2)) {
        if (r.status === "rejected") {
          expect(["SPLIT_DEADLINE_PASSED", "SPLIT_CLOSED"]).toContain((r.reason as HttpError).code);
        }
      }
      expect(final.shares.some((s) => s.status === "CAPTURED")).toBe(false);
    }
    const settledRefs = new Set(
      final.shares
        .filter((s) => ["AUTHORIZED", "CAPTURED"].includes(s.status))
        .map((s) => s.providerRef)
    );
    const unhandled = psp.authorized.filter(
      (ref) => !settledRefs.has(ref) && !psp.voided.includes(ref)
    );
    expect(unhandled).toEqual([]);
  });

  it("HTTP: imzası bozuk link 404, süresi geçmiş link 410, e-posta uyuşmazlığı 403, doğrulanmamış 403, oturumsuz 401", async () => {
    const { organizer, cart } = await heldCart("http", 60);
    const p1 = await newUser("http-p1");
    const other = await newUser("http-other");
    const unverified = await newUser("http-unv", false);
    const bearer = async (u: U) => (await signAccessToken(u.id, "USER", 300)).token;
    const req = (path: string, token: string | null, method = "GET", body?: unknown) =>
      new NextRequest(`http://localhost:3000${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          "idempotency-key": `http-${++seq}`,
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    const call = (
      handler: (req: NextRequest, ctx: { params: Promise<{ token: string }> }) => Promise<Response>,
      shareToken: string,
      token: string | null,
      method = "GET",
      body?: unknown
    ) =>
      handler(req(`/api/pay/share/${encodeURIComponent(shareToken)}`, token, method, body), {
        params: Promise.resolve({ token: encodeURIComponent(shareToken) }),
      });

    // Organizatör planı HTTP ile kurar; 201 + davet linkleri.
    const created = await splitRoute.POST(
      req(`/api/cart/${cart.id}/split`, await bearer(organizer), "POST", {
        mode: "equal",
        participants: [{ email: p1.email }],
      }),
      { params: Promise.resolve({ id: cart.id }) }
    );
    expect(created.status).toBe(201);
    const { plan } = (await created.json()) as { plan: SplitPlanDTO };
    // Başkasının sepetinin planı 404 (IDOR).
    const foreign = await splitRoute.GET(req(`/api/cart/${cart.id}/split`, await bearer(p1)), {
      params: Promise.resolve({ id: cart.id }),
    });
    expect(foreign.status).toBe(404);

    const good = tokenOf(plan, 1);
    const view = await call(shareRoute.GET, good, await bearer(p1));
    expect(view.status).toBe(200);
    const { share } = (await view.json()) as { share: { amountMinor: number; canPay: boolean } };
    expect(share.canPay).toBe(true);

    const [body, sig] = good.split(".");
    const tampered = `${body}.${sig.slice(0, -2)}${sig.endsWith("AA") ? "BB" : "AA"}`;
    const forged = signShareToken({
      s: plan.shares[1].id,
      n: "wrong-nonce",
      e: Date.now() + 60_000,
    });
    const row = await prisma.paymentShare.findUniqueOrThrow({ where: { id: plan.shares[1].id } });
    const expired = signShareToken({ s: row.id, n: row.inviteNonce, e: Date.now() - 1000 });

    for (const t of [tampered, "garbage", forged]) {
      const r = await call(shareRoute.GET, t, await bearer(p1));
      expect(r.status).toBe(404);
      expect(((await r.json()) as { code: string }).code).toBe("SHARE_LINK_INVALID");
    }
    const exp = await call(shareRoute.POST, expired, await bearer(p1), "POST", {
      cardToken: "tok_mock_ok_4242",
    });
    expect(exp.status).toBe(410);
    const payTampered = await call(shareRoute.POST, tampered, await bearer(p1), "POST", {
      cardToken: "tok_mock_ok_4242",
    });
    expect(payTampered.status).toBe(404);
    const mismatch = await call(shareRoute.POST, good, await bearer(other), "POST", {
      cardToken: "tok_mock_ok_4242",
    });
    expect(mismatch.status).toBe(403);
    expect(((await mismatch.json()) as { code: string }).code).toBe("SHARE_EMAIL_MISMATCH");
    const unv = await call(shareRoute.POST, good, await bearer(unverified), "POST", {
      cardToken: "tok_mock_ok_4242",
    });
    expect(unv.status).toBe(403);
    expect(((await unv.json()) as { code: string }).code).toBe("EMAIL_NOT_VERIFIED");
    expect((await call(shareRoute.GET, good, null)).status).toBe(401);

    // Doğru kişi → 200 (yetkilendirme).
    const paid = await call(shareRoute.POST, good, await bearer(p1), "POST", {
      cardToken: "tok_mock_ok_4242",
    });
    expect([200, 202]).toContain(paid.status);
    // Plan varken sepet tek ödemeyle ödenemez.
    const single = await payCart({
      cartId: cart.id,
      userId: organizer.id,
      cardToken: "tok_mock_ok_4242",
      idempotencyKey: "http-single",
    }).catch((e: unknown) => e);
    expect((single as HttpError).code).toBe("SPLIT_ACTIVE");
    // Organizatör tutmayı bırakır → paylar void, sepet OPEN.
    const released: CartDTO = await releaseCartWithSplit(organizer.id, cart.id);
    expect(released.status).toBe("OPEN");
    expect(
      (await prisma.paymentShare.findUniqueOrThrow({ where: { id: plan.shares[1].id } })).status
    ).toBe("VOIDED");
  });

  it("geç webhook: sepet tek ödemesi süre dolduktan sonra başarılı → envanter uygunsa yeniden tutulup onaylanır, değilse iade", async () => {
    const lateMetric = async (subject: string, outcome: string) =>
      (await cartLateSuccessTotal.get()).values.find(
        (v) => v.labels.subject === subject && v.labels.outcome === outcome
      )?.value ?? 0;

    // 1) Envanter uygun → reconfirmed.
    const one = await heldCart("late-ok", 70);
    const pending = await payCart({
      cartId: one.cart.id,
      userId: one.organizer.id,
      cardToken: "tok_mock_3ds_3220",
      idempotencyKey: "late-ok",
    });
    expect(pending.status).toBe("requires_action");
    await prisma.cart.update({
      where: { id: one.cart.id },
      data: { holdExpiresAt: new Date(Date.now() - 1000) },
    });
    expect(await expireCarts(new Date(), 1000)).toBeGreaterThan(0);
    const cp = await prisma.cartPayment.findUniqueOrThrow({ where: { cartId: one.cart.id } });
    const beforeOk = await lateMetric("cart", "reconfirmed");
    const res = await handleWebhookEvent({
      id: `evt_split_late_${cp.providerRef}`,
      type: "payment.succeeded",
      data: { providerRef: cp.providerRef!, amount: Number(cp.amountMinor), currency: cp.currency },
    });
    expect(res.duplicate).toBe(false);
    const ok = await prisma.cart.findUniqueOrThrow({
      where: { id: one.cart.id },
      include: { bookings: true, payment: true },
    });
    expect(ok.status).toBe("CHECKED_OUT");
    expect(ok.payment?.status).toBe("PAID");
    expect(ok.bookings.every((b) => b.status === "CONFIRMED")).toBe(true);
    expect(await lateMetric("cart", "reconfirmed")).toBe(beforeOk + 1);
    expect(
      await prisma.auditLog.count({ where: { action: "cart.late_success", entityId: one.cart.id } })
    ).toBe(1);
    // Aynı olay tekrar → etkisiz.
    expect(
      (
        await handleWebhookEvent({
          id: `evt_split_late_${cp.providerRef}`,
          type: "payment.succeeded",
          data: { providerRef: cp.providerRef!, amount: Number(cp.amountMinor), currency: "TRY" },
        })
      ).duplicate
    ).toBe(true);
    await expectLedgerClean(one.cart.id);

    // 2) Envanter doldu → iade.
    psp = new SpyPsp();
    setPaymentProviderForTests(psp);
    const two = await heldCart("late-full", 80, 1);
    const pending2 = await payCart({
      cartId: two.cart.id,
      userId: two.organizer.id,
      cardToken: "tok_mock_3ds_3221",
      idempotencyKey: "late-full",
    });
    expect(pending2.status).toBe("requires_action");
    await prisma.cart.update({
      where: { id: two.cart.id },
      data: { holdExpiresAt: new Date(Date.now() - 1000) },
    });
    await expireCarts(new Date(), 1000);
    // Başkası son odayı alır.
    const rival = await newUser("late-rival");
    await addCartItem(rival.id, item(two.a, 80));
    await holdCart(rival.id);
    const cp2 = await prisma.cartPayment.findUniqueOrThrow({ where: { cartId: two.cart.id } });
    const beforeRefund = await lateMetric("cart", "refunded");
    const res2 = await handleWebhookEvent({
      id: `evt_split_late_${cp2.providerRef}`,
      type: "payment.succeeded",
      data: { providerRef: cp2.providerRef!, amount: Number(cp2.amountMinor), currency: "TRY" },
    });
    expect(res2.compensated).toBe(true);
    const refundedCp = await prisma.cartPayment.findUniqueOrThrow({
      where: { cartId: two.cart.id },
    });
    expect(refundedCp.status).toBe("REFUNDED");
    expect(refundedCp.refundedAmountMinor).toBe(refundedCp.amountMinor);
    expect(psp.refunded.map((r) => r.ref)).toContain(cp2.providerRef);
    expect(await lateMetric("cart", "refunded")).toBe(beforeRefund + 1);
    expect((await prisma.cart.findUniqueOrThrow({ where: { id: two.cart.id } })).status).not.toBe(
      "CHECKED_OUT"
    );
    const report = await reconcile(iso(new Date()), prisma);
    expect(report.orphanEvents.filter((e) => e.providerRef === cp2.providerRef)).toEqual([]);

    // 3) Doğrulama (3DS) bekleyen sepet ödemesi zamanında onaylanır (sepet HELD).
    const three = await heldCart("late-ontime", 90);
    const pending3 = await payCart({
      cartId: three.cart.id,
      userId: three.organizer.id,
      cardToken: "tok_mock_3ds_3222",
      idempotencyKey: "late-ontime",
    });
    expect(pending3.status).toBe("requires_action");
    const cp3 = await prisma.cartPayment.findUniqueOrThrow({ where: { cartId: three.cart.id } });
    await handleWebhookEvent({
      id: `evt_split_ontime_${cp3.providerRef}`,
      type: "payment.succeeded",
      data: { providerRef: cp3.providerRef!, amount: Number(cp3.amountMinor), currency: "TRY" },
    });
    expect((await prisma.cart.findUniqueOrThrow({ where: { id: three.cart.id } })).status).toBe(
      "CHECKED_OUT"
    );
    // Onaylanmış sepette 3DS tamamlama idempotent.
    expect(
      (
        await confirmCartChallenge({
          cartId: three.cart.id,
          userId: three.organizer.id,
          code: MOCK_3DS_CODE,
        })
      ).status
    ).toBe("confirmed");
  });

  it("geç webhook: pay — plan açıkken başarılı olay payı tahsil sayar; plan kapandıktan sonra iade edilir", async () => {
    psp = new SpyPsp();
    setPaymentProviderForTests(psp);
    const { organizer, cart } = await heldCart("late-share", 100);
    const [p1, p2] = [await newUser("ls-p1"), await newUser("ls-p2")];
    const plan = await createSplitPlan({
      cartId: cart.id,
      userId: organizer.id,
      mode: "equal",
      participants: [{ email: p1.email }, { email: p2.email }],
    });
    // p1 ve p2 3DS'te kalır.
    for (const [pos, u, card] of [
      [1, p1, "tok_mock_3ds_4001"],
      [2, p2, "tok_mock_3ds_4002"],
    ] as const) {
      const out = await payShare({
        token: tokenOf(plan, pos),
        userId: u.id,
        cardToken: card,
        idempotencyKey: `ls-${pos}`,
        context: ctx(),
      });
      expect(out.status).toBe("requires_action");
    }
    const s1 = await prisma.paymentShare.findFirstOrThrow({
      where: { planId: plan.id, position: 1 },
    });
    // Plan açık: p1'in PSP başarısı webhook ile gelir → pay CAPTURED.
    await handleWebhookEvent({
      id: `evt_share_${s1.providerRef}`,
      type: "payment.succeeded",
      data: { providerRef: s1.providerRef!, amount: Number(s1.amountMinor), currency: "TRY" },
    });
    expect((await prisma.paymentShare.findUniqueOrThrow({ where: { id: s1.id } })).status).toBe(
      "CAPTURED"
    );

    // Organizatör bırakır → plan iptal: tahsil edilen p1 iade, p2'nin 3DS'i void.
    await releaseCartWithSplit(organizer.id, cart.id);
    const s2 = await prisma.paymentShare.findFirstOrThrow({
      where: { planId: plan.id, position: 2 },
    });
    expect(s2.status).toBe("VOIDED");
    expect((await prisma.paymentShare.findUniqueOrThrow({ where: { id: s1.id } })).status).toBe(
      "REFUNDED"
    );
    // p2'nin başarısı plan kapandıktan sonra gelir → iade + audit.
    const res = await handleWebhookEvent({
      id: `evt_share_${s2.providerRef}`,
      type: "payment.succeeded",
      data: { providerRef: s2.providerRef!, amount: Number(s2.amountMinor), currency: "TRY" },
    });
    expect(res.compensated).toBe(true);
    const s2After = await prisma.paymentShare.findUniqueOrThrow({ where: { id: s2.id } });
    expect(s2After.status).toBe("REFUNDED");
    expect(s2After.refundedAmountMinor).toBe(s2After.amountMinor);
    expect(psp.refunded.map((r) => r.ref)).toContain(s2.providerRef);
    expect(
      await prisma.auditLog.count({
        where: { action: "cart.split_late_success", entityId: cart.id },
      })
    ).toBe(1);
    // p1 için tekrar başarı olayı (farklı olay kimliği) → ikinci iade YOK.
    const refundsBefore = psp.refunded.length;
    await handleWebhookEvent({
      id: `evt_share_again_${s1.providerRef}`,
      type: "payment.succeeded",
      data: { providerRef: s1.providerRef!, amount: Number(s1.amountMinor), currency: "TRY" },
    });
    expect(psp.refunded.length).toBe(refundsBefore);
    await expectLedgerClean(cart.id);
  });

  it("regression: v2-P0-3 plan kapandıktan sonra gelen pay başarısının iadesi jurnale yazılır; tekrar teslim çoğaltmaz", async () => {
    psp = new SpyPsp();
    setPaymentProviderForTests(psp);
    const { organizer, cart } = await heldCart("p03-share", 110);
    const p1 = await newUser("p03-share-p1");
    const plan = await createSplitPlan({
      cartId: cart.id,
      userId: organizer.id,
      mode: "equal",
      participants: [{ email: p1.email }],
    });
    const out = await payShare({
      token: tokenOf(plan, 1),
      userId: p1.id,
      cardToken: "tok_mock_3ds_4101",
      idempotencyKey: "p03-share-1",
      context: ctx(),
    });
    expect(out.status).toBe("requires_action");
    // Organizatör bırakır → plan kapanır, p1'in 3DS'i void.
    await releaseCartWithSplit(organizer.id, cart.id);
    const share = await prisma.paymentShare.findFirstOrThrow({
      where: { planId: plan.id, position: 1 },
    });
    const succeeded = (id: string) =>
      handleWebhookEvent({
        id,
        type: "payment.succeeded",
        data: {
          providerRef: share.providerRef!,
          amount: Number(share.amountMinor),
          currency: "TRY",
        },
      });
    expect((await succeeded(`evt_p03_share_${share.providerRef}`)).compensated).toBe(true);

    const shareJournal = async () => {
      const entries = await prisma.journalEntry.findMany({
        where: { paymentId: share.id },
        select: {
          kind: true,
          lines: { select: { side: true, amountMinor: true, account: { select: { kind: true } } } },
        },
      });
      let pspNet = 0n;
      let captured = 0n;
      for (const l of entries.flatMap((e) => e.lines)) {
        if (l.account.kind !== "PSP_CLEARING") continue;
        pspNet += l.side === "DEBIT" ? l.amountMinor : -l.amountMinor;
        if (l.side === "DEBIT") captured += l.amountMinor;
      }
      return { kinds: entries.map((e) => e.kind).sort(), pspNet, captured };
    };
    const expected = {
      kinds: ["BOOKING_CAPTURED", "REFUND_ISSUED"],
      pspNet: 0n,
      captured: share.amountMinor,
    };
    expect(await shareJournal()).toEqual(expected);
    expect(isTrialBalanced(await trialBalance(prisma))).toBe(true);
    expect(await imbalanceCount()).toBe(0);

    // Aynı PSP başarısı farklı olay kimliğiyle yeniden → ikinci jurnal yok.
    await succeeded(`evt_p03_share_again_${share.providerRef}`);
    expect(await shareJournal()).toEqual(expected);
    expect(await imbalanceCount()).toBe(0);
  });
  /** Payın (paymentId = share.id) jurnal türleri, psp_clearing neti ve tahsilat toplamı. */
  async function shareJournalOf(shareId: string) {
    const entries = await prisma.journalEntry.findMany({
      where: { paymentId: shareId },
      select: {
        kind: true,
        lines: { select: { side: true, amountMinor: true, account: { select: { kind: true } } } },
      },
    });
    let pspNet = 0n;
    let captured = 0n;
    for (const l of entries.flatMap((e) => e.lines)) {
      if (l.account.kind !== "PSP_CLEARING") continue;
      pspNet += l.side === "DEBIT" ? l.amountMinor : -l.amountMinor;
      if (l.side === "DEBIT") captured += l.amountMinor;
    }
    return { kinds: entries.map((e) => e.kind).sort(), pspNet, captured };
  }

  it("regression: v2-P0-3 plan telafisinde iade edilen tahsil edilmiş paylar jurnale yazılır; mutabakat temiz", async () => {
    psp = new SpyPsp();
    setPaymentProviderForTests(psp);
    const { organizer, cart } = await heldCart("p03-comp", 45);
    const p1 = await newUser("p03-comp-p1");
    const plan = await createSplitPlan({
      cartId: cart.id,
      userId: organizer.id,
      mode: "equal",
      participants: [{ email: p1.email }],
    });
    await pay(tokenOf(plan, 1), p1);
    injectSagaFaultForTests(SPLIT_PAYMENT_SAGA, "confirm");
    await expect(pay(tokenOf(plan, 0), organizer)).rejects.toThrow();

    const shares = await prisma.paymentShare.findMany({ where: { planId: plan.id } });
    expect(shares).toHaveLength(2);
    for (const share of shares) {
      expect(share.status).toBe("REFUNDED");
      expect(await shareJournalOf(share.id)).toEqual({
        kinds: ["BOOKING_CAPTURED", "REFUND_ISSUED"],
        pspNet: 0n,
        captured: share.amountMinor,
      });
    }
    const ids = new Set(shares.map((s) => s.id));
    const report = await reconcile(iso(new Date()), prisma);
    expect(report.differences.filter((d) => ids.has(d.subjectId))).toEqual([]);
    await expectLedgerClean(cart.id);
  });

  it("regression: v2-P0-3 mutabakat jurnalsiz pay iadesini fark olarak raporlar", async () => {
    psp = new SpyPsp();
    setPaymentProviderForTests(psp);
    const { organizer, cart } = await heldCart("p03-nojournal", 55);
    const p1 = await newUser("p03-nojournal-p1");
    const plan = await createSplitPlan({
      cartId: cart.id,
      userId: organizer.id,
      mode: "equal",
      participants: [{ email: p1.email }],
    });
    await pay(tokenOf(plan, 1), p1);
    const share = await prisma.paymentShare.findFirstOrThrow({
      where: { planId: plan.id, position: 1 },
    });
    expect(share.providerRef).toBeTruthy();
    // Jurnal yazmadan iade eden bir yol: pay REFUNDED + telafi işareti, jurnal yok.
    const now = new Date();
    await prisma.paymentShare.update({
      where: { id: share.id },
      data: {
        status: "REFUNDED",
        capturedAt: now,
        refundedAmountMinor: share.amountMinor,
        refundedAt: now,
      },
    });
    await prisma.paymentEvent.create({
      data: {
        id: `comp:${share.providerRef}`,
        type: "compensation.split_share",
        providerRef: share.providerRef,
        receivedAt: now,
      },
    });
    const report = await reconcile(iso(now), prisma);
    const mine = report.differences
      .filter((d) => d.subjectId === share.id)
      .map((d) => ({ subject: d.subject, kind: d.kind, psp: d.pspMinor, journal: d.journalMinor }))
      .sort((a, b) => a.kind.localeCompare(b.kind));
    expect(mine).toEqual([
      { subject: "payment_share", kind: "capture", psp: share.amountMinor, journal: 0n },
      { subject: "payment_share", kind: "refund", psp: share.amountMinor, journal: 0n },
    ]);
    // Sepeti serbest bırak (sonraki testlerin envanteri etkilenmesin).
    await releaseCartWithSplit(organizer.id, cart.id).catch(() => undefined);
  });
});
