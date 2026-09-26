import { Prisma, BookingStatus, CartStatus, PaymentStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { ConflictError, HttpError } from "@/lib/http/errors";
import { isSerializationFailure, withConfirmRetry } from "@/lib/db/transactions";
import { createRedlock, LockError } from "@/lib/distributed-lock/redlock";
import { rerunCompensations, runSaga, type SagaStep } from "@/lib/saga/saga";
import { scheduleCompensationRetry } from "@/lib/saga/compensation-retry";
import { SAGA_STEPS } from "@/lib/saga/booking-saga";
import { getPaymentProvider, type AuthorizeResult } from "@/lib/payment";
import { PaymentProviderError, type PaymentChallenge } from "@/lib/payment/provider";
import {
  applyConfirmation,
  CaptureRaceLostError,
  confirmableBookingSelect,
  nextConfirmedState,
  PaymentDeclinedError,
  PaymentInProgressError,
  PROVIDER_ERROR_PREFIX,
} from "@/lib/payment/payment-service";
import { assessPayment } from "@/lib/risk/fraud";
import { getConfig } from "@/lib/config/app-config";
import { assertCurrency, minorFromDb, minorToDb, money, type Money } from "@/lib/money/money";
import { invalidateBookingCache } from "@/lib/booking/booking-cache";
import { invalidatePropertySearchCache } from "@/lib/search";
import { counter } from "@/lib/observability/metrics";
import { errorFields, logger } from "@/lib/observability/logger";
import { audit } from "@/lib/admin/audit";
import { CartNotFoundError, releaseCartHolds } from "./cart-service";
import { offSessionSetupFor } from "@/lib/payment/psp-customer";
import { CONFIRM_PENDING, deferConfirmation } from "./confirm-pending";

/**
 * Sepetin TEK ödemesi (P1-1): toplam tutar tek PSP yetkilendirmesi → capture → tek işlemde
 * tüm kalem rezervasyonlarının onayı (pivot). Tek rezervasyon sagasının (P0-7) adımları ve
 * onay çekirdeği (`applyConfirmation`: durum + held→sold + defter + jurnal + outbox) aynen
 * kullanılır; her kaleme sepet ödemesine bağlı bir `Payment` (pay) yazılır → jurnal
 * (`booking-captured:<paymentId>`) ve mutabakat rezervasyon düzeyinde dengede kalır.
 *
 * Başarısızlık (ret, 3DS reddi, capture/onay hatası) → tüm tutmalar serbest (sepet OPEN'a
 * döner, kalemler korunur); capture alındıysa tam iade.
 *
 * P1-2 (bölünmüş ödeme) için: `CartPayment` ödeme planıdır; paylar ayrı PSP işlemleri olarak
 * altına eklenir ve bu dosyadaki onay pivotu "tüm paylar tahsil edildi" koşuluna bağlanır.
 */

export const CART_PAYMENT_SAGA = "cart_payment";

const redlock = createRedlock(redis);

const cartPaymentsTotal = counter("cart_payment_total", "Sepet ödemeleri (sonuç)", [
  "outcome",
] as const);

const OPEN_STATUSES: PaymentStatus[] = [
  PaymentStatus.PENDING,
  PaymentStatus.REQUIRES_ACTION,
  PaymentStatus.FAILED,
  PaymentStatus.VOIDED,
];

export type CartPayOutcome =
  | {
      status: "confirmed";
      cartId: string;
      bookingIds: string[];
      amount: number;
      currency: string;
    }
  | { status: "requires_action"; cartId: string; challenge: PaymentChallenge }
  /**
   * fix-sweep-3: capture alındı, onay işlemi çakışmada → iade YOK; `confirm-retry` işi onaylar
   * (HTTP 202). İstemci sepeti yeniden çekerek sonucu görür.
   */
  | {
      status: "pending_confirmation";
      cartId: string;
      bookingIds: string[];
      amount: number;
      currency: string;
    };

export interface PayableCart {
  id: string;
  userId: string;
  status: CartStatus;
  holdExpiresAt: Date | null;
  amount: Money;
  bookingIds: string[];
  propertyIds: string[];
  payment: { status: PaymentStatus; providerRef: string | null; failureCode: string | null } | null;
}

export async function loadPayableCart(cartId: string, userId: string): Promise<PayableCart> {
  const cart = await prisma.cart.findUnique({
    where: { id: cartId },
    select: {
      id: true,
      userId: true,
      status: true,
      currency: true,
      holdExpiresAt: true,
      items: { select: { bookingId: true } },
      bookings: {
        select: { id: true, status: true, totalPriceMinor: true, currency: true, propertyId: true },
      },
      payment: { select: { status: true, providerRef: true, failureCode: true } },
    },
  });
  // IDOR: başkasının sepeti "bulunamadı"
  if (!cart || cart.userId !== userId) throw new CartNotFoundError();
  const itemBookings = new Set(cart.items.map((i) => i.bookingId).filter(Boolean));
  const current = cart.bookings.filter((b) => itemBookings.has(b.id));
  const currency = assertCurrency(cart.currency);
  let total = 0;
  for (const b of current) {
    if (b.currency !== currency) {
      throw new ConflictError("Sepet kalemleri farklı para biriminde", "CART_CURRENCY_MISMATCH");
    }
    total += minorFromDb(b.totalPriceMinor);
  }
  return {
    id: cart.id,
    userId: cart.userId,
    status: cart.status,
    holdExpiresAt: cart.holdExpiresAt,
    amount: money(total, currency),
    bookingIds: current.map((b) => b.id),
    propertyIds: [...new Set(current.map((b) => b.propertyId))],
    payment: cart.payment,
  };
}

function confirmedOutcome(cart: PayableCart): CartPayOutcome {
  return {
    status: "confirmed",
    cartId: cart.id,
    bookingIds: cart.bookingIds,
    amount: cart.amount.amount,
    currency: cart.amount.currency,
  };
}

function pendingOutcome(cart: PayableCart): CartPayOutcome {
  return {
    status: "pending_confirmation",
    cartId: cart.id,
    bookingIds: cart.bookingIds,
    amount: cart.amount.amount,
    currency: cart.amount.currency,
  };
}

function isConfirmPending(cart: PayableCart): boolean {
  return (
    cart.payment?.status === PaymentStatus.AUTHORIZED &&
    cart.payment.failureCode === CONFIRM_PENDING
  );
}

function isCheckedOut(cart: PayableCart): boolean {
  return cart.status === CartStatus.CHECKED_OUT && cart.payment?.status === PaymentStatus.PAID;
}

export async function assertPayableCart(cart: PayableCart): Promise<void> {
  if (cart.status !== CartStatus.HELD) {
    throw new ConflictError("Sepet ödeme beklemiyor", "CART_NOT_HELD");
  }
  if (!cart.holdExpiresAt || cart.holdExpiresAt.getTime() < Date.now()) {
    throw new ConflictError("Sepet tutma süresi doldu", "HOLD_EXPIRED");
  }
  const held = await prisma.booking.count({
    where: { id: { in: cart.bookingIds }, status: BookingStatus.HELD },
  });
  if (held === 0 || held !== cart.bookingIds.length) {
    // Bir kalem tekil olarak düştüyse (iptal/süre) sepet bütün olarak ödenemez → hepsini bırak.
    await releaseCartHolds(cart.id, CartStatus.OPEN, "payment_failed");
    throw new ConflictError("Sepetteki tutmalardan biri artık geçerli değil", "CART_INCOMPLETE");
  }
}

/** P1-2: bölünmüş ödeme planı varken sepet tek ödemeyle ödenemez. */
async function assertNoActiveSplit(cartId: string): Promise<void> {
  const active = await prisma.splitPlan.count({
    where: { cartId, status: { in: ["COLLECTING", "FALLBACK", "SETTLED"] } },
  });
  if (active > 0) {
    throw new ConflictError("Bu sepet için bölünmüş ödeme başlatıldı", "SPLIT_ACTIVE");
  }
}

const attemptsKey = (cartId: string) => `pay:attempts:cart:${cartId}`;

async function assertAttemptsLeft(cartId: string): Promise<void> {
  const max = getConfig().PAYMENT_MAX_ATTEMPTS;
  if (Number((await redis.get(attemptsKey(cartId))) ?? 0) >= max) {
    throw new HttpError(
      429,
      "PAYMENT_ATTEMPTS_EXCEEDED",
      "Çok fazla başarısız ödeme denemesi. Bu sepet için ödeme kapatıldı.",
      { maxAttempts: max }
    );
  }
}

async function recordFailedAttempt(cartId: string): Promise<void> {
  const { PAYMENT_ATTEMPTS_WINDOW_SECONDS } = getConfig();
  await redis.incrWithTtl(attemptsKey(cartId), PAYMENT_ATTEMPTS_WINDOW_SECONDS).catch(() => 0);
}

/** Sepet ödemesi / bölünmüş ödeme payları / süre sonu işi aynı kilitte sıralanır. */
export async function withCartPaymentLock<T>(cartId: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await redlock.withLock(`pay:cart:${cartId}`, fn, {
      ttlMs: 30_000,
      retryCount: 100,
      retryDelayMs: 50,
    });
  } catch (error) {
    if (error instanceof LockError) throw new PaymentInProgressError();
    throw error;
  }
}

