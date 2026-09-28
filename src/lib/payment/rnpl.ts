import { Prisma, PaymentStatus, type BookingStatus, type PaymentSchedule } from "@prisma/client";
import { redis } from "@/lib/redis";
import { prisma } from "@/lib/prisma";
import { appendOutbox } from "@/lib/cqrs";
import {
  EventTypes,
  makeEvent,
  type BookingCancelledPayload,
  type RnplChargeFailedPayload,
} from "@/lib/events/events";
import { ConflictError, HttpError } from "@/lib/http/errors";
import { withSerializableRetry } from "@/lib/db/transactions";
import { transition, type BookingState } from "@/lib/booking/state-machine";
import { checkInInstant, parseSnapshot, type PolicySnapshot } from "@/lib/booking/cancellation";
import { releaseInventory, BookingNotFoundError } from "@/lib/booking-service";
import { money, minorFromDb, assertCurrency } from "@/lib/money/money";
import { clockOf, fromDate, type IsoDate, type PropertyClock } from "@/lib/time/nights";
import { getConfig, type AppConfig } from "@/lib/config/app-config";
import { logger, errorFields } from "@/lib/observability/logger";
import { counter } from "@/lib/observability/metrics";
import { getQueue, QUEUE_NAMES } from "@/lib/queue";
import { postBookingCapture } from "@/lib/ledger";
import { getPaymentProvider } from "./index";
import { PaymentProviderError } from "./provider";
import { ensurePspCustomer } from "./psp-customer";
import {
  PROVIDER_ERROR_PREFIX,
  PaymentDeclinedError,
  SETTLED_STATUSES,
  afterBookingWrite,
  loadPayable,
  withPaymentLock,
} from "./payment-core";
import { applyConfirmation, confirmableBookingSelect, nextConfirmedState } from "./confirm";
import { assessBookingRisk } from "./pay";

/**
 * P1-3 "Şimdi rezerve et, sonra öde" (RNPL, ADR 0028).
 *
 * İade edilebilir tarife + ücretsiz iptal süresi olan tekil rezervasyonda misafir bugün 0 öder:
 * kart PSP'de kaydedilir (SetupIntent / MockPsp eşdeğeri), rezervasyon CONFIRMED olur ve envanter
 * satılır, ödeme satırı PENDING kalır, jurnal YAZILMAZ. Tahsilat ücretsiz iptal bitiminden
 * `RNPL_CHARGE_DAYS_BEFORE_DEADLINE` gün önce `rnpl-charge` işiyle yapılır; başarılıysa ödeme PAID
 * + `booking-captured` jurnali (tek işlem). Başarısızsa misafire bildirim (outbox) ve
 * `RNPL_GRACE_HOURS` boyunca `RNPL_RETRY_INTERVAL_HOURS` aralıkla yeniden deneme; süre dolunca
 * rezervasyon otomatik iptal + envanter bırakılır (tahsilat yok). Ücretsiz iptal süresinde iptal
 * → plan CANCELLED, hiç tahsilat yok. Fraud: yalnız risk `allow` iken.
 */

export const RNPL_CHARGE_JOB = "rnpl-charge";
export const RNPL_SWEEP_JOB = "rnpl-sweep";
/** Süpürücünün tek koşuda işlediği azami plan. */
const SWEEP_BATCH = 100;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
/** Tahsilat çağrısı sürerken yazılan işaret: çökme sonrası aynı anahtarla yeniden denenir. */
const IN_FLIGHT = "in_flight";
const OPEN_SCHEDULE = ["SCHEDULED", "RETRYING"] as const;

export const rnplChargeTotal = counter(
  "rnpl_charge_total",
  "RNPL zamanlanmış tahsilat olayları (scheduled/captured/failed/defaulted/cancelled)",
  ["outcome"] as const
);

export type RnplUnavailableReason =
  | "DISABLED"
  | "PROVIDER_UNSUPPORTED"
  | "NON_REFUNDABLE"
  | "NO_FREE_CANCELLATION"
  | "TOO_LATE"
  | "CART_BOOKING"
  | "CREDIT_NOT_SUPPORTED"
  | "NOT_PAYABLE";

export type RnplTerms =
  | { available: true; freeCancellationUntil: Date; dueAt: Date }
  | { available: false; reason: RnplUnavailableReason };

