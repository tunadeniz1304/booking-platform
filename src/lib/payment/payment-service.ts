import { Prisma, PaymentStatus, type BookingStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { appendOutbox } from "@/lib/cqrs";
import {
  EventTypes,
  makeEvent,
  type BookingCancelledPayload,
  type BookingConfirmedPayload,
} from "@/lib/events/events";
import { ConflictError, HttpError } from "@/lib/http/errors";
import { withSerializableRetry } from "@/lib/db/transactions";
import { createRedlock, LockError } from "@/lib/distributed-lock/redlock";
import { transition, type BookingState } from "@/lib/booking/state-machine";
import { computeRefund, parseSnapshot, type RefundDecision } from "@/lib/booking/cancellation";
import { releaseHold, releaseInventory, BookingNotFoundError } from "@/lib/booking-service";
import { runSaga, type SagaStep } from "@/lib/saga/saga";
import { PAYMENT_SAGA, SAGA_STEPS } from "@/lib/saga/booking-saga";
import { invalidatePropertySearchCache } from "@/lib/search";
import { money, toDecimalString, toMinor, assertCurrency, type Money } from "@/lib/money/money";
import { clockOf, fromDate } from "@/lib/time/nights";
import { commitHeld } from "@/lib/booking/inventory";
import { logger, errorFields } from "@/lib/observability/logger";
import { counter } from "@/lib/observability/metrics";
import { audit } from "@/lib/admin/audit";
import { getPaymentProvider, type AuthorizeResult } from "./index";
import type { WebhookEvent } from "./webhook";
import type { PaymentChallenge } from "./provider";
import { assessPayment, type FraudDecision } from "@/lib/risk/fraud";
import { consumeStepUp, hasPasskey } from "@/lib/auth/passkey";
import { getConfig } from "@/lib/config/app-config";
import { getQueue, QUEUE_NAMES } from "@/lib/queue";

/** BullMQ `refund-retry` kuyruğundaki iş adı (v4#7). */
export const REFUND_RETRY_JOB = "refund-retry";

/**
 * Ödeme orkestrasyonu (P0-5, v3 P0-6).
 *
 *   checkout → authorize ─┬─ authorized ──→ claim → capture → HELD→CONFIRMED (tek işlem)
 *                         ├─ requires_action (3DS) → confirmChallenge → …
 *                         └─ declined → booking HELD kalır (başka kartla denenebilir;
 *                                        süre dolarsa expire-holds EXPIRED yapar)
 *
 * Çift tahsilat kanıtlı imkânsızdır (v3#1), iki katman:
 *  1. Booking başına Redis kilidi (`pay:<bookingId>`): iki sekme / farklı Idempotency-Key /
 *     gRPC `Charge` aynı rezervasyonu SIRAYLA işler; ikinci istek onaylı rezervasyonu görür.
 *  2. Veritabanında `Payment` üzerinde koşullu durum geçişi: tahsil hakkı yalnızca satırı
 *     "açık" durumdan (PENDING/REQUIRES_ACTION/FAILED/VOIDED) AUTHORIZED'a çeviren tek
 *     yetkilendirmeye verilir (`updateMany … where status in (…)`). Kilit kaybolsa bile
 *     yarışı kaybeden yetkilendirme `void` edilir; kaybeden bir capture (ör. geç gelen PSP
 *     webhook'u) otomatik iade edilir ve `payment_capture_race_total` artar.
 *
 * Kart verisi sunucuya gelmez (yalnızca `cardToken`). PSP çağrıları veritabanı işleminin
 * DIŞINDA yapılır. Tüm tutarlar minor-unit.
 */

const paymentsTotal = counter("payment_attempts_total", "Ödeme denemeleri", ["outcome"] as const);
export const captureRaceTotal = counter(
  "payment_capture_race_total",
  "Yarışı kaybedip telafi edilen yetkilendirme/tahsilatlar",
  ["action"] as const
);

const redlock = createRedlock(redis);

/** Tahsil hakkı alınabilecek (henüz para çekilmemiş) ödeme durumları. */
const OPEN_STATUSES: PaymentStatus[] = [
  PaymentStatus.PENDING,
  PaymentStatus.REQUIRES_ACTION,
  PaymentStatus.FAILED,
  PaymentStatus.VOIDED,
];
/** Parası çekilmiş (bir daha tahsil edilemez) durumlar. */
const SETTLED_STATUSES: PaymentStatus[] = [
  PaymentStatus.PAID,
  PaymentStatus.PARTIALLY_REFUNDED,
  PaymentStatus.REFUNDED,
];

export class PaymentDeclinedError extends HttpError {
  constructor(code: string) {
    super(402, "PAYMENT_DECLINED", "Ödeme reddedildi. Lütfen başka bir kart deneyin.", {
      declineCode: code,
    });
    this.name = "PaymentDeclinedError";
  }
}

export class PaymentInProgressError extends ConflictError {
  constructor() {
    super("Bu rezervasyon için başka bir ödeme işleniyor", "PAYMENT_IN_PROGRESS");
    this.name = "PaymentInProgressError";
  }
}

/** Başka bir yetkilendirme tahsil hakkını aldı; bu deneme telafi edilmeli. */
export class CaptureRaceLostError extends ConflictError {
  constructor() {
    super("Bu rezervasyon başka bir ödemeyle zaten tahsil edildi", "ALREADY_PAID");
    this.name = "CaptureRaceLostError";
  }
}

/** Webhook tutarı/para birimi kayıtlı ödemeyle uyuşmuyor (v3#2). */
export class WebhookMismatchError extends HttpError {
  constructor() {
    super(400, "WEBHOOK_MISMATCH", "Olay tutarı veya para birimi ödemeyle uyuşmuyor");
    this.name = "WebhookMismatchError";
  }
}

export type PayOutcome =
  | { status: "confirmed"; bookingId: string; paymentId: string; amount: number; currency: string }
  | { status: "requires_action"; bookingId: string; challenge: PaymentChallenge };

interface PayableBooking {
  id: string;
  userId: string;
  status: BookingStatus;
  version: number;
  propertyId: string;
  roomId: string;
  checkIn: Date;
  checkOut: Date;
  holdExpiresAt: Date | null;
  totalPrice: Prisma.Decimal;
  currency: string;
  payment: { id: string; status: PaymentStatus; providerRef: string | null } | null;
}

async function loadPayable(bookingId: string, userId: string): Promise<PayableBooking> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      userId: true,
      status: true,
      version: true,
      propertyId: true,
      roomId: true,
      checkIn: true,
      checkOut: true,
      holdExpiresAt: true,
      totalPrice: true,
      currency: true,
      payment: { select: { id: true, status: true, providerRef: true } },
    },
  });
  // IDOR: başkasının rezervasyonu "bulunamadı"
  if (!booking || booking.userId !== userId) throw new BookingNotFoundError();
  return booking;
}