/** Ret / 3DS reddi: ödeme FAILED, deneme sayılır ve TÜM tutmalar serbest bırakılır. */
async function failCart(cart: PayableCart, providerRef: string, code: string): Promise<never> {
  await prisma.cartPayment.updateMany({
    where: { cartId: cart.id, status: { in: OPEN_STATUSES } },
    data: { status: PaymentStatus.FAILED, providerRef, failureCode: code },
  });
  cartPaymentsTotal.inc({ outcome: "declined" });
  await recordFailedAttempt(cart.id);
  await releaseCartHolds(cart.id, CartStatus.OPEN, "payment_failed");
  throw new PaymentDeclinedError(code);
}

/** Sepet ödemesi: toplam tutar tek yetkilendirme → capture → tüm kalemler CONFIRMED. */
export async function payCart(input: {
  cartId: string;
  userId: string;
  cardToken: string;
  idempotencyKey: string;
  context?: { ip?: string; ipCountry?: string | null; deviceId?: string | null };
}): Promise<CartPayOutcome> {
  await loadPayableCart(input.cartId, input.userId); // IDOR kontrolü kilitten önce
  return withCartPaymentLock(input.cartId, () => payLocked(input));
}

async function payLocked(input: Parameters<typeof payCart>[0]): Promise<CartPayOutcome> {
  const cart = await loadPayableCart(input.cartId, input.userId);
  if (isCheckedOut(cart)) return confirmedOutcome(cart);
  // fix-sweep-3: tahsil edildi, onay kuyrukta → aynı sonuç (ikinci yetkilendirme YOK).
  if (isConfirmPending(cart)) return pendingOutcome(cart);
  await assertPayableCart(cart);
  await assertAttemptsLeft(cart.id);
  await assertNoActiveSplit(cart.id);

  // Fraud v2 kuralları (tek rezervasyonla aynı). Passkey step-up rezervasyona bağlı olduğundan
  // sepette step-up/challenge kararları 3DS'e düşer; deny → 403.
  const [account, recentFailed] = await Promise.all([
    prisma.user.findUnique({ where: { id: input.userId }, select: { createdAt: true } }),
    prisma.payment.count({
      where: {
        userId: input.userId,
        status: PaymentStatus.FAILED,
        updatedAt: { gte: new Date(Date.now() - 86_400_000) },
      },
    }),
  ]);
  const risk = await assessPayment(redis, {
    userId: input.userId,
    ip: input.context?.ip ?? "unknown",
    cardToken: input.cardToken,
    amountMinor: cart.amount.amount,
    accountCreatedAt: account?.createdAt ?? new Date(),
    recentFailedPayments: recentFailed,
    ipCountry: input.context?.ipCountry,
    cardBin: null,
    deviceId: input.context?.deviceId,
  });
  await prisma.fraudCheck.createMany({
    data: cart.bookingIds.map((bookingId) => ({
      bookingId,
      userId: input.userId,
      score: risk.score,
      decision: risk.decision,
      reasons: [
        ...risk.hits,
        { rule: "cart", points: 0, detail: `cart:${cart.id}` },
      ] as unknown as Prisma.InputJsonValue,
    })),
  });
  if (risk.decision === "deny") {
    cartPaymentsTotal.inc({ outcome: "fraud_blocked" });
    throw new HttpError(403, "FRAUD_BLOCKED", "Ödeme güvenlik kontrolünden geçemedi", {
      score: risk.score,
    });
  }
  const force3ds = risk.decision === "challenge_3ds" || risk.decision === "step_up_passkey";

  const provider = getPaymentProvider();
  await prisma.cartPayment.upsert({
    where: { cartId: cart.id },
    create: {
      cartId: cart.id,
      userId: input.userId,
      amountMinor: minorToDb(cart.amount.amount),
      currency: cart.amount.currency,
      provider: provider.name,
    },
    update: {
      amountMinor: minorToDb(cart.amount.amount),
      currency: cart.amount.currency,
      provider: provider.name,
    },
  });

  // fix-sweep-2: sepette depozito gereken kalem varsa kart müşteriye kaydedilir (Stripe).
  const offSession = await offSessionSetupFor(
    provider,
    input.userId,
    await prisma.cartItem.findMany({
      where: { cartId: cart.id },
      select: { propertyId: true, roomTypeId: true },
    })
  );
  let result: AuthorizeResult;
  try {
    result = await provider.authorize({
      ...offSession,
      amount: cart.amount,
      cardToken: input.cardToken,
      idempotencyKey: `auth:cart:${cart.id}:${input.idempotencyKey}`,
      metadata: { cartId: cart.id, ...(force3ds ? { force3ds: "1" } : {}) },
    });
  } catch (error) {
    if (error instanceof PaymentProviderError) {
      // fix-sweep-3 (fix-sweep-2 deseni): sağlayıcı hatası ret değildir → sepet ödemesi FAILED
      // + `provider_error:<kod>` (açık durum, yeniden ödenebilir), deneme hakkı DÜŞMEZ, tutmalar
      // korunur; HTTP 502 PAYMENT_PROVIDER_ERROR + Retry-After (`toErrorResponse`).
      await prisma.cartPayment.updateMany({
        where: { cartId: cart.id, status: { in: OPEN_STATUSES } },
        data: {
          status: PaymentStatus.FAILED,
          failureCode: `${PROVIDER_ERROR_PREFIX}${error.code}`.slice(0, 64),
        },
      });
      cartPaymentsTotal.inc({ outcome: "provider_error" });
    }
    throw error;
  }
  if (result.status === "declined") {
    return failCart(cart, result.providerRef, result.declineCode);
  }
  if (result.status === "requires_action") {
    const recorded = await prisma.cartPayment.updateMany({
      where: { cartId: cart.id, status: { in: OPEN_STATUSES } },
      data: {
        status: PaymentStatus.REQUIRES_ACTION,
        providerRef: result.providerRef,
        failureCode: null,
      },
    });
    if (recorded.count !== 1) {
      await provider.void(result.providerRef).catch(() => undefined);
      throw new PaymentInProgressError();
    }
    cartPaymentsTotal.inc({ outcome: "requires_action" });
    return { status: "requires_action", cartId: cart.id, challenge: result.challenge };
  }
  return captureAndConfirmCart(cart, result.providerRef, OPEN_STATUSES);
}