/**
 * Ücretsiz iptal süresinin bitişi: %100 iade basamağının en büyük `hoursBefore` değeri kadar
 * check-in anından önce. %100 basamağı yoksa (iade edilemez / kısmi) null.
 */
export function freeCancellationDeadline(
  snapshot: PolicySnapshot,
  checkIn: IsoDate,
  clock: PropertyClock
): Date | null {
  const full = snapshot.rules.tiers.filter((t) => t.refundPercent >= 100);
  if (full.length === 0) return null;
  const hours = Math.max(...full.map((t) => t.hoursBefore));
  return new Date(checkInInstant(checkIn, clock).getTime() - hours * HOUR_MS);
}

/** Saf uygunluk + vade hesabı (config enjekte edilebilir). */
export function rnplTerms(
  input: { refundable: boolean; snapshot: PolicySnapshot; checkIn: IsoDate; clock: PropertyClock },
  now: Date,
  cfg: Pick<
    AppConfig,
    "RNPL_ENABLED" | "RNPL_CHARGE_DAYS_BEFORE_DEADLINE" | "RNPL_MIN_LEAD_HOURS"
  > = getConfig()
): RnplTerms {
  if (!cfg.RNPL_ENABLED) return { available: false, reason: "DISABLED" };
  if (!input.refundable || input.snapshot.kind === "NON_REFUNDABLE") {
    return { available: false, reason: "NON_REFUNDABLE" };
  }
  const deadline = freeCancellationDeadline(input.snapshot, input.checkIn, input.clock);
  if (!deadline) return { available: false, reason: "NO_FREE_CANCELLATION" };
  const dueAt = new Date(deadline.getTime() - cfg.RNPL_CHARGE_DAYS_BEFORE_DEADLINE * DAY_MS);
  if (dueAt.getTime() - now.getTime() < cfg.RNPL_MIN_LEAD_HOURS * HOUR_MS) {
    return { available: false, reason: "TOO_LATE" };
  }
  return { available: true, freeCancellationUntil: deadline, dueAt };
}

const termsSelect = {
  id: true,
  userId: true,
  status: true,
  cartId: true,
  checkIn: true,
  totalPriceMinor: true,
  currency: true,
  policySnapshot: true,
  ratePlan: { select: { refundable: true } },
  property: { select: { timeZone: true, checkInTime: true, checkOutTime: true } },
} satisfies Prisma.BookingSelect;

type TermsBooking = Prisma.BookingGetPayload<{ select: typeof termsSelect }>;

function termsFor(booking: TermsBooking, now: Date): RnplTerms {
  if (booking.cartId) return { available: false, reason: "CART_BOOKING" };
  if (booking.status !== "HELD") return { available: false, reason: "NOT_PAYABLE" };
  if (!getPaymentProvider().setupCard) {
    return { available: false, reason: "PROVIDER_UNSUPPORTED" };
  }
  return rnplTerms(
    {
      // Tarife seçilmemiş eski rezervasyon: politika belirler.
      refundable: booking.ratePlan?.refundable ?? true,
      snapshot: parseSnapshot(booking.policySnapshot),
      checkIn: fromDate(booking.checkIn),
      clock: clockOf(booking.property),
    },
    now
  );
}

export interface RnplOffer {
  available: boolean;
  reason?: RnplUnavailableReason;
  /** Bugün tahsil edilecek tutar (her zaman 0). */
  dueTodayMinor: 0;
  amountMinor: number;
  currency: string;
  dueAt?: string;
  freeCancellationUntil?: string;
}

/** Checkout için teklif (misafirin kendi HELD rezervasyonu). RNPL kapalıyken `DISABLED`. */
export async function getRnplOffer(
  bookingId: string,
  userId: string,
  now = new Date()
): Promise<RnplOffer> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: termsSelect,
  });
  if (!booking || booking.userId !== userId) throw new BookingNotFoundError();
  const terms = termsFor(booking, now);
  const base = {
    dueTodayMinor: 0 as const,
    amountMinor: minorFromDb(booking.totalPriceMinor),
    currency: booking.currency,
  };
  if (!terms.available) return { ...base, available: false, reason: terms.reason };
  return {
    ...base,
    available: true,
    dueAt: terms.dueAt.toISOString(),
    freeCancellationUntil: terms.freeCancellationUntil.toISOString(),
  };
}

