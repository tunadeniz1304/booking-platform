// fix-sweep-3 (P2-3 yük testi bulguları): capture sonrası SERIALIZABLE onay çakışması iade
// ETMEZ → `confirm-retry` onaylar; tutma düşmüş + envanter yoksa iade; sepet / pay PSP hatası
// 502; başarısız telafi → `saga-compensation-retry` → void/iade tamamlanır; geç başarı sayacı
// ödemeyi sayar (tekrar teslim ayrı etiket). Her adımda mizan dengede + mutabakat farkı 0.
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
  holdCart,
  payCart,
  payShare,
  releaseCartHolds,
  type CartPayOutcome,
  type ShareOutcome,
  type SplitPlanDTO,
} from "@/lib/cart";
import { CONFIRM_PENDING, confirmRetryTotal } from "@/lib/cart/confirm-pending";
import { processConfirmRetry } from "@/lib/cart/confirm-retry-job";
import {
  handleWebhookEvent,
  latePaymentSuccessTotal,
  payForBooking,
} from "@/lib/payment/payment-service";
import { releaseHold } from "@/lib/booking-service";
import { MOCK_3DS_CODE } from "@/lib/payment/card-token";
import { setPaymentProviderForTests } from "@/lib/payment";
import { MockPsp } from "@/lib/payment/mock-psp";
import { PaymentProviderError } from "@/lib/payment/provider";
import type { Money } from "@/lib/money/money";
import { injectSerializationFaultsForTests } from "@/lib/db/transactions";
import {
  sagaCompensationRetryTotal,
  type CompensationRetryData,
} from "@/lib/saga/compensation-retry";
import { runCompensationRetry } from "@/worker/jobs/saga-compensation-retry";
import { getQueue, QUEUE_NAMES } from "@/lib/queue";
import { isTrialBalanced, ledgerImbalanceTotal, reconcile, trialBalance } from "@/lib/ledger";
import { signAccessToken } from "@/lib/auth/tokens";
import { resetConfigForTests } from "@/lib/config/app-config";
import * as cartPayRoute from "@/app/api/cart/[id]/pay/route";
import * as shareRoute from "@/app/api/pay/share/[token]/route";

interface U {
  id: string;
  email: string;
}

/** PSP çağrılarını kaydeden, istenen işlemleri sağlayıcı hatasıyla düşüren mock. */
class FaultyPsp extends MockPsp {
  captured: string[] = [];
  voided: string[] = [];
  refunded: Array<{ ref: string; amount: number; key: string }> = [];
  failAuthorize = 0;
  /** İlk `captureOkBeforeFail` capture başarılı, sonraki `failCapture` capture düşer. */
  captureOkBeforeFail = 0;
  failCapture = 0;
  failVoid = 0;
  failRefund = 0;
  private fault(op: string): PaymentProviderError {
    return new PaymentProviderError("psp_unavailable", `sahte PSP hatası (${op})`);
  }
  override async authorize(input: Parameters<MockPsp["authorize"]>[0]) {
    if (this.failAuthorize > 0) {
      this.failAuthorize--;
      throw this.fault("authorize");
    }
    return super.authorize(input);
  }
  override async capture(ref?: string, amount?: Money) {
    if (this.captureOkBeforeFail > 0) this.captureOkBeforeFail--;
    else if (this.failCapture > 0) {
      this.failCapture--;
      throw this.fault("capture");
    }
    if (ref) this.captured.push(ref);
    return super.capture(ref, amount);
  }
  override async void(ref?: string) {
    if (this.failVoid > 0) {
      this.failVoid--;
      throw this.fault("void");
    }
    if (ref) this.voided.push(ref);
    return super.void();
  }
  override async refund(ref: string, amount: Money, key: string) {
    if (this.failRefund > 0) {
      this.failRefund--;
      throw this.fault("refund");
    }
    this.refunded.push({ ref, amount: amount.amount, key });
    return super.refund(ref, amount, key);
  }
}