/** 3DS doğrulamasını tamamlar ve sepeti tahsil eder. */
export async function confirmCartChallenge(input: {
  cartId: string;
  userId: string;
  code: string;
}): Promise<CartPayOutcome> {
  await loadPayableCart(input.cartId, input.userId);
  return withCartPaymentLock(input.cartId, async () => {
    const cart = await loadPayableCart(input.cartId, input.userId);
    if (isCheckedOut(cart)) return confirmedOutcome(cart);
    if (isConfirmPending(cart)) return pendingOutcome(cart);
    if (cart.payment?.status !== PaymentStatus.REQUIRES_ACTION || !cart.payment.providerRef) {
      throw new ConflictError("Doğrulama bekleyen ödeme yok", "NO_PENDING_CHALLENGE");
    }
    await assertPayableCart(cart);
    await assertAttemptsLeft(cart.id);
    const ref = cart.payment.providerRef;
    const result = await getPaymentProvider().confirmChallenge(ref, input.code);
    if (result.status === "declined") return failCart(cart, ref, result.declineCode);
    if (result.status === "requires_action") {
      await recordFailedAttempt(cart.id);
      throw new ConflictError("Doğrulama kodu hatalı", "CHALLENGE_FAILED");
    }
    return captureAndConfirmCart(cart, result.providerRef, [PaymentStatus.REQUIRES_ACTION]);
  });
}