function amountOf(booking: { totalPrice: Prisma.Decimal; currency: string }): Money {
  const currency = assertCurrency(booking.currency);
  return money(toMinor(booking.totalPrice.toString(), currency), currency);
}

/**
 * Ödeme satırını KOŞULLU olarak günceller: yalnızca satır `from` durumlarındaysa
 * (veya hiç yoksa oluşturarak). Parası çekilmiş bir satır (PAID…) asla ezilmez (v3#1).
 * @returns güncellendiyse ödeme kimliği, koşul tutmadıysa `null`
 */
async function transitionPayment(
  booking: PayableBooking,
  from: readonly PaymentStatus[],
  data: {
    status: PaymentStatus;
    providerRef?: string;
    failureCode?: string | null;
    authorizedAt?: Date;
  },
  where: { providerRef?: string } = {}
): Promise<string | null> {
  const amount = amountOf(booking);
  const provider = getPaymentProvider().name;
  const updated = await prisma.payment.updateMany({
    where: { bookingId: booking.id, status: { in: [...from] }, ...where },
    data: { ...data, provider },
  });
  if (updated.count === 1) {
    const row = await prisma.payment.findUniqueOrThrow({
      where: { bookingId: booking.id },
      select: { id: true },
    });
    return row.id;
  }
  if (where.providerRef) return null;
  try {
    const created = await prisma.payment.create({
      data: {
        bookingId: booking.id,
        userId: booking.userId,
        amount: new Prisma.Decimal(toDecimalString(amount)),
        currency: amount.currency,
        provider,
        ...data,
      },
      select: { id: true },
    });
    return created.id;
  } catch (error) {
    // Satır zaten var ama koşul tutmadı (ör. başka yetkilendirme kazandı).
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return null;
    }
    throw error;
  }
}

/** Yarışı kaybeden yetkilendirmeyi bırakır (para çekilmedi). */
async function voidLoser(bookingId: string, providerRef: string): Promise<void> {
  captureRaceTotal.inc({ action: "void" });
  logger.warn({ bookingId, providerRef }, "payment race lost; voiding authorization");
  await getPaymentProvider()
    .void(providerRef)
    .catch((e) => logger.error({ bookingId, ...errorFields(e) }, "loser void failed"));
}

/**
 * Yarışı kaybeden (ama PSP'de tahsil edilmiş) ödemeyi iade eder ve denetim izi bırakır.
 * İade anahtarı providerRef'e bağlıdır → tekrar çağrılırsa PSP tek iade yapar.
 */
async function refundLoser(
  bookingId: string,
  providerRef: string,
  amount: Money,
  reason: string
): Promise<void> {
  captureRaceTotal.inc({ action: "refund" });
  logger.warn({ bookingId, providerRef, reason }, "capture could not be applied; refunding");
  await getPaymentProvider().refund(providerRef, amount, `compensate:${providerRef}`);
  await prisma.paymentEvent
    .create({
      data: { id: `comp:${providerRef}`, type: `compensation.${reason}`, providerRef },
    })
    .catch((error) => {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) {
        throw error;
      }
    });
}

interface PaymentSagaCtx {
  booking: PayableBooking;
  providerRef: string;
  amount: Money;
  claimFrom: readonly PaymentStatus[];
  claimed: boolean;
  captured: boolean;
}

/**
 * Ödeme sagası (P0-7, ADR 0013): hold → authorize → capture → confirm (pivot).
 * Onay sonrası fatura → bildirim, outbox `BookingConfirmed` üzerinden BullMQ FlowProducer
 * ile ileri-kurtarmalı yürür (`booking-saga.ts`). Telafiler: iade → void → tutmayı bırak.
 * Tahsil, onaydan ÖNCE yapılır: CONFIRMED ⇒ para çekilmiş (v3#1 değişmezi).
 */