export class RnplUnavailableError extends HttpError {
  constructor(reason: RnplUnavailableReason | "RISK") {
    super(
      409,
      "RNPL_UNAVAILABLE",
      "Bu rezervasyon için 'şimdi rezerve et, sonra öde' kullanılamaz",
      {
        reason,
      }
    );
    this.name = "RnplUnavailableError";
  }
}

export type RnplOutcome = {
  status: "scheduled";
  bookingId: string;
  paymentId: string;
  /** Bugün tahsil edilen tutar: 0. */
  amount: 0;
  currency: string;
  scheduledAmount: number;
  dueAt: string;
  freeCancellationUntil: string;
};

function outcomeOf(s: PaymentSchedule, paymentId: string): RnplOutcome {
  return {
    status: "scheduled",
    bookingId: s.bookingId,
    paymentId,
    amount: 0,
    currency: s.currency,
    scheduledAmount: minorFromDb(s.amountMinor),
    dueAt: s.dueAt.toISOString(),
    freeCancellationUntil: s.freeCancellationUntil.toISOString(),
  };
}

/**
 * RNPL ile rezervasyon: uygunluk + risk `allow` + kart kaydı → tek işlemde HELD→CONFIRMED
 * (envanter satılır, jurnal yok), ödeme PENDING, `PaymentSchedule` SCHEDULED; sonra gecikmeli
 * `rnpl-charge` işi. Aynı rezervasyon için tekrar çağrı idempotenttir.
 */
export async function reserveNowPayLater(input: {
  bookingId: string;
  userId: string;
  cardToken: string;
  idempotencyKey: string;
  creditMinor?: number;
  context?: { ip?: string; ipCountry?: string | null; deviceId?: string | null };
  now?: Date;
}): Promise<RnplOutcome> {
  await loadPayable(input.bookingId, input.userId);
  try {
    return await withPaymentLock(input.bookingId, () => reserveLocked(input));
  } finally {
    // Ret yolları da ödeme durumunu değiştirir → okuma önbelleği her sonuçta düşer.
    await redis.del(`booking:${input.bookingId}`).catch(() => 0);
  }
}

async function reserveLocked(
  input: Parameters<typeof reserveNowPayLater>[0]
): Promise<RnplOutcome> {
  const now = input.now ?? new Date();
  const existing = await prisma.paymentSchedule.findUnique({
    where: { bookingId: input.bookingId },
    include: { booking: { select: { payment: { select: { id: true } } } } },
  });
  if (existing && existing.userId === input.userId && existing.booking.payment) {
    return outcomeOf(existing, existing.booking.payment.id); // idempotent tekrar
  }
  if ((input.creditMinor ?? 0) > 0) throw new RnplUnavailableError("CREDIT_NOT_SUPPORTED");
  const booking = await prisma.booking.findUnique({
    where: { id: input.bookingId },
    select: termsSelect,
  });
  if (!booking || booking.userId !== input.userId) throw new BookingNotFoundError();
  const terms = termsFor(booking, now);
  if (!terms.available) throw new RnplUnavailableError(terms.reason);

  const payable = await loadPayable(input.bookingId, input.userId);
  if (payable.creditMinor > 0n) throw new RnplUnavailableError("CREDIT_NOT_SUPPORTED");
  const risk = await assessBookingRisk(payable, input);
  await prisma.fraudCheck.create({
    data: {
      bookingId: booking.id,
      userId: input.userId,
      score: risk.score,
      decision: risk.decision,
      reasons: risk.hits as unknown as Prisma.InputJsonValue,
    },
  });
  if (risk.decision !== "allow") {
    rnplChargeTotal.inc({ outcome: "risk_rejected" });
    throw new RnplUnavailableError("RISK");
  }

  const provider = getPaymentProvider();
  if (!provider.setupCard) throw new RnplUnavailableError("PROVIDER_UNSUPPORTED");
  const customerRef = (await ensurePspCustomer(provider, input.userId)) ?? undefined;
  const setup = await provider.setupCard({
    cardToken: input.cardToken,
    idempotencyKey: `rnpl-setup:${booking.id}:${input.idempotencyKey}`,
    customerRef,
    metadata: { bookingId: booking.id },
  });
  if (setup.status === "declined") throw new PaymentDeclinedError(setup.declineCode);

  const amountMinor = booking.totalPriceMinor;
  const result = await withSerializableRetry(async (tx) => {
    const confirmable = await tx.booking.findUnique({
      where: { id: booking.id },
      select: { ...confirmableBookingSelect, payment: { select: { id: true, status: true } } },
    });
    if (!confirmable) throw new BookingNotFoundError();
    if (confirmable.payment && SETTLED_STATUSES.includes(confirmable.payment.status)) {
      throw new ConflictError("Bu rezervasyon zaten ödendi", "INVALID_STATE");
    }
    const next = nextConfirmedState(confirmable);
    const provider = getPaymentProvider().name;
    const payment = await tx.payment.upsert({
      where: { bookingId: booking.id },
      create: {
        bookingId: booking.id,
        userId: booking.userId,
        amountMinor,
        currency: booking.currency,
        provider,
        status: PaymentStatus.PENDING,
      },
      update: {
        amountMinor,
        provider,
        status: PaymentStatus.PENDING,
        providerRef: null,
        failureCode: null,
      },
      select: { id: true, amountMinor: true },
    });
    await applyConfirmation(tx, confirmable, next, payment, { journal: false });
    const schedule = await tx.paymentSchedule.create({
      data: {
        bookingId: booking.id,
        userId: booking.userId,
        dueAt: terms.dueAt,
        amountMinor,
        currency: booking.currency,
        paymentMethodRef: setup.paymentMethodRef,
        customerRef: setup.customerRef ?? customerRef ?? null,
        freeCancellationUntil: terms.freeCancellationUntil,
      },
    });
    return { schedule, paymentId: payment.id, propertyId: confirmable.propertyId };
  });
  rnplChargeTotal.inc({ outcome: "scheduled" });
  await afterBookingWrite(result.propertyId, booking.id);
  await scheduleRnplCharge(result.schedule, now);
  return outcomeOf(result.schedule, result.paymentId);
}