interface CartSagaCtx {
  cart: PayableCart;
  providerRef: string;
  claimFrom: readonly PaymentStatus[];
  claimed: boolean;
  captured: boolean;
}

/**
 * Sepet ödeme sagası (P0-7 ile aynı adımlar): hold → authorize → capture → confirm (pivot).
 * Telafiler ters sırada: iade → void → TÜM tutmaları bırak.
 */
const CART_SAGA_STEPS: SagaStep<CartSagaCtx, CartPayOutcome>[] = [
  {
    name: SAGA_STEPS.hold,
    run: async () => undefined,
    compensate: async (ctx) =>
      (await releaseCartHolds(ctx.cart.id, CartStatus.OPEN, "payment_failed")) !== null,
  },
  {
    name: SAGA_STEPS.authorize,
    run: async () => undefined,
    compensate: async (ctx) => {
      if (ctx.captured) return false;
      await getPaymentProvider().void(ctx.providerRef);
      await prisma.cartPayment.updateMany({
        where: ctx.claimed
          ? { cartId: ctx.cart.id, providerRef: ctx.providerRef, status: PaymentStatus.AUTHORIZED }
          : { cartId: ctx.cart.id, status: { in: [...ctx.claimFrom] } },
        data: { status: PaymentStatus.VOIDED, failureCode: "saga_aborted" },
      });
    },
  },
  {
    name: SAGA_STEPS.capture,
    run: async (ctx) => {
      const claimed = await prisma.cartPayment.updateMany({
        where: { cartId: ctx.cart.id, status: { in: [...ctx.claimFrom] } },
        data: {
          status: PaymentStatus.AUTHORIZED,
          providerRef: ctx.providerRef,
          authorizedAt: new Date(),
          failureCode: null,
        },
      });
      if (claimed.count !== 1) {
        await getPaymentProvider()
          .void(ctx.providerRef)
          .catch(() => undefined);
        throw new PaymentInProgressError();
      }
      ctx.claimed = true;
      try {
        await getPaymentProvider().capture(ctx.providerRef, ctx.cart.amount);
      } catch (error) {
        cartPaymentsTotal.inc({ outcome: "capture_failed" });
        throw error;
      }
      ctx.captured = true;
    },
    compensate: async (ctx) => {
      if (!ctx.captured) return false;
      // İade anahtarı providerRef'e bağlı → tekrar çağrılsa da PSP tek iade yapar.
      await getPaymentProvider().refund(
        ctx.providerRef,
        ctx.cart.amount,
        `compensate:${ctx.providerRef}`
      );
      const now = new Date();
      await prisma.$transaction([
        prisma.cartPayment.updateMany({
          where: {
            cartId: ctx.cart.id,
            providerRef: ctx.providerRef,
            status: { not: PaymentStatus.PAID },
          },
          data: {
            status: PaymentStatus.REFUNDED,
            paidAt: now,
            refundedAmountMinor: minorToDb(ctx.cart.amount.amount),
            refundedAt: now,
            failureCode: "CART_NOT_CONFIRMABLE",
          },
        }),
        prisma.paymentEvent.upsert({
          where: { id: `comp:${ctx.providerRef}` },
          create: {
            id: `comp:${ctx.providerRef}`,
            type: "compensation.cart",
            providerRef: ctx.providerRef,
          },
          update: {},
        }),
      ]);
      cartPaymentsTotal.inc({ outcome: "compensated" });
      await audit("system:payment", "cart.payment_compensated", "Cart", ctx.cart.id, {
        providerRef: ctx.providerRef,
        amountMinor: ctx.cart.amount.amount,
      }).catch((error) => logger.warn(errorFields(error), "audit failed"));
    },
  },
  {
    name: SAGA_STEPS.confirm,
    pivot: true,
    run: async (ctx) => {
      try {
        await withConfirmRetry((tx) => confirmCartInTransaction(tx, ctx.cart.id, ctx.providerRef), {
          timeout: 30_000,
          maxWait: 10_000,
          label: `${CART_PAYMENT_SAGA}.confirm`,
        });
      } catch (error) {
        // fix-sweep-3: capture alındı; geçici çakışma iade sebebi DEĞİL → onayı kuyruğa al.
        if (!isSerializationFailure(error)) throw error;
        await deferConfirmation({
          kind: "cart",
          cartId: ctx.cart.id,
          providerRef: ctx.providerRef,
        });
        cartPaymentsTotal.inc({ outcome: "confirm_pending" });
        return { done: pendingOutcome(ctx.cart) };
      }
      cartPaymentsTotal.inc({ outcome: "confirmed" });
      for (const propertyId of ctx.cart.propertyIds) {
        await invalidatePropertySearchCache(propertyId).catch(() => undefined);
      }
      for (const id of ctx.cart.bookingIds) await invalidateBookingCache(id).catch(() => 0);
      return { done: confirmedOutcome({ ...ctx.cart, status: CartStatus.CHECKED_OUT }) };
    },
  },
];

