import { Prisma, PaymentStatus, type BookingStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { appendOutbox } from "@/lib/cqrs";
import { EventTypes, makeEvent, type BookingConfirmedPayload } from "@/lib/events/events";
import { ConflictError } from "@/lib/http/errors";
import { withConfirmRetry, withSerializableRetry } from "@/lib/db/transactions";
import { transition, type BookingState } from "@/lib/booking/state-machine";
import { releaseHold, BookingNotFoundError } from "@/lib/booking-service";
import { rerunCompensations, runSaga, type SagaStep } from "@/lib/saga/saga";
import { scheduleCompensationRetry } from "@/lib/saga/compensation-retry";
import { PAYMENT_SAGA, SAGA_STEPS } from "@/lib/saga/booking-saga";
import { type Money, minorToDb, minorFromDb } from "@/lib/money/money";
import { fromDate } from "@/lib/time/nights";
import { commitHeld } from "@/lib/booking/inventory";
import { getPaymentProvider } from "./index";
import { postBookingCapture } from "@/lib/ledger";
import { releaseBookingCredit, settleBookingCreditInTx } from "@/lib/wallet/wallet-service";
import {
  paymentsTotal,
  captureRaceTotal,
  OPEN_STATUSES,
  SETTLED_STATUSES,
  PaymentInProgressError,
  CaptureRaceLostError,
  type PayOutcome,
  type PayableBooking,
  loadPayable,
  chargeOf,
  amountOf,
  transitionPayment,
  voidLoser,
  journalCompensation,
  afterBookingWrite,
  withPaymentLock,
} from "./payment-core";

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
    name: SAGA_STEPS.credit,
    // P1-7: kredi rezervi saga öncesi (provizyondan önce) alındı; adım yalnızca telafiyi taşır.
    run: async () => undefined,
    compensate: async (ctx) => {
      if (ctx.booking.creditMinor <= 0n) return false;
      await releaseBookingCredit(ctx.booking.id, "payment_failed");
    },
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
      await withSerializableRetry(async (tx) => {
        const now = new Date();
        const marked = await tx.payment.updateMany({
          where: {
            bookingId: ctx.booking.id,
            providerRef: ctx.providerRef,
            status: { notIn: SETTLED_STATUSES },
          },
          data: {
            status: PaymentStatus.REFUNDED,
            paidAt: now,
            // Kümülatif alan: koşul (tahsil edilmemiş satır) önceki iadeyi 0 kılar.
            refundedAmountMinor: { increment: minorToDb(ctx.amount.amount) },
            refundedAt: now,
            failureCode: "BOOKING_NOT_CONFIRMABLE",
          },
        });
        if (marked.count === 1) await journalCompensation(tx, ctx.booking.id, ctx.providerRef);
      });
      paymentsTotal.inc({ outcome: "compensated" });
    },
  },
  {
    name: SAGA_STEPS.confirm,
    pivot: true,
    run: async (ctx) => {
      // HELD→CONFIRMED + PAID + defter + outbox (tek işlem).
      // fix-sweep-3: onay adımının ayrı (üst sınırlı geri çekilmeli) deneme bütçesi.
      const paymentId = await withConfirmRetry(
        (tx) => confirmInTransaction(tx, ctx.booking.id, ctx.providerRef),
        { label: `${PAYMENT_SAGA}.confirm` }
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
          ...creditField(ctx.booking.creditMinor),
        },
      };
    },
  },
];

/** Yetkilendirilmiş ödemeyi saga ile tahsil eder ve rezervasyonu onaylar. */
export async function captureAndConfirm(
  booking: PayableBooking,
  providerRef: string,
  claimFrom: readonly PaymentStatus[] = OPEN_STATUSES
): Promise<PayOutcome> {
  const ctx: PaymentSagaCtx = {
    booking,
    providerRef,
    amount: chargeOf(booking),
    claimFrom,
    claimed: false,
    captured: false,
  };
  try {
    return await runSaga(PAYMENT_SAGA, PAYMENT_SAGA_STEPS, ctx, {
      from: SAGA_STEPS.capture,
      // fix-sweep-3: void/iade düştüyse `saga-compensation-retry` (açık yetkilendirme kalmasın).
      onCompensationFailed: (steps) =>
        scheduleCompensationRetry(
          {
            saga: "payment",
            bookingId: booking.id,
            userId: booking.userId,
            providerRef,
            claimed: ctx.claimed,
            captured: ctx.captured,
          },
          steps
        ),
    });
  } catch (error) {
    if (error instanceof CaptureRaceLostError) {
      // Başka bir ödeme bu arada onayladı: bizimki iade edildi → idempotent sonuç.
      captureRaceTotal.inc({ action: "refund" });
      return alreadyConfirmed(booking.id, booking.userId);
    }
    throw error;
  }
}

/**
 * fix-sweep-3: tekil ödeme sagasının telafisini DB'den kurulan bağlamla (idempotent) yeniden
 * çalıştırır (`saga-compensation-retry`). Ödeme bu ref'le tahsil edilmiş sayılıyorsa (onay
 * kazandı) hiçbir şey yapılmaz; tahsil hakkını almamış yetkilendirme yalnız PSP'de void edilir.
 */