/** Vadeye (ya da yeniden deneme anına) gecikmeli `rnpl-charge` işi; kuyruk yoksa süpürücü alır. */
export async function scheduleRnplCharge(
  schedule: Pick<PaymentSchedule, "id" | "dueAt" | "nextAttemptAt" | "attempts">,
  now = new Date()
): Promise<void> {
  const at = schedule.nextAttemptAt ?? schedule.dueAt;
  try {
    await getQueue(QUEUE_NAMES.rnpl).add(
      RNPL_CHARGE_JOB,
      { scheduleId: schedule.id },
      {
        jobId: `rnpl-${schedule.id}-${schedule.attempts}`,
        delay: Math.max(0, at.getTime() - now.getTime()),
        attempts: 3,
        backoff: { type: "exponential", delay: 30_000 },
        removeOnComplete: true,
        removeOnFail: 1000,
      }
    );
  } catch (error) {
    logger.warn(
      { scheduleId: schedule.id, ...errorFields(error) },
      "rnpl charge job could not be scheduled; sweep will handle it"
    );
  }
}

export type RnplChargeResult =
  "captured" | "retry_scheduled" | "defaulted" | "cancelled" | "not_due" | "noop";

/**
 * Planın tahsilatı (iş ve süpürücü). Ödeme kilidi altında: eşzamanlı iptal ile sıralanır.
 * Başarısızlıkta ek süre içindeyse yeniden deneme + bildirim, süre dolduysa otomatik iptal.
 */
export async function chargeRnplSchedule(
  scheduleId: string,
  now = new Date()
): Promise<RnplChargeResult> {
  const head = await prisma.paymentSchedule.findUnique({
    where: { id: scheduleId },
    select: { bookingId: true },
  });
  if (!head) return "noop";
  return withPaymentLock(head.bookingId, () => chargeLocked(scheduleId, now));
}