async function captureAndConfirmCart(
  cart: PayableCart,
  providerRef: string,
  claimFrom: readonly PaymentStatus[]
): Promise<CartPayOutcome> {
  const ctx: CartSagaCtx = { cart, providerRef, claimFrom, claimed: false, captured: false };
  return runSaga(CART_PAYMENT_SAGA, CART_SAGA_STEPS, ctx, {
    from: SAGA_STEPS.capture,
    // fix-sweep-3: void/iade düştüyse açık yetkilendirme / iade edilmemiş tahsilat kalmasın.
    onCompensationFailed: (steps) =>
      scheduleCompensationRetry(
        { saga: "cart_payment", cartId: cart.id, providerRef, captured: ctx.captured },
        steps
      ),
  });
}

/**
 * fix-sweep-3: sepet ödemesinin telafisini DB'den kurulan bağlamla (idempotent) yeniden
 * çalıştırır — `saga-compensation-retry` işi ve onaylanamayan `confirm-retry` işi kullanır.
 * Sepet ödemesi bu ref'le PAID ise (onay kazandı) hiçbir şey yapılmaz. Yine başarısızsa fırlatır.
 */
export async function compensateCartPayment(input: {
  cartId: string;
  providerRef: string;
  captured: boolean;
}): Promise<"compensated" | "noop"> {
  const cp = await prisma.cartPayment.findUnique({
    where: { cartId: input.cartId },
    select: { status: true, providerRef: true, amountMinor: true, currency: true, userId: true },
  });
  if (!cp) return "noop";
  if (cp.providerRef !== input.providerRef) {
    // Tahsil hakkını hiç almamış (yarışı kaybetmiş) yetkilendirme: yalnız PSP'de void; satıra
    // dokunulmaz (satır başka bir ödemenindir).
    if (input.captured) return "noop";
    await getPaymentProvider().void(input.providerRef);
    return "compensated";
  }
  if (cp.status === PaymentStatus.PAID) return "noop";
  const cart: PayableCart = {
    id: input.cartId,
    userId: cp.userId,
    status: CartStatus.HELD,
    holdExpiresAt: null,
    amount: money(minorFromDb(cp.amountMinor), assertCurrency(cp.currency)),
    bookingIds: [],
    propertyIds: [],
    payment: null,
  };
  const ctx: CartSagaCtx = {
    cart,
    providerRef: input.providerRef,
    claimFrom: OPEN_STATUSES,
    claimed: true,
    captured: input.captured,
  };
  const steps = CART_SAGA_STEPS.filter((s) => s.name !== SAGA_STEPS.confirm);
  await rerunCompensations(CART_PAYMENT_SAGA, steps as SagaStep<CartSagaCtx, unknown>[], ctx);
  return "compensated";
}