const PAYMENT_SAGA_STEPS: SagaStep<PaymentSagaCtx, PayOutcome>[] = [
  {
    name: SAGA_STEPS.hold,
    // Tutma rezervasyon anında alındı (saga dışı, `from`); adım yalnızca telafiyi taşır.
    run: async () => undefined,
    compensate: (ctx) => releaseHold(ctx.booking.id),
  },
  {
    name: SAGA_STEPS.authorize,
    // Provizyon PSP'de saga öncesi alındı (3DS olabilir); adım yalnızca telafiyi taşır.
    run: async () => undefined,
    compensate: async (ctx) => {
      if (ctx.captured) return false;
      await getPaymentProvider().void(ctx.providerRef);
      // Tahsil hakkı alındıysa satır AUTHORIZED(providerRef), alınmadıysa hâlâ açık durumdadır.
      await prisma.payment.updateMany({
        where: ctx.claimed
          ? {
              bookingId: ctx.booking.id,
              providerRef: ctx.providerRef,
              status: PaymentStatus.AUTHORIZED,
            }
          : { bookingId: ctx.booking.id, status: { in: [...ctx.claimFrom] } },
        data: { status: PaymentStatus.VOIDED, failureCode: "saga_aborted" },
      });
    },
  },
  {
    name: SAGA_STEPS.capture,
    run: async (ctx) => {
      // Tahsil hakkı: ödeme satırı koşullu olarak AUTHORIZED(providerRef) yapılır.
      const claimed = await transitionPayment(ctx.booking, ctx.claimFrom, {
        status: PaymentStatus.AUTHORIZED,
        providerRef: ctx.providerRef,
        authorizedAt: new Date(),
        failureCode: null,
      });
      if (!claimed) {
        await voidLoser(ctx.booking.id, ctx.providerRef);
        return { done: await alreadyConfirmed(ctx.booking.id, ctx.booking.userId) };
      }
      ctx.claimed = true;
      try {
        await getPaymentProvider().capture(ctx.providerRef, ctx.amount);
      } catch (error) {
        paymentsTotal.inc({ outcome: "capture_failed" });
        throw error;
      }
      ctx.captured = true;
    },
    compensate: async (ctx) => {
      if (!ctx.captured) return false;
      // İade anahtarı providerRef'e bağlı → tekrar çağrılsa da PSP tek iade yapar.
      await getPaymentProvider().refund(
        ctx.providerRef,
        ctx.amount,
        `compensate:${ctx.providerRef}`
      );
      await prisma.payment.updateMany({
        where: {
          bookingId: ctx.booking.id,
          providerRef: ctx.providerRef,
          status: { notIn: SETTLED_STATUSES },
        },
        data: {
          status: PaymentStatus.REFUNDED,
          refundedAmount: new Prisma.Decimal(toDecimalString(ctx.amount)),
          refundedAt: new Date(),
          failureCode: "BOOKING_NOT_CONFIRMABLE",
        },
      });
      paymentsTotal.inc({ outcome: "compensated" });
    },
  },
  {
    name: SAGA_STEPS.confirm,
    pivot: true,
    run: async (ctx) => {
      // HELD→CONFIRMED + PAID + defter + outbox (tek işlem).
      const paymentId = await withSerializableRetry((tx) =>
        confirmInTransaction(tx, ctx.booking.id, ctx.providerRef)
      );
      paymentsTotal.inc({ outcome: "confirmed" });
      await afterBookingWrite(ctx.booking.propertyId, ctx.booking.id);
      return {
        done: {
          status: "confirmed",
          bookingId: ctx.booking.id,
          paymentId,
          amount: ctx.amount.amount,
          currency: ctx.amount.currency,
        },
      };
    },
  },
];

/** Yetkilendirilmiş ödemeyi saga ile tahsil eder ve rezervasyonu onaylar. */
async function captureAndConfirm(
  booking: PayableBooking,
  providerRef: string,
  claimFrom: readonly PaymentStatus[] = OPEN_STATUSES
): Promise<PayOutcome> {
  const ctx: PaymentSagaCtx = {
    booking,
    providerRef,
    amount: amountOf(booking),
    claimFrom,
    claimed: false,
    captured: false,
  };
  try {
    return await runSaga(PAYMENT_SAGA, PAYMENT_SAGA_STEPS, ctx, { from: SAGA_STEPS.capture });
  } catch (error) {
    if (error instanceof CaptureRaceLostError) {
      // Başka bir ödeme bu arada onayladı: bizimki iade edildi → idempotent sonuç.
      captureRaceTotal.inc({ action: "refund" });
      return alreadyConfirmed(booking.id, booking.userId);
    }
    throw error;
  }
}

/** Rezervasyon başka bir ödemeyle onaylandıysa onu (idempotent sonuç) döner. */
async function alreadyConfirmed(bookingId: string, userId: string): Promise<PayOutcome> {
  const fresh = await loadPayable(bookingId, userId);
  if (
    fresh.status === "CONFIRMED" &&
    fresh.payment &&
    SETTLED_STATUSES.includes(fresh.payment.status)
  ) {
    const amount = amountOf(fresh);
    return {
      status: "confirmed",
      bookingId,
      paymentId: fresh.payment.id,
      amount: amount.amount,
      currency: amount.currency,
    };
  }
  throw new PaymentInProgressError();
}

/**
 * HELD → CONFIRMED + ödeme PAID + defter kaydı + outbox (tek işlem).
 * Aynı providerRef ile tekrar çağrılırsa idempotent; FARKLI bir providerRef ile çağrılırsa
 * (rezervasyon başka ödemeyle onaylanmış) `CaptureRaceLostError` — çağıran iade eder.
 */