async function chargeLocked(scheduleId: string, now: Date): Promise<RnplChargeResult> {
  const schedule = await prisma.paymentSchedule.findUniqueOrThrow({
    where: { id: scheduleId },
    include: { booking: { select: { status: true, payment: { select: { id: true } } } } },
  });
  if (!(OPEN_SCHEDULE as readonly string[]).includes(schedule.status)) return "noop";
  if (schedule.booking.status !== "CONFIRMED" || !schedule.booking.payment) {
    // Başka yoldan iptal edilmiş rezervasyon: tahsilat yok.
    await prisma.paymentSchedule.updateMany({
      where: { id: schedule.id, status: { in: [...OPEN_SCHEDULE] } },
      data: { status: "CANCELLED", nextAttemptAt: null },
    });
    rnplChargeTotal.inc({ outcome: "cancelled" });
    return "cancelled";
  }
  const at = schedule.status === "SCHEDULED" ? schedule.dueAt : schedule.nextAttemptAt;
  if (at && at.getTime() > now.getTime()) return "not_due";

  // Çökme sonrası (işaret kaldıysa) aynı deneme numarası → PSP aynı sonucu döner (çift tahsilat yok).
  const attempt =
    schedule.lastFailureCode === IN_FLIGHT ? schedule.attempts : schedule.attempts + 1;
  await prisma.paymentSchedule.update({
    where: { id: schedule.id },
    data: { attempts: attempt, lastFailureCode: IN_FLIGHT },
  });
  const currency = assertCurrency(schedule.currency);
  const provider = getPaymentProvider();
  let declineCode: string;
  try {
    if (!provider.chargeSaved) {
      throw new PaymentProviderError(
        "unsupported",
        "Sağlayıcı kayıtlı kart tahsilatı desteklemiyor"
      );
    }
    const result = await provider.chargeSaved({
      amount: money(minorFromDb(schedule.amountMinor), currency),
      paymentMethodRef: schedule.paymentMethodRef,
      customerRef: schedule.customerRef ?? undefined,
      idempotencyKey: `rnpl:${schedule.id}:${attempt}`,
      metadata: { bookingId: schedule.bookingId, purpose: "rnpl" },
    });
    if (result.status === "captured") {
      await settleCapture(schedule, schedule.booking.payment.id, result.providerRef, now);
      rnplChargeTotal.inc({ outcome: "captured" });
      return "captured";
    }
    declineCode = result.declineCode;
  } catch (error) {
    if (!(error instanceof PaymentProviderError)) throw error;
    declineCode = `${PROVIDER_ERROR_PREFIX}${error.code}`.slice(0, 64);
  }
  rnplChargeTotal.inc({ outcome: "failed" });
  return handleFailure(schedule, attempt, declineCode, now);
}

/** Tahsilat başarılı: ödeme PAID + `booking-captured` jurnali + plan CAPTURED (tek işlem). */
async function settleCapture(
  schedule: PaymentSchedule,
  paymentId: string,
  providerRef: string,
  now: Date
): Promise<void> {
  await withSerializableRetry(async (tx) => {
    const marked = await tx.paymentSchedule.updateMany({
      where: { id: schedule.id, status: { in: [...OPEN_SCHEDULE] } },
      data: {
        status: "CAPTURED",
        providerRef,
        capturedAt: now,
        lastFailureCode: null,
        nextAttemptAt: null,
      },
    });
    if (marked.count !== 1) return;
    const payment = await tx.payment.update({
      where: { id: paymentId },
      data: {
        status: PaymentStatus.PAID,
        providerRef,
        authorizedAt: now,
        paidAt: now,
        failureCode: null,
        amountMinor: schedule.amountMinor,
      },
      select: { id: true, amountMinor: true, booking: { select: { priceBreakdown: true } } },
    });
    await postBookingCapture(tx, {
      bookingId: schedule.bookingId,
      paymentId: payment.id,
      currency: schedule.currency,
      grossMinor: payment.amountMinor,
      priceBreakdown: payment.booking.priceBreakdown,
      occurredAt: now,
    });
  });
}

async function handleFailure(
  schedule: PaymentSchedule,
  attempt: number,
  declineCode: string,
  now: Date
): Promise<RnplChargeResult> {
  const cfg = getConfig();
  const firstFailedAt = schedule.firstFailedAt ?? now;
  const graceEnd = new Date(firstFailedAt.getTime() + cfg.RNPL_GRACE_HOURS * HOUR_MS);
  if (now.getTime() >= graceEnd.getTime()) {
    await defaultSchedule(schedule, declineCode, now);
    return "defaulted";
  }
  const retryAt = new Date(
    Math.min(now.getTime() + cfg.RNPL_RETRY_INTERVAL_HOURS * HOUR_MS, graceEnd.getTime())
  );
  const updated = await withSerializableRetry(async (tx) => {
    const row = await tx.paymentSchedule.update({
      where: { id: schedule.id },
      data: {
        status: "RETRYING",
        firstFailedAt,
        nextAttemptAt: retryAt,
        lastFailureCode: declineCode,
      },
    });
    await appendOutbox(
      tx,
      makeEvent<RnplChargeFailedPayload>(EventTypes.RnplChargeFailed, schedule.id, "booking", {
        scheduleId: schedule.id,
        bookingId: schedule.bookingId,
        userId: schedule.userId,
        attempt,
        amountMinor: minorFromDb(schedule.amountMinor),
        currency: schedule.currency,
        retryAt: retryAt.toISOString(),
        cancelAt: graceEnd.toISOString(),
      })
    );
    return row;
  });
  await scheduleRnplCharge(updated, now);
  return "retry_scheduled";
}