/**
 * Pivot (tek işlem): sepet HELD→CHECKED_OUT, sepet ödemesi AUTHORIZED→PAID ve HER kalem için
 * pay `Payment`'ı + `applyConfirmation` (HELD→CONFIRMED, held→sold, defter, jurnal, outbox).
 * Bir kalem onaylanamazsa (süre doldu, eşzamanlı değişiklik) HİÇBİRİ onaylanmaz → saga iade eder.
 */
export async function confirmCartInTransaction(
  tx: Prisma.TransactionClient,
  cartId: string,
  providerRef: string
): Promise<string[]> {
  await tx.$queryRaw`SELECT id FROM "Cart" WHERE id = ${cartId} FOR UPDATE`;
  const cart = await tx.cart.findUnique({
    where: { id: cartId },
    select: {
      status: true,
      payment: {
        select: { id: true, status: true, providerRef: true, amountMinor: true, provider: true },
      },
    },
  });
  if (!cart?.payment) throw new CartNotFoundError();
  if (cart.payment.status === PaymentStatus.PAID) {
    if (cart.payment.providerRef === providerRef) {
      const paid = await tx.payment.findMany({
        where: { cartPaymentId: cart.payment.id },
        select: { id: true },
      });
      return paid.map((p) => p.id); // idempotent
    }
    throw new CaptureRaceLostError();
  }
  if (cart.status !== CartStatus.HELD) {
    throw new ConflictError("Sepet artık onaylanamaz", "CART_NOT_CONFIRMABLE");
  }
  const bookings = await loadConfirmableCartBookings(tx, cartId, cart.payment.amountMinor);
  const claimed = await tx.cartPayment.updateMany({
    where: { id: cart.payment.id, providerRef, status: PaymentStatus.AUTHORIZED },
    data: { status: PaymentStatus.PAID, paidAt: new Date(), failureCode: null },
  });
  if (claimed.count !== 1) throw new CaptureRaceLostError();
  return confirmCartBookingsInTx(tx, cartId, bookings, cart.payment, providerRef);
}

