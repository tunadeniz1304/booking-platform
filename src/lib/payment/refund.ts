import { Prisma, PaymentStatus, type BookingStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { appendOutbox } from "@/lib/cqrs";
import { EventTypes, makeEvent, type BookingCancelledPayload } from "@/lib/events/events";
import { ConflictError } from "@/lib/http/errors";
import { withSerializableRetry } from "@/lib/db/transactions";
import { transition, type BookingState } from "@/lib/booking/state-machine";
import { computeRefund, parseSnapshot, type RefundDecision } from "@/lib/booking/cancellation";
import { releaseInventory, BookingNotFoundError } from "@/lib/booking-service";
import { money, assertCurrency, minorToDb, minorFromDb } from "@/lib/money/money";
import { clockOf, fromDate } from "@/lib/time/nights";
import { logger, errorFields } from "@/lib/observability/logger";
import { counter } from "@/lib/observability/metrics";
import { audit } from "@/lib/admin/audit";
import {
  allocateSplitRefundInTx,
  executeSplitRefunds,
  hasSplitRefunds,
} from "@/lib/cart/split-refund";
import { getPaymentProvider } from "./index";
import { getConfig } from "@/lib/config/app-config";
import { getQueue, QUEUE_NAMES } from "@/lib/queue";
import { postRefundFromEscrow } from "@/lib/ledger";
import {
  activeCreditSpend,
  refundBookingCreditInTx,
  releaseBookingCreditInTx,
} from "@/lib/wallet/wallet-service";
import { splitRefund as splitCardCreditRefund } from "@/lib/wallet/rules";
import { lostChargebackMinor } from "./refundable";
import { SETTLED_STATUSES, afterBookingWrite, withPaymentLock } from "./payment-core";

/** BullMQ `refund-retry` kuyruğundaki iş adı (v4#7). */
export const REFUND_RETRY_JOB = "refund-retry";

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
    payment: {
      amountMinor: bigint;
      providerRef: string | null;
      /** P1-1: sepet payı → PSP işlemi sepetin tek tahsilatıdır. */
      cartPayment?: { providerRef: string | null } | null;
    } | null;
    transfers: Array<{
      askPriceMinor: bigint;
      currency: string;
      claimedById: string | null;
      buyerPaymentRef: string | null;
    }>;
  },
  currency: string
): { providerRef: string | null; refundableMinor: number } {
  const paid = booking.payment ? minorFromDb(booking.payment.amountMinor) : 0;
  const transfer = booking.transfers[0];
  if (
    transfer?.buyerPaymentRef &&
    transfer.claimedById === booking.userId &&
    transfer.currency === currency
  ) {
    const ask = minorFromDb(transfer.askPriceMinor);
    return { providerRef: transfer.buyerPaymentRef, refundableMinor: Math.min(ask, paid) };
  }
  return { providerRef: pspRefOf(booking.payment), refundableMinor: paid };
}