describeInt("fix-sweep-3: onay dayanıklılığı, PSP 502, telafi yeniden denemesi", () => {
  const prisma = new PrismaClient();
  let seq = 0;
  let psp: FaultyPsp;

  async function newUser(tag: string): Promise<U> {
    const u = await prisma.user.create({
      data: {
        email: `fs3-${tag}-${Date.now()}-${++seq}@t.test`,
        passwordHash: "x",
        firstName: `Fs${seq}`,
        lastName: "Test",
        emailVerifiedAt: new Date(),
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

  /** Tek kalemli (1 birimlik oda) HELD sepet. */
  async function heldCart(tag: string, start: number) {
    const fx = await createStayFixture(prisma, {
      tag: `fs3-${tag}`,
      units: 1,
      nightlyPrice: 1000.01,
    });
    const owner = await newUser(`${tag}-own`);
    await addCartItem(owner.id, item(fx, start));
    const cart = await holdCart(owner.id);
    expect(cart.status).toBe("HELD");
    return { fx, owner, cart };
  }

  const ctx = () => ({ ip: `10.33.${seq % 250}.${++seq % 250}` });

  async function pay(cartId: string, user: U): Promise<CartPayOutcome> {
    let out = await payCart({
      cartId,
      userId: user.id,
      cardToken: "tok_mock_ok_4242",
      idempotencyKey: `fs3-${++seq}`,
      context: ctx(),
    });
    if (out.status === "requires_action") {
      out = await confirmCartChallenge({ cartId, userId: user.id, code: MOCK_3DS_CODE });
    }
    return out;
  }

  async function payShareOf(token: string, user: U): Promise<ShareOutcome> {
    let out = await payShare({
      token,
      userId: user.id,
      cardToken: "tok_mock_ok_4242",
      idempotencyKey: `fs3-s-${++seq}`,
      context: ctx(),
    });
    if (out.status === "requires_action") {
      out = await confirmShareChallenge({ token, userId: user.id, code: MOCK_3DS_CODE });
    }
    return out;
  }

  const tokenOf = (plan: SplitPlanDTO, position: number) => {
    const url = plan.shares.find((s) => s.position === position)?.inviteUrl;
    expect(url).toBeTruthy();
    return decodeURIComponent(url!.split("/pay/share/")[1]);
  };

  async function counterValue(
    metric: {
      get(): Promise<{ values: Array<{ labels: Record<string, unknown>; value: number }> }>;
    },
    labels: Record<string, string>
  ): Promise<number> {
    const { values } = await metric.get();
    return values
      .filter((v) => Object.entries(labels).every(([k, val]) => v.labels[k] === val))
      .reduce((s, v) => s + v.value, 0);
  }

  async function imbalanceCount(): Promise<number> {
    const m = await ledgerImbalanceTotal.get();
    return m.values.reduce((s, v) => s + v.value, 0);
  }

  /** Mizan dengede, bugünün mutabakatında bu sepete ait fark / yetim olay yok. */
  async function expectLedgerClean(cartId: string) {
    const payments = await prisma.payment.findMany({
      where: { booking: { cartId } },
      select: { id: true },
    });
    const mine = new Set(payments.map((p) => p.id));
    const refs = new Set<string | null>([
      ...(
        await prisma.paymentShare.findMany({ where: { cartId }, select: { providerRef: true } })
      ).map((s) => s.providerRef),
      (await prisma.cartPayment.findUnique({ where: { cartId }, select: { providerRef: true } }))
        ?.providerRef ?? null,
    ]);
    expect(isTrialBalanced(await trialBalance(prisma))).toBe(true);
    const report = await reconcile(iso(new Date()), prisma);
    expect(report.imbalancedEntries).toBe(0);
    expect(report.differences.filter((d) => mine.has(d.subjectId))).toEqual([]);
    expect(report.orphanEvents.filter((e) => refs.has(e.providerRef))).toEqual([]);
    expect(await imbalanceCount()).toBe(0);
  }

  async function removeJob(queue: string, id: string) {
    await (await getQueue(queue as never).getJob(id))?.remove();
  }

  /** Oda-gece envanterinde aşırı satış yok (held + sold ≤ total). */
  async function expectNoOversell(fx: StayFixture) {
    const over = await prisma.inventoryDay.count({
      where: { roomTypeId: fx.roomId, total: { lt: 0 } },
    });
    expect(over).toBe(0);
    const rows = await prisma.inventoryDay.findMany({
      where: { roomTypeId: fx.roomId },
      select: { held: true, sold: true, total: true },
    });
    expect(rows.every((r) => r.held + r.sold <= r.total)).toBe(true);
  }

  beforeAll(async () => {
    expect(await imbalanceCount()).toBe(0);
  });
  afterEach(() => {
    setPaymentProviderForTests(null);
    injectSerializationFaultsForTests("cart_payment.confirm", 0);
    injectSerializationFaultsForTests("split_payment.confirm", 0);
    injectSerializationFaultsForTests("confirm-retry.cart", 0);
    injectSerializationFaultsForTests("confirm-retry.split", 0);
    resetConfigForTests();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("bölünmüş ödeme: tüm paylar ödendi, onay çakışmada tükendi → İADE YOK, confirm-retry ile CONFIRMED", async () => {
    psp = new FaultyPsp();
    setPaymentProviderForTests(psp);
    const { fx, owner, cart } = await heldCart("split", 20);
    const p1 = await newUser("split-p1");
    const plan = await createSplitPlan({
      cartId: cart.id,
      userId: owner.id,
      mode: "equal",
      participants: [{ email: p1.email }],
    });
    const deferredBefore = await counterValue(confirmRetryTotal, { outcome: "deferred" });
    // Pivot onay işlemi ayrı bütçesinin (12 deneme) tamamında serileştirme çakışması alır.
    injectSerializationFaultsForTests("split_payment.confirm", 12);
    expect((await payShareOf(tokenOf(plan, 0), owner)).status).toBe("authorized");
    const last = await payShareOf(tokenOf(plan, 1), p1);
    expect(last).toMatchObject({ status: "authorized", planStatus: "COLLECTING" });

    // Para alındı, iade YOK; onay bekliyor, tutmalar uzatıldı, iş kuyrukta.
    expect(psp.captured).toHaveLength(2);
    expect(psp.refunded).toEqual([]);
    const shares = await prisma.paymentShare.findMany({ where: { planId: plan.id } });
    expect(shares.every((s) => s.status === "CAPTURED")).toBe(true);
    const cp = await prisma.cartPayment.findUniqueOrThrow({ where: { cartId: cart.id } });
    expect(cp.failureCode).toBe(CONFIRM_PENDING);
    const held = await prisma.cart.findUniqueOrThrow({ where: { id: cart.id } });
    expect(held.status).toBe("HELD");
    expect(held.holdExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 10 * 60_000);
    expect(await counterValue(confirmRetryTotal, { outcome: "deferred" })).toBe(deferredBefore + 1);
    const jobId = `confirm-split-${plan.id}`;
    const job = await getQueue(QUEUE_NAMES.confirmRetry).getJob(jobId);
    expect(job?.data).toEqual({ kind: "split", planId: plan.id, cartId: cart.id });
    await removeJob(QUEUE_NAMES.confirmRetry, jobId);
    await expectLedgerClean(cart.id);

    // İş: ilk deneme yine çakışır (son deneme değil) → fırlatır (BullMQ yeniden dener).
    injectSerializationFaultsForTests("confirm-retry.split", 12);
    await expect(
      processConfirmRetry({ kind: "split", planId: plan.id, cartId: cart.id }, { final: false })
    ).rejects.toThrow();
    expect(psp.refunded).toEqual([]);
    // Sonraki deneme başarılı → SETTLED + CONFIRMED, jurnal onayla birlikte.
    expect(
      await processConfirmRetry(
        { kind: "split", planId: plan.id, cartId: cart.id },
        { final: false }
      )
    ).toBe("confirmed");
    const settled = await prisma.splitPlan.findUniqueOrThrow({ where: { id: plan.id } });
    expect(settled.status).toBe("SETTLED");
    const bookings = await prisma.booking.findMany({ where: { cartId: cart.id } });
    expect(bookings.every((b) => b.status === "CONFIRMED")).toBe(true);
    expect(
      await prisma.cartPayment.findUniqueOrThrow({ where: { cartId: cart.id } })
    ).toMatchObject({ status: "PAID", failureCode: null });
    expect(psp.refunded).toEqual([]);
    // İdempotent: tekrar → noop.
    expect(
      await processConfirmRetry(
        { kind: "split", planId: plan.id, cartId: cart.id },
        { final: true }
      )
    ).toBe("noop");
    await expectNoOversell(fx);
    await expectLedgerClean(cart.id);
  });

  it("sepet tek ödemesi: onay ertelendi; tutma düştü ama envanter uygun → yeniden tutulup CONFIRMED", async () => {
    psp = new FaultyPsp();
    setPaymentProviderForTests(psp);
    const { fx, owner, cart } = await heldCart("rehold", 30);
    injectSerializationFaultsForTests("cart_payment.confirm", 12);
    const out = await pay(cart.id, owner);
    expect(out.status).toBe("pending_confirmation");
    const cp = await prisma.cartPayment.findUniqueOrThrow({ where: { cartId: cart.id } });
    expect(cp).toMatchObject({ status: "AUTHORIZED", failureCode: CONFIRM_PENDING });
    expect(psp.refunded).toEqual([]);
    // Aynı ödeme tekrar gönderilirse ikinci yetkilendirme yok, aynı sonuç.
    expect((await pay(cart.id, owner)).status).toBe("pending_confirmation");
    await removeJob(QUEUE_NAMES.confirmRetry, `confirm-cart-${cart.id}-${cp.providerRef}`);
    await expectLedgerClean(cart.id);

    // Worker gecikti: tutmalar düştü (süre dolumu), envanter hâlâ boş.
    await releaseCartHolds(cart.id, "EXPIRED", "hold_timeout");
    expect(
      await processConfirmRetry(
        { kind: "cart", cartId: cart.id, providerRef: cp.providerRef! },
        { final: false }
      )
    ).toBe("confirmed");
    expect(await prisma.cart.findUniqueOrThrow({ where: { id: cart.id } })).toMatchObject({
      status: "CHECKED_OUT",
    });
    const bookings = await prisma.booking.findMany({ where: { cartId: cart.id } });
    expect(bookings.every((b) => b.status === "CONFIRMED")).toBe(true);
    expect(psp.refunded).toEqual([]);
    await expectNoOversell(fx);
    await expectLedgerClean(cart.id);
  });

  it("sepet tek ödemesi: tutma düştü ve envanter başkasına gitti → iade + iptal", async () => {
    psp = new FaultyPsp();
    setPaymentProviderForTests(psp);
    const { fx, owner, cart } = await heldCart("gone", 40);
    injectSerializationFaultsForTests("cart_payment.confirm", 12);
    expect((await pay(cart.id, owner)).status).toBe("pending_confirmation");
    const cp = await prisma.cartPayment.findUniqueOrThrow({ where: { cartId: cart.id } });
    await removeJob(QUEUE_NAMES.confirmRetry, `confirm-cart-${cart.id}-${cp.providerRef}`);
    const refundedBefore = await counterValue(confirmRetryTotal, { outcome: "refunded" });

    await releaseCartHolds(cart.id, "EXPIRED", "hold_timeout");
    const other = await newUser("gone-other");
    await addCartItem(other.id, item(fx, 40));
    expect((await holdCart(other.id)).status).toBe("HELD"); // tek birim artık başkasında

    expect(
      await processConfirmRetry(
        { kind: "cart", cartId: cart.id, providerRef: cp.providerRef! },
        { final: false }
      )
    ).toBe("refunded");
    expect(psp.refunded).toEqual([
      { ref: cp.providerRef, amount: Number(cp.amountMinor), key: `compensate:${cp.providerRef}` },
    ]);
    expect(
      await prisma.cartPayment.findUniqueOrThrow({ where: { cartId: cart.id } })
    ).toMatchObject({ status: "REFUNDED" });
    const bookings = await prisma.booking.findMany({ where: { cartId: cart.id } });
    expect(bookings.every((b) => b.status === "EXPIRED")).toBe(true);
    expect(await counterValue(confirmRetryTotal, { outcome: "refunded" })).toBe(refundedBefore + 1);
    expect(
      await prisma.auditLog.count({
        where: { action: "cart.confirm_retry_refunded", entityId: cart.id },
      })
    ).toBe(1);
    await expectNoOversell(fx);
    await expectLedgerClean(cart.id);
  });

  it("confirm-retry son denemesinde de çakışma → iade (exhausted_refunded)", async () => {
    psp = new FaultyPsp();
    setPaymentProviderForTests(psp);
    const { fx, owner, cart } = await heldCart("exhaust", 50);
    injectSerializationFaultsForTests("cart_payment.confirm", 12);
    expect((await pay(cart.id, owner)).status).toBe("pending_confirmation");
    const cp = await prisma.cartPayment.findUniqueOrThrow({ where: { cartId: cart.id } });
    await removeJob(QUEUE_NAMES.confirmRetry, `confirm-cart-${cart.id}-${cp.providerRef}`);
    const before = await counterValue(confirmRetryTotal, { outcome: "exhausted_refunded" });
    injectSerializationFaultsForTests("confirm-retry.cart", 12);
    expect(
      await processConfirmRetry(
        { kind: "cart", cartId: cart.id, providerRef: cp.providerRef! },
        { final: true }
      )
    ).toBe("refunded");
    expect(psp.refunded).toHaveLength(1);
    expect(await counterValue(confirmRetryTotal, { outcome: "exhausted_refunded" })).toBe(
      before + 1
    );
    const c = await prisma.cart.findUniqueOrThrow({ where: { id: cart.id } });
    expect(c.status).toBe("OPEN"); // kalemler korunur, tutmalar serbest
    await expectNoOversell(fx);
    await expectLedgerClean(cart.id);
  });

  it("PSP provizyon hatası: cart.pay ve pay ödemesi → 502 PAYMENT_PROVIDER_ERROR, yeniden denenebilir", async () => {
    psp = new FaultyPsp();
    setPaymentProviderForTests(psp);
    const { owner, cart } = await heldCart("502", 60);
    const bearer = async (u: U) => (await signAccessToken(u.id, "USER", 300)).token;
    const post = async (path: string, u: U, body: unknown) =>
      new NextRequest(`http://localhost:3000${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `fs3-http-${++seq}`,
          authorization: `Bearer ${await bearer(u)}`,
        },
        body: JSON.stringify(body),
      });

    psp.failAuthorize = 1;
    const res = await cartPayRoute.POST(
      await post(`/api/cart/${cart.id}/pay`, owner, { cardToken: "tok_mock_ok_4242" }),
      { params: Promise.resolve({ id: cart.id }) }
    );
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({
      code: "PAYMENT_PROVIDER_ERROR",
      details: { providerCode: "psp_unavailable" },
    });
    expect(res.headers.get("retry-after")).toBe("5");
    expect(
      await prisma.cartPayment.findUniqueOrThrow({ where: { cartId: cart.id } })
    ).toMatchObject({ status: "FAILED", failureCode: "provider_error:psp_unavailable" });
    expect((await prisma.cart.findUniqueOrThrow({ where: { id: cart.id } })).status).toBe("HELD");

    // Bölünmüş ödeme payı: aynı desen (pay açık kalır).
    const p1 = await newUser("502-p1");
    const plan = await createSplitPlan({
      cartId: cart.id,
      userId: owner.id,
      mode: "equal",
      participants: [{ email: p1.email }],
    });
    const token = tokenOf(plan, 1);
    psp.failAuthorize = 1;
    const shareRes = await shareRoute.POST(
      await post(`/api/pay/share/${encodeURIComponent(token)}`, p1, {
        cardToken: "tok_mock_ok_4242",
      }),
      { params: Promise.resolve({ token: encodeURIComponent(token) }) }
    );
    expect(shareRes.status).toBe(502);
    expect(await shareRes.json()).toMatchObject({ code: "PAYMENT_PROVIDER_ERROR" });
    const share = await prisma.paymentShare.findFirstOrThrow({
      where: { planId: plan.id, position: 1 },
    });
    expect(share.status).toBe("INVITED");
    // Yeniden deneme çalışır.
    expect((await payShareOf(tokenOf(plan, 0), owner)).status).toBe("authorized");
    expect((await payShareOf(token, p1)).status).toBe("confirmed");
    await expectLedgerClean(cart.id);
  });

  it("sepet sagası: capture + void PSP hatası → açık yetkilendirme; saga-compensation-retry void'i tamamlar", async () => {
    psp = new FaultyPsp();
    setPaymentProviderForTests(psp);
    const { owner, cart } = await heldCart("comp", 70);
    const scheduledBefore = await counterValue(sagaCompensationRetryTotal, {
      saga: "cart_payment",
      outcome: "scheduled",
    });
    psp.failCapture = 1;
    psp.failVoid = 1;
    await expect(pay(cart.id, owner)).rejects.toBeInstanceOf(PaymentProviderError);
    const cp = await prisma.cartPayment.findUniqueOrThrow({ where: { cartId: cart.id } });
    // Void düştü: PSP'de yetkilendirme açık, sepet tutmaları yine de serbest.
    expect(cp.status).toBe("AUTHORIZED");
    expect(psp.voided).not.toContain(cp.providerRef);
    expect((await prisma.cart.findUniqueOrThrow({ where: { id: cart.id } })).status).toBe("OPEN");
    expect(
      await counterValue(sagaCompensationRetryTotal, { saga: "cart_payment", outcome: "scheduled" })
    ).toBe(scheduledBefore + 1);
    const jobId = `comp-cart-${cart.id}-${cp.providerRef}`;
    const job = await getQueue(QUEUE_NAMES.sagaCompensationRetry).getJob(jobId);
    expect(job?.data).toEqual({
      saga: "cart_payment",
      cartId: cart.id,
      providerRef: cp.providerRef,
      captured: false,
    });
    await removeJob(QUEUE_NAMES.sagaCompensationRetry, jobId);

    // İş: void bu kez başarılı → VOIDED; tekrar çalışması güvenli.
    expect(await runCompensationRetry(job!.data as CompensationRetryData)).toBe("compensated");
    expect(psp.voided).toContain(cp.providerRef);
    expect(
      await prisma.cartPayment.findUniqueOrThrow({ where: { cartId: cart.id } })
    ).toMatchObject({ status: "VOIDED" });
    expect(psp.refunded).toEqual([]);
    await expectLedgerClean(cart.id);
  });

  it("bölünmüş ödeme sagası: 2. capture + 1. payın iadesi düşer → retry işi iadeyi tamamlar", async () => {
    psp = new FaultyPsp();
    setPaymentProviderForTests(psp);
    const { owner, cart } = await heldCart("comp-split", 80);
    const p1 = await newUser("comp-split-p1");
    const plan = await createSplitPlan({
      cartId: cart.id,
      userId: owner.id,
      mode: "equal",
      participants: [{ email: p1.email }],
    });
    expect((await payShareOf(tokenOf(plan, 0), owner)).status).toBe("authorized");
    psp.captureOkBeforeFail = 1;
    psp.failCapture = 1;
    psp.failRefund = 1;
    await expect(payShareOf(tokenOf(plan, 1), p1)).rejects.toBeInstanceOf(PaymentProviderError);
    let shares = await prisma.paymentShare.findMany({
      where: { planId: plan.id },
      orderBy: { position: "asc" },
    });
    // 1. pay tahsil edildi ama iadesi düştü; 2. payın yetkilendirmesi void edildi.
    expect(shares.map((s) => s.status)).toEqual(["CAPTURED", "VOIDED"]);
    expect((await prisma.splitPlan.findUniqueOrThrow({ where: { id: plan.id } })).status).toBe(
      "ABORTED"
    );
    expect((await prisma.cart.findUniqueOrThrow({ where: { id: cart.id } })).status).toBe("OPEN");
    const jobId = `comp-split-${plan.id}`;
    const job = await getQueue(QUEUE_NAMES.sagaCompensationRetry).getJob(jobId);
    expect(job?.data).toEqual({ saga: "split_payment", planId: plan.id });
    await removeJob(QUEUE_NAMES.sagaCompensationRetry, jobId);

    expect(await runCompensationRetry({ saga: "split_payment", planId: plan.id })).toBe(
      "compensated"
    );
    shares = await prisma.paymentShare.findMany({
      where: { planId: plan.id },
      orderBy: { position: "asc" },
    });
    expect(shares.map((s) => s.status)).toEqual(["REFUNDED", "VOIDED"]);
    expect(psp.refunded).toEqual([
      {
        ref: shares[0].providerRef,
        amount: Number(shares[0].amountMinor),
        key: `compensate:${shares[0].providerRef}`,
      },
    ]);
    // İkinci çalıştırma: yapılacak iş yok, ikinci iade yok.
    await runCompensationRetry({ saga: "split_payment", planId: plan.id });
    expect(psp.refunded).toHaveLength(1);
    await expectLedgerClean(cart.id);
  });

  it("geç başarı sayacı ödemeyi sayar: aynı ödemenin farklı kimlikli ikinci teslimi `redelivered`", async () => {
    setPaymentProviderForTests(new MockPsp());
    const fx = await createStayFixture(prisma, { tag: "fs3-late", units: 1 });
    const b = await fx.hold({ startInDays: 90 });
    const out = await payForBooking({
      bookingId: b.id,
      userId: fx.userId,
      cardToken: "tok_mock_3ds_3220",
      idempotencyKey: `fs3-late-${b.id}`,
    });
    expect(out.status).toBe("requires_action");
    await prisma.booking.update({
      where: { id: b.id },
      data: { holdExpiresAt: new Date(Date.now() - 1000) },
    });
    expect(await releaseHold(b.id)).toBe(true);
    const other = await newUser("late-other");
    await fx.hold({ startInDays: 90, userId: other.id });
    const ref = (await prisma.payment.findUniqueOrThrow({ where: { bookingId: b.id } }))
      .providerRef!;
    const refunded = await counterValue(latePaymentSuccessTotal, { outcome: "refunded" });
    const redelivered = await counterValue(latePaymentSuccessTotal, { outcome: "redelivered" });
    const deliver = (id: string) =>
      handleWebhookEvent({
        id,
        type: "payment.succeeded",
        data: { providerRef: ref, amount: b.totalMinor, currency: "TRY" },
      });
    // P2-3 webhook fırtınası: aynı ödeme farklı kimliklerle EŞZAMANLI teslim edilir.
    const results = await Promise.allSettled(
      ["a", "b", "c", "d"].map((k) => deliver(`evt_fs3_${k}_${ref}`))
    );
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    // Tek ödeme → tek `refunded`; diğer teslimler ya `redelivered` ya idempotent (sayılmaz).
    expect(await counterValue(latePaymentSuccessTotal, { outcome: "refunded" })).toBe(refunded + 1);
    expect(
      await counterValue(latePaymentSuccessTotal, { outcome: "redelivered" })
    ).toBeLessThanOrEqual(redelivered + 3);
    const payment = await prisma.payment.findUniqueOrThrow({ where: { bookingId: b.id } });
    expect(payment.status).toBe("REFUNDED");
    expect(payment.refundedAmountMinor).toBe(payment.amountMinor);
    expect(isTrialBalanced(await trialBalance(prisma))).toBe(true);
    expect(await imbalanceCount()).toBe(0);
  });
});