type ConfirmableCartBooking = Prisma.BookingGetPayload<{ select: typeof confirmableBookingSelect }>;

/**
 * Sepetin onaylanacak kalem rezervasyonları (kimliğe göre sıralı). Kalem eksikse ya da toplam
 * ödeme planıyla uyuşmuyorsa ConflictError → çağıran telafi eder (iade).
 */
export async function loadConfirmableCartBookings(
  tx: Prisma.TransactionClient,
  cartId: string,
  expectedTotalMinor: bigint
): Promise<ConfirmableCartBooking[]> {
  const items = await tx.cartItem.findMany({ where: { cartId }, select: { bookingId: true } });
  const bookingIds = items.map((i) => i.bookingId).filter((id): id is string => !!id);
  const bookings = await tx.booking.findMany({
    where: { id: { in: bookingIds }, cartId },
    select: confirmableBookingSelect,
    orderBy: { id: "asc" },
  });
  if (bookings.length === 0 || bookings.length !== items.length) {
    throw new ConflictError("Sepet kalemleri eksik", "CART_INCOMPLETE");
  }
  const total = bookings.reduce((sum, b) => sum + b.totalPriceMinor, 0n);
  if (total !== expectedTotalMinor) {
    throw new ConflictError("Sepet tutarı değişti", "CART_AMOUNT_MISMATCH");
  }
  return bookings;
}

/**
 * Onay çekirdeği (tek sepet ödemesi ve bölünmüş ödeme ortak): HER kalem için pay `Payment`'ı
 * + `applyConfirmation` (HELD→CONFIRMED, held→sold, defter, jurnal, outbox) ve sepet
 * HELD→CHECKED_OUT. `ledgerRef` eski defter satırının referansıdır (PSP işlemi ya da plan).
 */
export async function confirmCartBookingsInTx(
  tx: Prisma.TransactionClient,
  cartId: string,
  bookings: ConfirmableCartBooking[],
  cartPayment: { id: string; provider: string },
  ledgerRef: string
): Promise<string[]> {
  const nexts = bookings.map((b) => nextConfirmedState(b));
  const now = new Date();
  const paymentIds: string[] = [];
  for (const [i, booking] of bookings.entries()) {
    const payment = await tx.payment.create({
      data: {
        bookingId: booking.id,
        userId: booking.userId,
        amountMinor: booking.totalPriceMinor,
        currency: booking.currency,
        provider: cartPayment.provider,
        providerRef: null,
        status: PaymentStatus.PAID,
        authorizedAt: now,
        paidAt: now,
        cartPaymentId: cartPayment.id,
      },
      select: { id: true, amountMinor: true },
    });
    await applyConfirmation(tx, booking, nexts[i], payment, ledgerRef);
    paymentIds.push(payment.id);
  }
  const moved = await tx.cart.updateMany({
    where: { id: cartId, status: CartStatus.HELD },
    data: {
      status: CartStatus.CHECKED_OUT,
      checkedOutAt: now,
      holdExpiresAt: null,
      version: { increment: 1 },
    },
  });
  if (moved.count !== 1) {
    throw new ConflictError("Sepet eşzamanlı olarak değişti", "CONCURRENT_UPDATE");
  }
  return paymentIds;
}