/** Ödemenin PSP işlem kimliği: kendi `providerRef`'i ya da (sepet payıysa) sepet tahsilatınınki. */
function pspRefOf(
  payment: {
    providerRef: string | null;
    cartPayment?: { providerRef: string | null } | null;
  } | null
): string | null {
  return payment?.providerRef ?? payment?.cartPayment?.providerRef ?? null;
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
  let splitRefund = false;
  const result = await withSerializableRetry(async (tx) => {
    splitRefund = false;
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
        priceBreakdown: true,
        property: { select: { timeZone: true, checkInTime: true, checkOutTime: true } },
        payment: {
          select: {
            id: true,
            status: true,
            amountMinor: true,
            refundedAmountMinor: true,
            providerRef: true,
            cartPayment: { select: { id: true, providerRef: true } },
          },
        },
        transfers: {
          where: { status: "COMPLETED" },
          orderBy: { completedAt: "desc" },
          take: 1,
          select: { askPriceMinor: true, currency: true, claimedById: true, buyerPaymentRef: true },
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
    // fix-sweep-2: iptal iadesi yalnız KALAN iade edilebilir tutar üzerinden hesaplanır —
    // önceki kısmi iadeler (çözüm merkezi talebi vb.) ve kaybedilen itirazlar düşülür.
    const refundedBeforeMinor = booking.payment
      ? minorFromDb(booking.payment.refundedAmountMinor)
      : 0;
    const settledPayment =
      booking.payment !== null && SETTLED_STATUSES.includes(booking.payment.status);
    const cardPaidMinor = settledPayment
      ? Math.max(
          0,
          target.refundableMinor -
            refundedBeforeMinor -
            minorFromDb(await lostChargebackMinor(tx, booking.id))
        )
      : 0;
    // P1-7: krediyle ödenen kısım da iade politikasına girer (devredilmiş rezervasyonda
    // iade alıcının kart ödemesine gider; satıcının kredisi devir bedeliyle karşılandı).
    const spend = await activeCreditSpend(tx, booking.id);
    const ownPayment = target.providerRef === pspRefOf(booking.payment);
    const creditPaidMinor =
      spend?.status === "SPENT" && settledPayment && ownPayment
        ? minorFromDb(spend.amountMinor - spend.refundedMinor)
        : 0;
    const paidMinor = cardPaidMinor + creditPaidMinor;
    const decision = computeRefund(
      parseSnapshot(booking.policySnapshot),
      { checkIn: fromDate(booking.checkIn), createdAt: booking.createdAt, paidMinor, currency },
      now,
      clockOf(booking.property)
    );
    // İade simetrisi: kart/kredi ödendikleri oranda (tek yuvarlama `allocateMinor`).
    const parts = splitCardCreditRefund(decision.refundMinor, cardPaidMinor, creditPaidMinor);
    const cardRefundMinor = parts.cardMinor;

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
      if (settledPayment) {
        // Kümülatif: iade toplamı ÜZERİNE YAZILMAZ (talep iadesi + iptal çift/yanlış kalan olmasın).
        const refundedTotal = refundedBeforeMinor + cardRefundMinor;
        const fullyRefunded =
          refundedTotal >= minorFromDb(booking.payment.amountMinor) ||
          (cardRefundMinor > 0 && cardRefundMinor === cardPaidMinor);
        await tx.payment.update({
          where: { bookingId: booking.id },
          data: {
            status: fullyRefunded
              ? PaymentStatus.REFUNDED
              : refundedTotal > 0
                ? PaymentStatus.PARTIALLY_REFUNDED
                : PaymentStatus.PAID,
            refundedAmountMinor: minorToDb(refundedTotal),
            ...(cardRefundMinor > 0 ? { refundedAt: now } : {}),
          },
        });
        if (parts.creditMinor > 0) {
          await refundBookingCreditInTx(
            tx,
            {
              bookingId: booking.id,
              paymentId: booking.payment.id,
              refundMinor: parts.creditMinor,
              priceBreakdown: booking.priceBreakdown,
            },
            now
          );
        }
        if (cardRefundMinor > 0) {
          await tx.ledgerEntry.create({
            data: {
              bookingId: booking.id,
              userId: booking.userId,
              kind: "REFUND",
              amountMinor: minorToDb(cardRefundMinor),
              currency,
              reference: target.providerRef,
            },
          });
          // Jurnal: iade yükümlülüğü iptal anında yazılır (PSP çağrısı düşse bile, retry
          // aynı anahtarla tekrarlar). Devredilmiş rezervasyonda da para emanetten döner.
          await postCancellationRefund(tx, {
            bookingId: booking.id,
            userId: booking.userId,
            priceBreakdown: booking.priceBreakdown,
            payment: { id: booking.payment.id, amountMinor: booking.payment.amountMinor },
            refundMinor: minorToDb(cardRefundMinor),
            refundedBeforeMinor: minorToDb(refundedBeforeMinor),
            currency,
            occurredAt: now,
          });
          // P1-2: bölünmüş ödemeli sepet kalemi → iade tahsil edilmiş paylara dağıtılır
          // (tamamlanmış plan varsa; CartPayment'ta eski tek-ödeme ref'i kalmış olabilir).
          if (booking.payment.cartPayment) {
            splitRefund = await allocateSplitRefundInTx(tx, {
              cartPaymentId: booking.payment.cartPayment.id,
              bookingId: booking.id,
              refundMinor: cardRefundMinor,
              currency,
            });
          }
        }
      } else if (booking.payment.status !== PaymentStatus.FAILED) {
        // Ödenmemiş (HELD) rezervasyonun kredi rezervi geri.
        await releaseBookingCreditInTx(tx, booking.id, "cancelled", now);
        await tx.payment.update({
          where: { bookingId: booking.id },
          data: { status: PaymentStatus.VOIDED },
        });
      }
    }

    if (!booking.payment) await releaseBookingCreditInTx(tx, booking.id, "cancelled", now);
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
    return { booking, decision, currency, next, target, cardRefundMinor };
  });

  const { booking, decision, currency, target, cardRefundMinor } = result;
  const provider = getPaymentProvider();
  if (splitRefund) {
    try {
      await executeSplitRefunds(booking.id);
    } catch (error) {
      logger.error({ bookingId: booking.id, ...errorFields(error) }, "split refund failed");
      await prisma.payment.update({
        where: { bookingId: booking.id },
        data: { failureCode: REFUND_FAILED },
      });
      await scheduleRefundRetry(booking.id);
    }
  } else if (pspRefOf(booking.payment)) {
    try {
      if (cardRefundMinor > 0 && target.providerRef) {
        await provider.refund(
          target.providerRef,
          money(cardRefundMinor, currency),
          `refund:${booking.id}`
        );
      } else if (
        booking.payment?.providerRef &&
        booking.payment.status !== PaymentStatus.PAID &&
        booking.payment.status !== PaymentStatus.FAILED
      ) {
        // Yalnızca kendi yetkilendirmesi: sepet payında paylaşılan işlem void EDİLMEZ.
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

/** İptal iadesinin jurnali (`refund-issued:cancel:<bookingId>`); iptal ve retry ortak. */
function postCancellationRefund(
  tx: Prisma.TransactionClient,
  i: {
    bookingId: string;
    userId: string;
    priceBreakdown: Prisma.JsonValue;
    payment: { id: string; amountMinor: bigint };
    /** Bu iptalin kart iadesi (Payment iade toplamı DEĞİL — kümülatif alan ayrı). */
    refundMinor: bigint;
    refundedBeforeMinor?: bigint;
    currency: string;
    occurredAt?: Date;
  }
) {
  return postRefundFromEscrow(tx, {
    refundRef: `cancel:${i.bookingId}`,
    bookingId: i.bookingId,
    paymentId: i.payment.id,
    guestId: i.userId,
    currency: i.currency,
    grossMinor: i.payment.amountMinor,
    priceBreakdown: i.priceBreakdown,
    refundMinor: i.refundMinor,
    refundedBeforeMinor: i.refundedBeforeMinor,
    occurredAt: i.occurredAt,
  });
}

/**
 * İptal iadesinin kart tutarı: iptalde yazılan `refund-issued:cancel:<id>` jurnalinin
 * psp_clearing alacağı. `Payment.refundedAmountMinor` kümülatiftir (talep iadeleri dahil)
 * → yeniden deneme onu KULLANMAZ. Jurnal yoksa (defter öncesi eski satır) eski davranış.
 */
async function cancelRefundMinorOf(bookingId: string, fallbackMinor: bigint): Promise<bigint> {
  const entry = await prisma.journalEntry.findUnique({
    where: { idempotencyKey: `refund-issued:cancel:${bookingId}` },
    select: {
      lines: {
        where: { side: "CREDIT", account: { kind: "PSP_CLEARING" } },
        select: { amountMinor: true },
      },
    },
  });
  if (!entry) return fallbackMinor;
  return entry.lines.reduce((sum, l) => sum + l.amountMinor, 0n);
}

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
        priceBreakdown: true,
        payment: {
          select: {
            id: true,
            status: true,
            amountMinor: true,
            providerRef: true,
            refundedAmountMinor: true,
            failureCode: true,
            cartPayment: { select: { providerRef: true } },
          },
        },
        transfers: {
          where: { status: "COMPLETED" },
          orderBy: { completedAt: "desc" },
          take: 1,
          select: { askPriceMinor: true, currency: true, claimedById: true, buyerPaymentRef: true },
        },
      },
    });
    const payment = booking?.payment;
    if (!booking || !payment || payment.failureCode !== REFUND_FAILED) return "noop";
    const currency = assertCurrency(booking.currency);
    const refundMinor = minorFromDb(
      await cancelRefundMinorOf(booking.id, payment.refundedAmountMinor)
    );
    const target = refundTarget(booking, currency);
    const provider = getPaymentProvider();
    let result: RefundRetryResult = "noop";
    try {
      if (refundMinor > 0 && (await hasSplitRefunds(booking.id))) {
        await executeSplitRefunds(booking.id);
        result = "refunded";
      } else if (refundMinor > 0 && target.providerRef) {
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
    await withSerializableRetry(async (tx) => {
      await tx.payment.updateMany({
        where: { bookingId: booking.id, failureCode: REFUND_FAILED },
        data: { failureCode: null },
      });
      // İptalde yazılan iade jurnali — aynı anahtar + içerik → idempotent tekrar (no-op).
      if (result === "refunded") {
        await postCancellationRefund(tx, {
          bookingId: booking.id,
          userId: booking.userId,
          priceBreakdown: booking.priceBreakdown,
          payment,
          refundMinor: minorToDb(refundMinor),
          currency,
        });
      }
    });
    refundRetryTotal.inc({ outcome: "succeeded" });
    await audit("system:refund-retry", "payment.refund_retried", "Booking", booking.id, {
      result,
      refundMinor,
    });
    return result;
  });
}