export async function retryPaymentCompensation(input: {
  bookingId: string;
  userId: string;
  providerRef: string;
  claimed: boolean;
  captured: boolean;
}): Promise<"compensated" | "noop"> {
  return withPaymentLock(input.bookingId, async () => {
    const booking = await loadPayable(input.bookingId, input.userId);
    const ours = booking.payment?.providerRef === input.providerRef;
    if (!input.claimed || !ours) {
      if (input.captured) return "noop";
      await getPaymentProvider().void(input.providerRef);
      return "compensated" as const;
    }
    if (booking.payment && SETTLED_STATUSES.includes(booking.payment.status)) {
      if (booking.payment.status !== PaymentStatus.REFUNDED) return "noop";
    }
    // Tutar ödeme satırından: kredi telafisi önceki koşuda çalıştıysa `chargeOf` toplamı verir.
    const row = await prisma.payment.findUniqueOrThrow({
      where: { bookingId: booking.id },
      select: { amountMinor: true, currency: true },
    });
    const ctx: PaymentSagaCtx = {
      booking,
      providerRef: input.providerRef,
      amount: amountOf({ totalPriceMinor: row.amountMinor, currency: row.currency }),
      claimFrom: OPEN_STATUSES,
      claimed: true,
      captured: input.captured,
    };
    const steps = PAYMENT_SAGA_STEPS.filter((s) => s.name !== SAGA_STEPS.confirm);
    await rerunCompensations(PAYMENT_SAGA, steps as SagaStep<PaymentSagaCtx, unknown>[], ctx);
    return "compensated" as const;
  });
}

function creditField(creditMinor: bigint): { creditMinor?: number } {
  return creditMinor > 0n ? { creditMinor: minorFromDb(creditMinor) } : {};
}

/** Rezervasyon başka bir ödemeyle onaylandıysa onu (idempotent sonuç) döner. */
export async function alreadyConfirmed(bookingId: string, userId: string): Promise<PayOutcome> {
  const fresh = await loadPayable(bookingId, userId);
  if (
    fresh.status === "CONFIRMED" &&
    fresh.payment &&
    SETTLED_STATUSES.includes(fresh.payment.status)
  ) {
    const amount = chargeOf(fresh);
    return {
      status: "confirmed",
      bookingId,
      paymentId: fresh.payment.id,
      amount: amount.amount,
      currency: amount.currency,
      ...creditField(fresh.creditMinor),
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
      ...confirmableBookingSelect,
      payment: { select: { id: true, status: true, providerRef: true } },
    },
  });
  if (!booking) throw new BookingNotFoundError();
  if (booking.payment && SETTLED_STATUSES.includes(booking.payment.status)) {
    if (booking.payment.providerRef === providerRef) return booking.payment.id; // idempotent
    throw new CaptureRaceLostError();
  }
  const next = nextConfirmedState(booking);
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
  const payment = await tx.payment.findUniqueOrThrow({
    where: { bookingId: booking.id },
    select: { id: true, amountMinor: true },
  });
  // P1-7: kredi payı (RESERVED → SPENT + creditSpent jurnali); kart + kredi = toplam değilse 409.
  await settleBookingCreditInTx(tx, {
    bookingId: booking.id,
    totalMinor: booking.totalPriceMinor,
    cardMinor: payment.amountMinor,
    priceBreakdown: booking.priceBreakdown,
    currency: booking.currency,
  });
  await applyConfirmation(tx, booking, next, payment, providerRef);
  return payment.id;
}

/** Onaylanacak rezervasyonun okunması gereken alanları (tek ve sepet onayı ortak). */
export const confirmableBookingSelect = {
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
  units: true,
  priceBreakdown: true,
} satisfies Prisma.BookingSelect;

export type ConfirmableBooking = Prisma.BookingGetPayload<{
  select: typeof confirmableBookingSelect;
}>;

/** HELD → CONFIRMED geçişi mümkün mü (durum + tutma süresi); değilse 409. */
export function nextConfirmedState(booking: ConfirmableBooking): BookingState {
  let next: BookingState;
  try {
    next = transition(booking.status as BookingState, "CONFIRM");
  } catch {
    throw new ConflictError("Rezervasyon artık onaylanamaz", "BOOKING_NOT_CONFIRMABLE");
  }
  if (booking.holdExpiresAt && booking.holdExpiresAt.getTime() < Date.now()) {
    throw new ConflictError("Rezervasyon tutma süresi doldu", "HOLD_EXPIRED");
  }
  return next;
}

/**
 * Ödeme satırı PAID yazıldıktan sonra: durum geçişi (sürüm koşullu) + envanter held→sold +
 * eski defter (dual-write) + çift girişli jurnal + outbox. Tek rezervasyon ödemesi ve sepet
 * (P1-1) onayı bu adımı AYNI işlem içinde paylaşır.
 */
export async function applyConfirmation(
  tx: Prisma.TransactionClient,
  booking: ConfirmableBooking,
  next: BookingState,
  payment: { id: string; amountMinor: bigint },
  providerRef: string
): Promise<void> {
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
  // Eski defter PSP tahsilatını izler (P1-7: kredi payı hariç; tek kart ödemesinde = toplam).
  const legacyCharge = minorToDb(amount.amount);
  await tx.ledgerEntry.create({
    data: {
      bookingId: booking.id,
      userId: booking.userId,
      kind: "CHARGE",
      amountMinor: payment.amountMinor < legacyCharge ? payment.amountMinor : legacyCharge,
      currency: amount.currency,
      reference: providerRef,
    },
  });
  // Çift girişli defter (ADR 0020, dual-write): tahsilat emanete + vergi payı tax_payable'a.
  await postBookingCapture(tx, {
    bookingId: booking.id,
    paymentId: payment.id,
    currency: amount.currency,
    grossMinor: payment.amountMinor,
    priceBreakdown: booking.priceBreakdown,
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
}