export async function confirmInTransaction(
  tx: Prisma.TransactionClient,
  bookingId: string,
  providerRef: string
): Promise<string> {
  const booking = await tx.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      userId: true,
      status: true,
      version: true,
      propertyId: true,
      roomId: true,
      checkIn: true,
      checkOut: true,
      holdExpiresAt: true,
      totalPrice: true,
      currency: true,
      units: true,
      payment: { select: { id: true, status: true, providerRef: true } },
    },
  });
  if (!booking) throw new BookingNotFoundError();
  if (booking.payment && SETTLED_STATUSES.includes(booking.payment.status)) {
    if (booking.payment.providerRef === providerRef) return booking.payment.id; // idempotent
    throw new CaptureRaceLostError();
  }
  let next: BookingState;
  try {
    next = transition(booking.status as BookingState, "CONFIRM");
  } catch {
    throw new ConflictError("Rezervasyon artık onaylanamaz", "BOOKING_NOT_CONFIRMABLE");
  }
  if (booking.holdExpiresAt && booking.holdExpiresAt.getTime() < Date.now()) {
    throw new ConflictError("Rezervasyon tutma süresi doldu", "HOLD_EXPIRED");
  }
  // Tahsil hakkı bu providerRef'te olmalı (başka yetkilendirme satırı almışsa yarış kaybı).
  const paid = await tx.payment.updateMany({
    where: {
      bookingId: booking.id,
      providerRef,
      status: { in: [PaymentStatus.AUTHORIZED, PaymentStatus.REQUIRES_ACTION] },
    },
    data: { status: PaymentStatus.PAID, paidAt: new Date(), failureCode: null },
  });
  if (paid.count !== 1) throw new CaptureRaceLostError();
  const updated = await tx.booking.updateMany({
    where: { id: booking.id, status: booking.status, version: booking.version },
    data: {
      status: next as BookingStatus,
      confirmedAt: new Date(),
      holdExpiresAt: null,
      version: { increment: 1 },
    },
  });
  if (updated.count !== 1) {
    throw new ConflictError("Rezervasyon eşzamanlı olarak değişti", "CONCURRENT_UPDATE");
  }
  // Envanter: tutulan birimler satılana taşınır (aynı işlem, ADR 0010).
  await commitHeld(tx, {
    roomTypeId: booking.roomId,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    units: booking.units,
  });
  const amount = amountOf(booking);
  const payment = await tx.payment.findUniqueOrThrow({
    where: { bookingId: booking.id },
    select: { id: true },
  });
  await tx.ledgerEntry.create({
    data: {
      bookingId: booking.id,
      userId: booking.userId,
      kind: "CHARGE",
      amount: new Prisma.Decimal(toDecimalString(amount)),
      currency: amount.currency,
      reference: providerRef,
    },
  });
  await appendOutbox(
    tx,
    makeEvent<BookingConfirmedPayload>(EventTypes.BookingConfirmed, booking.id, "booking", {
      bookingId: booking.id,
      propertyId: booking.propertyId,
      roomId: booking.roomId,
      checkIn: fromDate(booking.checkIn),
      checkOut: fromDate(booking.checkOut),
      userId: booking.userId,
      totalMinor: amount.amount,
      currency: amount.currency,
      paymentId: payment.id,
    })
  );
  return payment.id;
}

async function afterBookingWrite(propertyId: string, bookingId: string): Promise<void> {
  await invalidatePropertySearchCache(propertyId);
  await redis.del(`booking:${bookingId}`).catch(() => 0);
}

function assertPayable(booking: PayableBooking): void {
  if (booking.status !== "HELD") {
    throw new ConflictError("Bu rezervasyon ödeme beklemiyor", "INVALID_STATE");
  }
  if (!booking.holdExpiresAt || booking.holdExpiresAt.getTime() < Date.now()) {
    throw new ConflictError("Rezervasyon tutma süresi doldu", "HOLD_EXPIRED");
  }
}

/** Deneme sınırı aşıldı (v4#13): ödeme FAILED, bu rezervasyon için yeni deneme yok. */
export class PaymentAttemptsExceededError extends HttpError {
  constructor(maxAttempts: number) {
    super(
      429,
      "PAYMENT_ATTEMPTS_EXCEEDED",
      "Çok fazla başarısız ödeme denemesi. Bu rezervasyon için ödeme kapatıldı.",
      { maxAttempts }
    );
    this.name = "PaymentAttemptsExceededError";
  }
}

const attemptsKey = (bookingId: string) => `pay:attempts:${bookingId}`;

async function assertAttemptsLeft(bookingId: string): Promise<void> {
  const max = getConfig().PAYMENT_MAX_ATTEMPTS;
  if (Number((await redis.get(attemptsKey(bookingId))) ?? 0) >= max) {
    throw new PaymentAttemptsExceededError(max);
  }
}

/**
 * Başarısız yetkilendirme / 3DS denemesini sayar (v4#13). Sınıra ulaşılınca ödeme kalıcı
 * olarak FAILED(`ATTEMPTS_EXCEEDED`) işaretlenir; sonraki pay/confirm istekleri 429 alır.
 * Sayaç rezervasyon başınadır: yeni Idempotency-Key ile tekrar `pay` + `confirm` döngüsü
 * 3DS kodunu kaba kuvvetle denemeye izin vermez.
 */
async function recordFailedAttempt(booking: PayableBooking): Promise<void> {
  const { PAYMENT_MAX_ATTEMPTS, PAYMENT_ATTEMPTS_WINDOW_SECONDS } = getConfig();
  const attempts = await redis.incrWithTtl(
    attemptsKey(booking.id),
    PAYMENT_ATTEMPTS_WINDOW_SECONDS
  );
  if (attempts < PAYMENT_MAX_ATTEMPTS) return;
  await prisma.payment.updateMany({
    where: { bookingId: booking.id, status: { in: OPEN_STATUSES } },
    data: { status: PaymentStatus.FAILED, failureCode: "ATTEMPTS_EXCEEDED" },
  });
  paymentsTotal.inc({ outcome: "attempts_exceeded" });
  await audit("system:payment", "payment.attempts_exceeded", "Booking", booking.id, {
    attempts,
  });
  throw new PaymentAttemptsExceededError(PAYMENT_MAX_ATTEMPTS);
}

