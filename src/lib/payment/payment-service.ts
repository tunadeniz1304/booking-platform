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
import { transition, type BookingState } from "@/lib/booking/state-machine";
import { computeRefund, parseSnapshot, type RefundDecision } from "@/lib/booking/cancellation";
import { releaseInventory, BookingNotFoundError } from "@/lib/booking-service";
import { invalidatePropertySearchCache } from "@/lib/search";
import { getConfig } from "@/lib/config/app-config";
import { money, toDecimalString, toMinor, assertCurrency, type Money } from "@/lib/money/money";
import { fromDate } from "@/lib/time/nights";
import { logger, errorFields } from "@/lib/observability/logger";
import { counter } from "@/lib/observability/metrics";
import { getPaymentProvider, type AuthorizeResult } from "./index";
import type { WebhookEvent } from "./webhook";
import { assessPayment } from "@/lib/risk/fraud";

/**
 * Ödeme orkestrasyonu (P0-5).
 *
 *   checkout → authorize ─┬─ authorized ──→ capture → HELD→CONFIRMED (tek işlem)
 *                         ├─ requires_action (3DS) → confirmChallenge → …
 *                         └─ declined → booking HELD kalır (başka kartla denenebilir;
 *                                        süre dolarsa expire-holds EXPIRED yapar)
 *
 * Kart verisi sunucuya gelmez (yalnızca `cardToken`). PSP çağrıları veritabanı
 * işleminin DIŞINDA yapılır; işlem çakışırsa (ör. tutma bu arada doldu) tahsilat
 * iade edilir. Tüm tutarlar minor-unit.
 */

const paymentsTotal = counter("payment_attempts_total", "Ödeme denemeleri", ["outcome"] as const);

export class PaymentDeclinedError extends HttpError {
  constructor(code: string) {
    super(402, "PAYMENT_DECLINED", "Ödeme reddedildi. Lütfen başka bir kart deneyin.", {
      declineCode: code,
    });
    this.name = "PaymentDeclinedError";
  }
}

export type PayOutcome =
  | { status: "confirmed"; bookingId: string; paymentId: string; amount: number; currency: string }
  | { status: "requires_action"; bookingId: string; challenge: { type: string; hint: string } };

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

async function upsertPayment(
  booking: PayableBooking,
  data: {
    status: PaymentStatus;
    providerRef?: string;
    failureCode?: string | null;
    authorizedAt?: Date;
  }
): Promise<string> {
  const amount = amountOf(booking);
  const payment = await prisma.payment.upsert({
    where: { bookingId: booking.id },
    create: {
      bookingId: booking.id,
      userId: booking.userId,
      amount: new Prisma.Decimal(toDecimalString(amount)),
      currency: amount.currency,
      provider: getPaymentProvider().name,
      ...data,
    },
    update: { ...data, provider: getPaymentProvider().name },
    select: { id: true },
  });
  return payment.id;
}

/**
 * Yetkilendirilmiş ödemeyi tahsil eder ve rezervasyonu onaylar. Veritabanı geçişi
 * başarısız olursa (tutma bu arada doldu/iptal edildi) tahsilat iade edilir.
 */
async function captureAndConfirm(
  booking: PayableBooking,
  providerRef: string
): Promise<PayOutcome> {
  const provider = getPaymentProvider();
  const amount = amountOf(booking);
  await upsertPayment(booking, {
    status: PaymentStatus.AUTHORIZED,
    providerRef,
    authorizedAt: new Date(),
    failureCode: null,
  });
  await provider.capture(providerRef, amount);

  try {
    const paymentId = await withSerializableRetry((tx) =>
      confirmInTransaction(tx, booking.id, providerRef)
    );
    paymentsTotal.inc({ outcome: "confirmed" });
    await afterBookingWrite(booking.propertyId, booking.id);
    return {
      status: "confirmed",
      bookingId: booking.id,
      paymentId,
      amount: amount.amount,
      currency: amount.currency,
    };
  } catch (error) {
    // Onaylanamadı → tahsilatı geri ver (para asla askıda kalmaz).
    await provider
      .refund(providerRef, amount, `compensate:${booking.id}`)
      .catch((e) =>
        logger.error({ bookingId: booking.id, ...errorFields(e) }, "compensating refund failed")
      );
    await prisma.payment.update({
      where: { bookingId: booking.id },
      data: {
        status: PaymentStatus.REFUNDED,
        refundedAmount: new Prisma.Decimal(toDecimalString(amount)),
        refundedAt: new Date(),
        failureCode: "BOOKING_NOT_CONFIRMABLE",
      },
    });
    paymentsTotal.inc({ outcome: "compensated" });
    throw error;
  }
}