/** Ek süre doldu: rezervasyon otomatik iptal, envanter bırakılır, ödeme VOIDED (tahsilat yok). */
async function defaultSchedule(
  schedule: PaymentSchedule,
  declineCode: string,
  now: Date
): Promise<void> {
  const propertyId = await withSerializableRetry(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Booking" WHERE id = ${schedule.bookingId} FOR UPDATE`;
    const booking = await tx.booking.findUniqueOrThrow({
      where: { id: schedule.bookingId },
      select: {
        id: true,
        userId: true,
        status: true,
        version: true,
        propertyId: true,
        roomId: true,
        checkIn: true,
        checkOut: true,
        units: true,
        currency: true,
      },
    });
    let next: BookingState;
    try {
      next = transition(booking.status as BookingState, "CANCEL");
    } catch {
      throw new ConflictError("Bu rezervasyon iptal edilemez", "INVALID_STATE");
    }
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
    await tx.payment.updateMany({
      where: { bookingId: booking.id, status: { notIn: SETTLED_STATUSES } },
      data: { status: PaymentStatus.VOIDED, failureCode: "RNPL_DEFAULTED" },
    });
    await tx.paymentSchedule.update({
      where: { id: schedule.id },
      data: { status: "DEFAULTED", lastFailureCode: declineCode, nextAttemptAt: null },
    });
    await appendOutbox(
      tx,
      makeEvent<BookingCancelledPayload>(EventTypes.BookingCancelled, booking.id, "booking", {
        bookingId: booking.id,
        propertyId: booking.propertyId,
        roomId: booking.roomId,
        checkIn: fromDate(booking.checkIn),
        checkOut: fromDate(booking.checkOut),
        userId: booking.userId,
        refundMinor: 0,
        currency: booking.currency,
        reason: "rnpl_payment_failed",
      })
    );
    return booking.propertyId;
  });
  rnplChargeTotal.inc({ outcome: "defaulted" });
  await afterBookingWrite(propertyId, schedule.bookingId);
}

/**
 * Misafir iptali (refund.ts, iptal işlemi içinde): açık plan CANCELLED → hiç tahsilat yok.
 * Tahsil edilmiş plan (CAPTURED) normal iade yolundan geçer.
 */
export async function cancelRnplScheduleInTx(
  tx: Prisma.TransactionClient,
  bookingId: string
): Promise<boolean> {
  const { count } = await tx.paymentSchedule.updateMany({
    where: { bookingId, status: { in: [...OPEN_SCHEDULE] } },
    data: { status: "CANCELLED", nextAttemptAt: null },
  });
  return count === 1;
}

/** Yedek süpürücü: vadesi gelmiş / yeniden denenecek planlar (iş kaybolduysa). */
export async function sweepRnplCharges(now = new Date()): Promise<Record<string, number>> {
  const due = await prisma.paymentSchedule.findMany({
    where: {
      OR: [
        { status: "SCHEDULED", dueAt: { lte: now } },
        { status: "RETRYING", nextAttemptAt: { lte: now } },
      ],
    },
    orderBy: { dueAt: "asc" },
    take: SWEEP_BATCH,
    select: { id: true },
  });
  const counts: Record<string, number> = {};
  for (const { id } of due) {
    try {
      const r = await chargeRnplSchedule(id, now);
      counts[r] = (counts[r] ?? 0) + 1;
    } catch (error) {
      counts.error = (counts.error ?? 0) + 1;
      logger.error({ scheduleId: id, ...errorFields(error) }, "rnpl sweep charge failed");
    }
  }
  return counts;
}

/** `/pay` gövdesindeki seçenek doğrulaması: RNPL kapalıyken 409 (seçenek görünmez). */
export function assertRnplEnabled(): void {
  if (!getConfig().RNPL_ENABLED) throw new RnplUnavailableError("DISABLED");
}