/** Kart BIN'i PSP token metadata'sından (v4#13); desteklenmiyorsa / hata → null. */
async function tokenBin(cardToken: string): Promise<string | null> {
  const provider = getPaymentProvider();
  if (!provider.describeToken) return null;
  try {
    return (await provider.describeToken(cardToken)).bin;
  } catch (error) {
    logger.warn(errorFields(error), "card token metadata unavailable");
    return null;
  }
}

/** Rezervasyon başına ödeme kilidi; kilit alınamazsa 409 PAYMENT_IN_PROGRESS. */
async function withPaymentLock<T>(bookingId: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await redlock.withLock(`pay:${bookingId}`, fn, {
      ttlMs: 30_000,
      retryCount: 100,
      retryDelayMs: 50,
    });
  } catch (error) {
    if (error instanceof LockError) throw new PaymentInProgressError();
    throw error;
  }
}

/** Checkout ödemesi: kart token'ı ile yetkilendir; başarılıysa tahsil et ve onayla. */
export async function payForBooking(input: {
  bookingId: string;
  userId: string;
  cardToken: string;
  idempotencyKey: string;
  /** Risk sinyalleri (route'tan): istemci anahtarı ve ülke bilgisi. */
  context?: {
    ip?: string;
    ipCountry?: string | null;
    billingCountry?: string | null;
    /**
     * Sunucu imzalı cihaz kimliği (`did` çerezi, v4#13). İstemci gövdesinden ALINMAZ.
     * BIN de istemciden alınmaz: PSP token metadata'sından okunur (`describeToken`).
     */
    deviceId?: string | null;
  };
}): Promise<PayOutcome> {
  // IDOR kontrolü kilitten önce (başkasının rezervasyonuna kilit bile alınmaz).
  await loadPayable(input.bookingId, input.userId);
  try {
    return await withPaymentLock(input.bookingId, () => payLocked(input));
  } finally {
    // Ret / 3DS yolları da ödeme durumunu değiştirir → okuma önbelleği her sonuçta düşer.
    await redis.del(`booking:${input.bookingId}`).catch(() => 0);
  }
}

async function payLocked(input: Parameters<typeof payForBooking>[0]): Promise<PayOutcome> {
  const booking = await loadPayable(input.bookingId, input.userId);
  if (
    booking.status === "CONFIRMED" &&
    booking.payment &&
    SETTLED_STATUSES.includes(booking.payment.status)
  ) {
    return alreadyConfirmed(booking.id, input.userId);
  }
  assertPayable(booking);
  await assertAttemptsLeft(booking.id);

  // P1-8 fraud v2: allow / challenge_3ds / step_up_passkey / review / deny (yalnızca kurallar).
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
    amountMinor: amountOf(booking).amount,
    accountCreatedAt: account?.createdAt ?? new Date(),
    recentFailedPayments: recentFailed,
    ipCountry: input.context?.ipCountry,
    billingCountry: input.context?.billingCountry,
    cardBin: await tokenBin(input.cardToken),
    deviceId: input.context?.deviceId,
  });
  const gate = await resolveStepUp(input.userId, risk.decision);
  if (gate === "fallback_3ds") {
    risk.hits.push({
      rule: "step_up_unavailable_3ds",
      points: 0,
      detail: "Hesapta passkey yok; step-up yerine 3DS istendi",
    });
  }
  await prisma.fraudCheck.create({
    data: {
      bookingId: booking.id,
      userId: input.userId,
      score: risk.score,
      decision: risk.decision,
      reasons: risk.hits as unknown as Prisma.InputJsonValue,
    },
  });
  if (gate === "required") {
    paymentsTotal.inc({ outcome: "step_up_required" });
    throw new HttpError(
      403,
      "STEP_UP_REQUIRED",
      "Bu ödeme için passkey ile yeniden doğrulama gerekli",
      {
        score: risk.score,
      }
    );
  }
  if (risk.decision === "deny") {
    paymentsTotal.inc({ outcome: "fraud_blocked" });
    throw new HttpError(403, "FRAUD_BLOCKED", "Ödeme güvenlik kontrolünden geçemedi", {
      score: risk.score,
    });
  }

  const result: AuthorizeResult = await getPaymentProvider().authorize({
    amount: amountOf(booking),
    cardToken: input.cardToken,
    idempotencyKey: `auth:${booking.id}:${input.idempotencyKey}`,
    metadata: {
      bookingId: booking.id,
      ...(gate === "force_3ds" || gate === "fallback_3ds" ? { force3ds: "1" } : {}),
    },
  });

  if (result.status === "declined") {
    await transitionPayment(booking, OPEN_STATUSES, {
      status: PaymentStatus.FAILED,
      providerRef: result.providerRef,
      failureCode: result.declineCode,
    });
    paymentsTotal.inc({ outcome: "declined" });
    await recordFailedAttempt(booking);
    throw new PaymentDeclinedError(result.declineCode);
  }
  if (result.status === "requires_action") {
    const recorded = await transitionPayment(booking, OPEN_STATUSES, {
      status: PaymentStatus.REQUIRES_ACTION,
      providerRef: result.providerRef,
      failureCode: null,
    });
    if (!recorded) {
      await voidLoser(booking.id, result.providerRef);
      return alreadyConfirmed(booking.id, input.userId);
    }
    paymentsTotal.inc({ outcome: "requires_action" });
    return { status: "requires_action", bookingId: booking.id, challenge: result.challenge };
  }
  return captureAndConfirm(booking, result.providerRef);
}

type StepUpGate = "proceed" | "force_3ds" | "fallback_3ds" | "required";

/**
 * Karar → ödeme kapısı. step_up_passkey: geçerli (tek kullanımlık) step-up işareti varsa
 * devam; yoksa passkey'i olan kullanıcıdan step-up istenir, olmayandan 3DS.
 */
