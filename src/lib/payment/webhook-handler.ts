import { Prisma, PaymentStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ConflictError } from "@/lib/http/errors";
import { withSerializableRetry } from "@/lib/db/transactions";
import { money, assertCurrency, minorFromDb } from "@/lib/money/money";
import { logger } from "@/lib/observability/logger";
import { audit } from "@/lib/admin/audit";
import type { WebhookEvent } from "./webhook";
import {
  OPEN_STATUSES,
  SETTLED_STATUSES,
  WebhookMismatchError,
  refundLoser,
  journalCompensation,
  afterBookingWrite,
} from "./payment-core";
import { confirmInTransaction } from "./confirm";
import { latePaymentSuccessTotal, reconcileLateSuccess } from "./late-success";

function sameAmount(
  event: WebhookEvent,
  payment: { amountMinor: bigint; currency: string }
): boolean {
  const currency = assertCurrency(payment.currency);
  if (event.data.currency && event.data.currency.toUpperCase() !== currency) return false;
  if (event.data.amount !== undefined) {
    return event.data.amount === minorFromDb(payment.amountMinor);
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
      amountMinor: true,
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
      // P1-2: sepet tek ödemesi / bölünmüş ödeme payı (döngüsel import olmasın diye tembel).
      const { handleCartWebhookEvent } = await import("@/lib/cart/cart-webhook");
      const handled = await handleCartWebhookEvent(event);
      if (handled) return handled;
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
        // v4#8: önce mutabakat — envanter hâlâ uygunsa tutmayı yeniden al + onayla.
        if (await reconcileLateSuccess(payment.bookingId, event.data.providerRef, record)) {
          latePaymentSuccessTotal.inc({ outcome: "reconfirmed" });
          await audit("system:webhook", "payment.late_success", "Booking", payment.bookingId, {
            outcome: "reconfirmed",
            eventId: event.id,
            providerRef: event.data.providerRef,
            reason: error.code,
          });
          await afterBookingWrite(payment.booking.propertyId, payment.bookingId);
          return { duplicate: false };
        }
        // Onaylanamıyor (iptal, envanter doldu, başka ödeme kazandı) → otomatik iade + olay kaydı.
        const currency = assertCurrency(payment.currency);
        const amount = money(minorFromDb(payment.amountMinor), currency);
        await refundLoser(payment.bookingId, event.data.providerRef, amount, error.code);
        const firstRefund = await withSerializableRetry(async (tx) => {
          await record(tx);
          const now = new Date();
          const marked = await tx.payment.updateMany({
            where: {
              bookingId: payment.bookingId,
              providerRef: event.data.providerRef,
              status: { notIn: SETTLED_STATUSES },
            },
            data: {
              status: PaymentStatus.REFUNDED,
              paidAt: now,
              refundedAmountMinor: { increment: payment.amountMinor },
              refundedAt: now,
              failureCode: error.code,
            },
          });
          if (marked.count === 1) {
            await journalCompensation(tx, payment.bookingId, event.data.providerRef);
          }
          return marked.count === 1;
        });
        // fix-sweep-3 (P2-3 bulgusu): sayaç ÖDEMEYİ sayar — yalnız ilk işleme `refunded`;
        // eşzamanlı / farklı kimlikli tekrar teslimler `redelivered` (iade PSP'de zaten tek).
        latePaymentSuccessTotal.inc({ outcome: firstRefund ? "refunded" : "redelivered" });
        await audit("system:webhook", "payment.late_success", "Booking", payment.bookingId, {
          outcome: "refunded",
          eventId: event.id,
          providerRef: event.data.providerRef,
          reason: error.code,
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