/** HELD → CONFIRMED + ödeme PAID + defter kaydı + outbox (tek işlem). Idempotent. */
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
      payment: { select: { id: true, status: true } },
    },
  });
  if (!booking) throw new BookingNotFoundError();
  if (booking.status === "CONFIRMED" && booking.payment?.status === PaymentStatus.PAID) {
    return booking.payment.id; // idempotent (webhook + senkron akış yarışı)
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
  const amount = amountOf(booking);
  const payment = await tx.payment.update({
    where: { bookingId: booking.id },
    data: { status: PaymentStatus.PAID, paidAt: new Date(), providerRef, failureCode: null },
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

/** Checkout ödemesi: kart token'ı ile yetkilendir; başarılıysa tahsil et ve onayla. */
export async function payForBooking(input: {
  bookingId: string;
  userId: string;
  cardToken: string;
  idempotencyKey: string;
  /** Risk sinyalleri (route'tan): güvenilir IP ve ülke bilgisi. */
  context?: { ip?: string; ipCountry?: string | null; billingCountry?: string | null };
}): Promise<PayOutcome> {
  const booking = await loadPayable(input.bookingId, input.userId);
  if (booking.status === "CONFIRMED" && booking.payment?.status === PaymentStatus.PAID) {
    const amount = amountOf(booking);
    return {
      status: "confirmed",
      bookingId: booking.id,
      paymentId: booking.payment.id,
      amount: amount.amount,
      currency: amount.currency,
    };
  }
  assertPayable(booking);

  // P1-10: kural tabanlı risk skoru → allow / review (3DS zorunlu) / block.
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
  });
  await prisma.fraudCheck.create({
    data: {
      bookingId: booking.id,
      userId: input.userId,
      score: risk.score,
      decision: risk.decision,
      reasons: risk.hits as unknown as Prisma.InputJsonValue,
    },
  });
  if (risk.decision === "block") {
    paymentsTotal.inc({ outcome: "fraud_blocked" });
    throw new HttpError(403, "FRAUD_BLOCKED", "Ödeme güvenlik kontrolünden geçemedi", {
      score: risk.score,
    });
  }

  const result: AuthorizeResult = await getPaymentProvider().authorize({
    amount: amountOf(booking),
    cardToken: input.cardToken,
    idempotencyKey: `auth:${booking.id}:${input.idempotencyKey}`,
    metadata: { bookingId: booking.id, ...(risk.decision === "review" ? { force3ds: "1" } : {}) },
  });

  if (result.status === "declined") {
    await upsertPayment(booking, {
      status: PaymentStatus.FAILED,
      providerRef: result.providerRef,
      failureCode: result.declineCode,
    });
    paymentsTotal.inc({ outcome: "declined" });
    throw new PaymentDeclinedError(result.declineCode);
  }
  if (result.status === "requires_action") {
    await upsertPayment(booking, {
      status: PaymentStatus.REQUIRES_ACTION,
      providerRef: result.providerRef,
      failureCode: null,
    });
    paymentsTotal.inc({ outcome: "requires_action" });
    return { status: "requires_action", bookingId: booking.id, challenge: result.challenge };
  }
  return captureAndConfirm(booking, result.providerRef);
}

/** 3DS doğrulamasını tamamlar. */
export async function confirmPaymentChallenge(input: {
  bookingId: string;
  userId: string;
  code: string;
}): Promise<PayOutcome> {
  const booking = await loadPayable(input.bookingId, input.userId);
  if (booking.payment?.status !== PaymentStatus.REQUIRES_ACTION || !booking.payment.providerRef) {
    throw new ConflictError("Doğrulama bekleyen ödeme yok", "NO_PENDING_CHALLENGE");
  }
  assertPayable(booking);
  const result = await getPaymentProvider().confirmChallenge(
    booking.payment.providerRef,
    input.code
  );
  if (result.status !== "authorized") {
    const code = result.status === "declined" ? result.declineCode : "authentication_required";
    await upsertPayment(booking, { status: PaymentStatus.FAILED, failureCode: code });
    paymentsTotal.inc({ outcome: "declined" });
    throw new PaymentDeclinedError(code);
  }
  return captureAndConfirm(booking, result.providerRef);
}

/**
 * PSP webhook olayını uygular. Olay kimliği `PaymentEvent` tablosunda tekildir:
 * aynı olay ikinci kez gelirse hiçbir etki yapmaz (`duplicate: true`).
 */
export async function handleWebhookEvent(event: WebhookEvent): Promise<{ duplicate: boolean }> {
  try {
    await prisma.paymentEvent.create({
      data: { id: event.id, type: event.type, providerRef: event.data.providerRef },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { duplicate: true };
    }
    throw error;
  }

  const payment = await prisma.payment.findUnique({
    where: { providerRef: event.data.providerRef },
    select: { bookingId: true, status: true, booking: { select: { propertyId: true } } },
  });
  if (!payment) {
    logger.warn({ eventId: event.id, type: event.type }, "webhook for unknown payment");
    return { duplicate: false };
  }

  if (event.type === "payment.succeeded" && payment.status !== PaymentStatus.PAID) {
    await withSerializableRetry((tx) =>
      confirmInTransaction(tx, payment.bookingId, event.data.providerRef)
    );
    await afterBookingWrite(payment.booking.propertyId, payment.bookingId);
  } else if (event.type === "payment.failed" && payment.status !== PaymentStatus.PAID) {
    await prisma.payment.update({
      where: { bookingId: payment.bookingId },
      data: { status: PaymentStatus.FAILED, failureCode: "psp_failed" },
    });
  } else if (event.type === "refund.succeeded") {
    await prisma.payment.updateMany({
      where: { bookingId: payment.bookingId, refundedAt: null },
      data: { refundedAt: new Date() },
    });
  }
  return { duplicate: false };
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
export async function cancelAndRefund(
  bookingId: string,
  userId: string,
  now = new Date()
): Promise<CancellationOutcome> {
  const config = getConfig();
  const result = await withSerializableRetry(async (tx) => {
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
        policySnapshot: true,
        payment: { select: { status: true, amount: true, providerRef: true } },
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
    const paidMinor =
      booking.payment?.status === PaymentStatus.PAID
        ? toMinor(booking.payment.amount.toString(), currency)
        : 0;
    const decision = computeRefund(
      parseSnapshot(booking.policySnapshot),
      { checkIn: fromDate(booking.checkIn), createdAt: booking.createdAt, paidMinor, currency },
      now,
      config.CHECKIN_HOUR_UTC
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
              reference: booking.payment.providerRef,
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
    return { booking, decision, currency, next };
  });

  const { booking, decision, currency } = result;
  const provider = getPaymentProvider();
  if (booking.payment?.providerRef) {
    try {
      if (decision.refundMinor > 0) {
        await provider.refund(
          booking.payment.providerRef,
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
        data: { failureCode: "REFUND_FAILED" },
      });
    }
  }
  await afterBookingWrite(booking.propertyId, booking.id);
  return {
    bookingId: booking.id,
    status: result.next as BookingStatus,
    refund: { ...decision, currency },
  };
}