async function resolveStepUp(userId: string, decision: FraudDecision): Promise<StepUpGate> {
  if (decision === "challenge_3ds" || decision === "review") return "force_3ds";
  if (decision !== "step_up_passkey") return "proceed";
  if (await consumeStepUp(userId)) return "proceed";
  return (await hasPasskey(userId)) ? "required" : "fallback_3ds";
}

/** 3DS doğrulamasını tamamlar. */
export async function confirmPaymentChallenge(input: {
  bookingId: string;
  userId: string;
  code: string;
}): Promise<PayOutcome> {
  await loadPayable(input.bookingId, input.userId);
  return withPaymentLock(input.bookingId, async () => {
    const booking = await loadPayable(input.bookingId, input.userId);
    if (booking.payment?.status !== PaymentStatus.REQUIRES_ACTION || !booking.payment.providerRef) {
      throw new ConflictError("Doğrulama bekleyen ödeme yok", "NO_PENDING_CHALLENGE");
    }
    assertPayable(booking);
    await assertAttemptsLeft(booking.id);
    const ref = booking.payment.providerRef;
    const result = await getPaymentProvider().confirmChallenge(ref, input.code);
    if (result.status !== "authorized") {
      const code = result.status === "declined" ? result.declineCode : "authentication_required";
      await transitionPayment(
        booking,
        [PaymentStatus.REQUIRES_ACTION],
        { status: PaymentStatus.FAILED, failureCode: code },
        { providerRef: ref }
      );
      paymentsTotal.inc({ outcome: "declined" });
      await recordFailedAttempt(booking);
      throw new PaymentDeclinedError(code);
    }
    return captureAndConfirm(booking, result.providerRef, [PaymentStatus.REQUIRES_ACTION]);
  }).finally(() => redis.del(`booking:${input.bookingId}`).catch(() => 0));
}

function sameAmount(
  event: WebhookEvent,
  payment: { amount: Prisma.Decimal; currency: string }
): boolean {
  const currency = assertCurrency(payment.currency);
  if (event.data.currency && event.data.currency.toUpperCase() !== currency) return false;
  if (event.data.amount !== undefined) {
    return event.data.amount === toMinor(payment.amount.toString(), currency);
  }
  return true;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * PSP webhook olayını uygular (v3#2).
 *
 *  - Olay kimliği `PaymentEvent`'e İŞLEMEYLE AYNI işlemde yazılır: işleme başarısız olursa
 *    kayıt da geri alınır ve PSP'nin yeniden denemesi "duplicate" sayılmaz.
 *  - Tutar/para birimi kayıtlı ödemeyle uyuşmazsa 400 + denetim kaydı (etki yok).
 *  - `payment.succeeded` onaylanamazsa (tutma süresi doldu, iptal, başka ödeme kazandı):
 *    yakalanan para otomatik iade edilir, ödeme REFUNDED işaretlenir ve olay kaydedilir.
 */
export async function handleWebhookEvent(
  event: WebhookEvent
): Promise<{ duplicate: boolean; compensated?: boolean }> {
  if (await prisma.paymentEvent.findUnique({ where: { id: event.id }, select: { id: true } })) {
    return { duplicate: true };
  }
  const payment = await prisma.payment.findUnique({
    where: { providerRef: event.data.providerRef },
    select: {
      bookingId: true,
      status: true,
      amount: true,
      currency: true,
      booking: { select: { propertyId: true } },
    },
  });
  const record = (tx: Prisma.TransactionClient) =>
    tx.paymentEvent.create({
      data: { id: event.id, type: event.type, providerRef: event.data.providerRef },
    });

  try {
    if (!payment) {
      logger.warn({ eventId: event.id, type: event.type }, "webhook for unknown payment");
      await prisma.$transaction(async (tx) => record(tx));
      return { duplicate: false };
    }
    if (!sameAmount(event, payment)) {
      await audit("system:webhook", "payment.webhook_mismatch", "Payment", payment.bookingId, {
        eventId: event.id,
        type: event.type,
        eventAmount: event.data.amount ?? null,
        eventCurrency: event.data.currency ?? null,
      });
      throw new WebhookMismatchError();
    }

    if (event.type === "payment.succeeded") {
      try {
        await withSerializableRetry(async (tx) => {
          await record(tx);
          await confirmInTransaction(tx, payment.bookingId, event.data.providerRef);
        });
        await afterBookingWrite(payment.booking.propertyId, payment.bookingId);
        return { duplicate: false };
      } catch (error) {
        if (!(error instanceof ConflictError) || isUniqueViolation(error)) throw error;
        // Tahsil edilmiş para onaylanamıyor → otomatik iade + olay kaydı.
        const currency = assertCurrency(payment.currency);
        const amount = money(toMinor(payment.amount.toString(), currency), currency);
        await refundLoser(payment.bookingId, event.data.providerRef, amount, error.code);
        await prisma.$transaction(async (tx) => {
          await record(tx);
          await tx.payment.updateMany({
            where: {
              bookingId: payment.bookingId,
              providerRef: event.data.providerRef,
              status: { notIn: SETTLED_STATUSES },
            },
            data: {
              status: PaymentStatus.REFUNDED,
              refundedAmount: payment.amount,
              refundedAt: new Date(),
              failureCode: error.code,
            },
          });
        });
        return { duplicate: false, compensated: true };
      }
    }

    await prisma.$transaction(async (tx) => {
      await record(tx);
      if (event.type === "payment.failed") {
        await tx.payment.updateMany({
          where: { bookingId: payment.bookingId, status: { in: OPEN_STATUSES } },
          data: { status: PaymentStatus.FAILED, failureCode: "psp_failed" },
        });
      } else if (event.type === "refund.succeeded") {
        await tx.payment.updateMany({
          where: { bookingId: payment.bookingId, refundedAt: null },
          data: { refundedAt: new Date() },
        });
      }
    });
    return { duplicate: false };
  } catch (error) {
    if (isUniqueViolation(error)) return { duplicate: true };
    throw error;
  }
}

export interface CancellationOutcome {
  bookingId: string;
  status: BookingStatus;
  refund: RefundDecision & { currency: string };
}

/**
 * İptal + iade (P0-4): durum makinesi CANCEL, envanter iadesi, rezervasyon anındaki
 * politika snapshot'ına göre iade tutarı, defter kaydı ve PSP iadesi.
 * PSP iadesi işlemden sonra yapılır; başarısız olursa `failureCode=REFUND_FAILED`
 * (yönetici panelinden yeniden denenir) — iptal geri alınmaz.
 */
/**
 * İadenin gideceği ödeme (#4): rezervasyon devredildiyse yeni sahibin devir ödemesi
 * (`buyerPaymentRef`) — satıcı bedelini payout ile zaten almıştır. İade üst sınırı
 * alıcının ödediği tutardır (asıl tahsilatı aşamaz). Devir yoksa asıl ödeme.
 */
function refundTarget(
  booking: {
    userId: string;
    payment: { amount: Prisma.Decimal; providerRef: string | null } | null;
    transfers: Array<{
      askPrice: Prisma.Decimal;
      currency: string;
      claimedById: string | null;
      buyerPaymentRef: string | null;
    }>;
  },
  currency: string
): { providerRef: string | null; refundableMinor: number } {
  const paid = booking.payment ? toMinor(booking.payment.amount.toString(), currency) : 0;
  const transfer = booking.transfers[0];
  if (
    transfer?.buyerPaymentRef &&
    transfer.claimedById === booking.userId &&
    transfer.currency === currency
  ) {
    const ask = toMinor(transfer.askPrice.toString(), currency);
    return { providerRef: transfer.buyerPaymentRef, refundableMinor: Math.min(ask, paid) };
  }
  return { providerRef: booking.payment?.providerRef ?? null, refundableMinor: paid };
}

/**
 * v4#7: iptal, ödeme ile AYNI `pay:<bookingId>` kilidini alır (capture ile yarışamaz) ve
 * işlem içinde rezervasyon satırını `FOR UPDATE` ile kilitler. PSP iadesi düşerse
 * `REFUND_FAILED` + BullMQ `refund-retry` (üstel geri çekilme); tükenirse yönetici kuyruğu
 * (`/api/admin/refunds`).
 */
export async function cancelAndRefund(
  bookingId: string,
  userId: string,
  now = new Date()
): Promise<CancellationOutcome> {
  // IDOR kontrolü kilitten önce (başkasının rezervasyonuna kilit bile alınmaz).
  const owner = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { userId: true },
  });
  if (!owner || owner.userId !== userId) throw new BookingNotFoundError();
  return withPaymentLock(bookingId, () => cancelLocked(bookingId, userId, now));
}

