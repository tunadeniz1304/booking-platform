import { Prisma, PaymentStatus, type BookingStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { ConflictError, HttpError } from "@/lib/http/errors";
import { createRedlock, LockError } from "@/lib/distributed-lock/redlock";
import { BookingNotFoundError } from "@/lib/booking-service";
import { invalidatePropertySearchCache } from "@/lib/search";
import { money, assertCurrency, type Money, minorToDb, minorFromDb } from "@/lib/money/money";
import { logger, errorFields } from "@/lib/observability/logger";
import { counter } from "@/lib/observability/metrics";
import { getPaymentProvider } from "./index";
import type { PaymentChallenge } from "./provider";
import { postBookingCapture, postRefundFromEscrow } from "@/lib/ledger";
import { activeCreditSpend } from "@/lib/wallet/wallet-service";

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

/** v5#5: `flow` etiketi devir talebi denemelerini (`transfer`) ayırır; rezervasyon yolu boş. */
export const paymentsTotal = counter("payment_attempts_total", "Ödeme denemeleri", [
  "outcome",
  "flow",
] as const);
export const captureRaceTotal = counter(
  "payment_capture_race_total",
  "Yarışı kaybedip telafi edilen yetkilendirme/tahsilatlar",
  ["action"] as const
);

const redlock = createRedlock(redis);

/** Mutabakatta yeniden açılan tutmanın ömrü: aynı işlemde onaylanır, yalnızca güvenlik payı. */
export const LATE_SUCCESS_HOLD_MS = 60_000;
/** PSP altyapı hatasıyla düşen denemenin `failureCode` öneki (ret sayılmaz). */
export const PROVIDER_ERROR_PREFIX = "provider_error:";

/** Tahsil hakkı alınabilecek (henüz para çekilmemiş) ödeme durumları. */
export const OPEN_STATUSES: PaymentStatus[] = [
  PaymentStatus.PENDING,
  PaymentStatus.REQUIRES_ACTION,
  PaymentStatus.FAILED,
  PaymentStatus.VOIDED,
];
/** Parası çekilmiş (bir daha tahsil edilemez) durumlar. */
export const SETTLED_STATUSES: PaymentStatus[] = [
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
  | {
      status: "confirmed";
      bookingId: string;
      paymentId: string;
      /** Kartla tahsil edilen tutar (P1-7: kredi kullanıldıysa toplam − kredi). */
      amount: number;
      currency: string;
      /** P1-7: cüzdan kredisiyle ödenen kısım (minor-unit). */
      creditMinor?: number;
    }
  | { status: "requires_action"; bookingId: string; challenge: PaymentChallenge };

export interface PayableBooking {
  id: string;
  userId: string;
  status: BookingStatus;
  version: number;
  propertyId: string;
  roomId: string;
  checkIn: Date;
  checkOut: Date;
  holdExpiresAt: Date | null;
  totalPriceMinor: bigint;
  currency: string;
  payment: { id: string; status: PaymentStatus; providerRef: string | null } | null;
  /** P1-1: sepet kalemi → ödeme yalnızca sepet üzerinden (`/api/cart/pay`). */
  cartId: string | null;
  /** P1-7: etkin (RESERVED | SPENT) kredi harcaması; kart tutarı = toplam − kredi. */
  creditMinor: bigint;
}

export async function loadPayable(bookingId: string, userId: string): Promise<PayableBooking> {
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
      totalPriceMinor: true,
      currency: true,
      payment: { select: { id: true, status: true, providerRef: true } },
      cartId: true,
    },
  });
  // IDOR: başkasının rezervasyonu "bulunamadı"
  if (!booking || booking.userId !== userId) throw new BookingNotFoundError();
  const spend = await activeCreditSpend(prisma, bookingId);
  return { ...booking, creditMinor: spend?.amountMinor ?? 0n };
}

/** Kartla tahsil edilecek tutar: toplam − kullanılan kredi (P1-7). */
export function chargeOf(booking: {
  totalPriceMinor: bigint;
  currency: string;
  creditMinor: bigint;
}): Money {
  return amountOf({
    totalPriceMinor: booking.totalPriceMinor - booking.creditMinor,
    currency: booking.currency,
  });
}

export function amountOf(booking: { totalPriceMinor: bigint; currency: string }): Money {
  const currency = assertCurrency(booking.currency);
  return money(minorFromDb(booking.totalPriceMinor), currency);
}

/**
 * Ödeme satırını KOŞULLU olarak günceller: yalnızca satır `from` durumlarındaysa
 * (veya hiç yoksa oluşturarak). Parası çekilmiş bir satır (PAID…) asla ezilmez (v3#1).
 * @returns güncellendiyse ödeme kimliği, koşul tutmadıysa `null`
 */
export async function transitionPayment(
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
  const amount = chargeOf(booking);
  const provider = getPaymentProvider().name;
  // Açık satırın tutarı da güncellenir (P1-7: yeniden denemede kredi payı değişmiş olabilir).
  const updated = await prisma.payment.updateMany({
    where: { bookingId: booking.id, status: { in: [...from] }, ...where },
    data: { ...data, provider, amountMinor: minorToDb(amount.amount) },
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
        amountMinor: minorToDb(amount.amount),
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
export async function voidLoser(bookingId: string, providerRef: string): Promise<void> {
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
export async function refundLoser(
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

/**
 * Onaylanamayan ama PSP'de tahsil edilip iade edilen ödemenin jurnali (F2c): tahsilat +
 * aynı tutarın emanetten iadesi. Ödeme satırı `paidAt` (tahsil anı) + `refundedAmountMinor`
 * taşır → mutabakatta PSP ile jurnal eşleşir. Anahtarlar providerRef'e bağlı (tek sefer).
 */
export async function journalCompensation(
  tx: Prisma.TransactionClient,
  bookingId: string,
  providerRef: string
): Promise<void> {
  const p = await tx.payment.findUnique({
    where: { providerRef },
    select: {
      id: true,
      amountMinor: true,
      currency: true,
      booking: { select: { userId: true, priceBreakdown: true } },
    },
  });
  if (!p) return;
  await postBookingCapture(tx, {
    bookingId,
    paymentId: p.id,
    currency: p.currency,
    grossMinor: p.amountMinor,
    priceBreakdown: p.booking.priceBreakdown,
    idempotencyKey: `booking-captured:compensate:${providerRef}`,
  });
  await postRefundFromEscrow(tx, {
    refundRef: `compensate:${providerRef}`,
    bookingId,
    paymentId: p.id,
    guestId: p.booking.userId,
    currency: p.currency,
    grossMinor: p.amountMinor,
    priceBreakdown: p.booking.priceBreakdown,
    refundMinor: p.amountMinor,
  });
}

export async function afterBookingWrite(propertyId: string, bookingId: string): Promise<void> {
  await invalidatePropertySearchCache(propertyId);
  await redis.del(`booking:${bookingId}`).catch(() => 0);
}

/** Rezervasyon başına ödeme kilidi; kilit alınamazsa 409 PAYMENT_IN_PROGRESS. */
export async function withPaymentLock<T>(bookingId: string, fn: () => Promise<T>): Promise<T> {
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