async function cancelLocked(
  bookingId: string,
  userId: string,
  now: Date
): Promise<CancellationOutcome> {
  const result = await withSerializableRetry(async (tx) => {
    // Satır kilidi: kilit (Redlock) kaybolsa bile eşzamanlı onay/iptal bu satırda sıralanır.
    await tx.$queryRaw`SELECT id FROM "Booking" WHERE id = ${bookingId} FOR UPDATE`;
    const booking = await tx.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        userId: true,
        status: true,
        version: true,
        propertyId: true,
        roomId: true,
        checkIn: true,
        checkOut: true,
        createdAt: true,
        currency: true,
        units: true,
        policySnapshot: true,
        property: { select: { timeZone: true, checkInTime: true, checkOutTime: true } },
        payment: { select: { status: true, amount: true, providerRef: true } },
        transfers: {
          where: { status: "COMPLETED" },
          orderBy: { completedAt: "desc" },
          take: 1,
          select: { askPrice: true, currency: true, claimedById: true, buyerPaymentRef: true },
        },
      },
    });
    if (!booking || booking.userId !== userId) throw new BookingNotFoundError();

    let next: BookingState;
    try {
      next = transition(booking.status as BookingState, "CANCEL");
    } catch {
      throw new ConflictError("Bu rezervasyon iptal edilemez", "INVALID_STATE");
    }
    const currency = assertCurrency(booking.currency);
    const target = refundTarget(booking, currency);
    const paidMinor = booking.payment?.status === PaymentStatus.PAID ? target.refundableMinor : 0;
    const decision = computeRefund(
      parseSnapshot(booking.policySnapshot),
      { checkIn: fromDate(booking.checkIn), createdAt: booking.createdAt, paidMinor, currency },
      now,
      clockOf(booking.property)
    );

    const updated = await tx.booking.updateMany({
      where: { id: booking.id, status: booking.status, version: booking.version },
      data: {
        status: next as BookingStatus,
        cancelledAt: now,
        holdExpiresAt: null,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      throw new ConflictError("Rezervasyon eşzamanlı olarak değişti", "CONCURRENT_UPDATE");
    }
    await releaseInventory(tx, booking);

    if (booking.payment) {
      if (booking.payment.status === PaymentStatus.PAID) {
        await tx.payment.update({
          where: { bookingId: booking.id },
          data: {
            status:
              decision.refundMinor === paidMinor && paidMinor > 0
                ? PaymentStatus.REFUNDED
                : decision.refundMinor > 0
                  ? PaymentStatus.PARTIALLY_REFUNDED
                  : PaymentStatus.PAID,
            refundedAmount: new Prisma.Decimal(
              toDecimalString(money(decision.refundMinor, currency))
            ),
            refundedAt: decision.refundMinor > 0 ? now : null,
          },
        });
        if (decision.refundMinor > 0) {
          await tx.ledgerEntry.create({
            data: {
              bookingId: booking.id,
              userId: booking.userId,
              kind: "REFUND",
              amount: new Prisma.Decimal(toDecimalString(money(decision.refundMinor, currency))),
              currency,
              reference: target.providerRef,
            },
          });
        }
      } else if (booking.payment.status !== PaymentStatus.FAILED) {
        await tx.payment.update({
          where: { bookingId: booking.id },
          data: { status: PaymentStatus.VOIDED },
        });
      }
    }

    await appendOutbox(
      tx,
      makeEvent<BookingCancelledPayload>(EventTypes.BookingCancelled, booking.id, "booking", {
        bookingId: booking.id,
        propertyId: booking.propertyId,
        roomId: booking.roomId,
        checkIn: fromDate(booking.checkIn),
        checkOut: fromDate(booking.checkOut),
        userId: booking.userId,
        refundMinor: decision.refundMinor,
        currency,
        reason: decision.reason,
      })
    );
    return { booking, decision, currency, next, target };
  });

  const { booking, decision, currency, target } = result;
  const provider = getPaymentProvider();
  if (booking.payment?.providerRef) {
    try {
      if (decision.refundMinor > 0 && target.providerRef) {
        await provider.refund(
          target.providerRef,
          money(decision.refundMinor, currency),
          `refund:${booking.id}`
        );
      } else if (
        booking.payment.status !== PaymentStatus.PAID &&
        booking.payment.status !== PaymentStatus.FAILED
      ) {
        await provider.void(booking.payment.providerRef);
      }
    } catch (error) {
      logger.error({ bookingId: booking.id, ...errorFields(error) }, "psp refund failed");
      await prisma.payment.update({
        where: { bookingId: booking.id },
        data: { failureCode: REFUND_FAILED },
      });
      await scheduleRefundRetry(booking.id);
    }
  }
  await afterBookingWrite(booking.propertyId, booking.id);
  return {
    bookingId: booking.id,
    status: result.next as BookingStatus,
    refund: { ...decision, currency },
  };
}

export const REFUND_FAILED = "REFUND_FAILED";

export const refundRetryTotal = counter(
  "refund_retry_total",
  "Başarısız PSP iadelerinin yeniden denemeleri",
  ["outcome"] as const
);

/**
 * Başarısız iadeyi `refund-retry` kuyruğuna koyar (rezervasyon başına tek iş; üstel geri
 * çekilme, deneme sayısı config). Kuyruk erişilemezse iş kaybolmaz: satır `REFUND_FAILED`
 * kalır ve yönetici kuyruğunda görünür.
 */
export async function scheduleRefundRetry(bookingId: string): Promise<void> {
  const { REFUND_RETRY_MAX_ATTEMPTS, REFUND_RETRY_BASE_DELAY_MS } = getConfig();
  try {
    await getQueue(QUEUE_NAMES.refundRetry).add(
      REFUND_RETRY_JOB,
      { bookingId },
      {
        jobId: `refund-${bookingId}`,
        attempts: REFUND_RETRY_MAX_ATTEMPTS,
        backoff: { type: "exponential", delay: REFUND_RETRY_BASE_DELAY_MS },
        removeOnComplete: true,
        removeOnFail: 1000,
      }
    );
    refundRetryTotal.inc({ outcome: "scheduled" });
  } catch (error) {
    logger.error({ bookingId, ...errorFields(error) }, "refund retry could not be scheduled");
  }
}

export type RefundRetryResult = "refunded" | "voided" | "noop";

/**
 * `REFUND_FAILED` ödemenin PSP işlemini yeniden dener (worker ve yönetici uç noktası).
 * İade anahtarı ilk denemeyle aynıdır (`refund:<bookingId>`) → PSP en fazla bir kez iade
 * eder. Başarılıysa `failureCode` temizlenir; hata yukarı fırlatılır (BullMQ yeniden dener).
 */
export async function retryFailedRefund(bookingId: string): Promise<RefundRetryResult> {
  return withPaymentLock(bookingId, async () => {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        userId: true,
        currency: true,
        payment: {
          select: {
            status: true,
            amount: true,
            providerRef: true,
            refundedAmount: true,
            failureCode: true,
          },
        },
        transfers: {
          where: { status: "COMPLETED" },
          orderBy: { completedAt: "desc" },
          take: 1,
          select: { askPrice: true, currency: true, claimedById: true, buyerPaymentRef: true },
        },
      },
    });
    const payment = booking?.payment;
    if (!booking || !payment || payment.failureCode !== REFUND_FAILED) return "noop";
    const currency = assertCurrency(booking.currency);
    const refundMinor = payment.refundedAmount
      ? toMinor(payment.refundedAmount.toString(), currency)
      : 0;
    const target = refundTarget(booking, currency);
    const provider = getPaymentProvider();
    let result: RefundRetryResult = "noop";
    try {
      if (refundMinor > 0 && target.providerRef) {
        await provider.refund(
          target.providerRef,
          money(refundMinor, currency),
          `refund:${booking.id}`
        );
        result = "refunded";
      } else if (payment.providerRef && payment.status === PaymentStatus.VOIDED) {
        await provider.void(payment.providerRef);
        result = "voided";
      }
    } catch (error) {
      refundRetryTotal.inc({ outcome: "failed" });
      throw error;
    }
    await prisma.payment.updateMany({
      where: { bookingId: booking.id, failureCode: REFUND_FAILED },
      data: { failureCode: null },
    });
    refundRetryTotal.inc({ outcome: "succeeded" });
    await audit("system:refund-retry", "payment.refund_retried", "Booking", booking.id, {
      result,
      refundMinor,
    });
    return result;
  });
}
