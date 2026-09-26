import { Prisma, BookingStatus } from "@prisma/client";
import { withLegacyDecimals } from "@/lib/money/legacy-json";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { invalidatePropertySearchCache } from "@/lib/search";
import { createRedlock, LockError } from "@/lib/distributed-lock/redlock";
import { appendOutbox } from "@/lib/cqrs";
import {
  EventTypes,
  makeEvent,
  type BookingCancelledPayload,
  type BookingCreatedPayload,
  type BookingExpiredPayload,
} from "@/lib/events/events";
import { requireOwnership } from "@/lib/security/ownership";
import { HttpError, ValidationError } from "@/lib/http/errors";
import { bookingCacheKey, invalidateBookingCache } from "@/lib/booking/booking-cache";
import { hashIdempotentRequest } from "@/lib/http/idempotency";
import { getConfig } from "@/lib/config/app-config";
import { withSerializableRetry } from "@/lib/db/transactions";
import { transition, type BookingState } from "@/lib/booking/state-machine";
import { DEFAULT_POLICIES, toSnapshot } from "@/lib/booking/cancellation";
import {
  chargeAmount,
  getCurrentFx,
  getFxById,
  resolveChargeCurrency,
  type FxTable,
} from "@/lib/fx/store";
import { taxRulesFor } from "@/lib/pricing/tax";
import { money, toDecimalString, assertCurrency, minorToDb, minorFromDb } from "@/lib/money/money";
import {
  clockOf,
  DateRangeError,
  fromDate,
  parseStay,
  todayIn,
  toDbDate,
  type IsoDate,
} from "@/lib/time/nights";
import {
  loadQuote,
  nightsFromInventory,
  pickRatePlan,
  priceStay,
  RestrictionError,
  samePrice,
  SoldOutError,
  type PricedStay,
  type Quote,
} from "@/lib/pricing/quote";
import { checkRestrictions, describeViolation } from "@/lib/booking/restrictions";
import { holdUnits, InventoryUnavailableError, releaseForStatus } from "@/lib/booking/inventory";
import { logger, errorFields } from "@/lib/observability/logger";
import { counter } from "@/lib/observability/metrics";
import { LISTABLE_PROPERTY } from "@/lib/compliance/listing";

/**
 * Rezervasyon çekirdeği — fazla satış kanıtlanabilir biçimde imkânsızdır (ADR 0002, 0010):
 *
 *  1. Redlock (oda tipi düzeyi, fencing token) — aynı oda tipine eşzamanlı yazanları sıralar.
 *  2. SERIALIZABLE işlem + `SELECT … FOR UPDATE` + koşullu sayaç
 *     (`held = held + u WHERE sold + held + u <= total`) — veritabanı CHECK kısıtıyla birlikte
 *     yetkili kaynaktır; Redis kilidi kaybedilse bile fazla satış yazılamaz.
 *  3. Idempotency anahtarı — (userId, key) benzersiz; tekrar eden istek aynı sonucu alır.
 *
 * Oda tipinin `units` adedi kadar eşzamanlı rezervasyon kabul edilir; satış kısıtları
 * (min/max konaklama, CTA/CTD, stop-sell) ve fiyat planı (iade edilemez, kahvaltılı…)
 * teklifle aynı saf fonksiyonlarla uygulanır.
 *
 * Yeni rezervasyon HELD durumunda doğar (`holdExpiresAt` = şimdi + BOOKING_HOLD_TTL_MINUTES);
 * ödeme onaylanınca CONFIRMED olur, süre dolarsa `expireHolds` envanteri iade eder.
 * Fiyat `priceStay` ile (arama/PDP/checkout ile aynı fonksiyon) kilitli satırlardan hesaplanır;
 * istemci teklif (`quoteId`) gönderdiyse ve fiyat değiştiyse 409 PRICE_CHANGED.
 * Para birimi DAİMA mülkün para birimidir (istemci seçemez).
 */

const redlock = createRedlock(redis);

const bookingsCreated = counter("booking_created_total", "Oluşturulan rezervasyonlar", [
  "outcome",
] as const);
const bookingsExpired = counter("booking_expired_total", "Süresi dolan tutmalar");
const inventoryDriftOnExpire = counter(
  "booking_expire_inventory_drift_total",
  "Süre dolumunda envanter sayacı tutarsız bulunan tutmalar"
);

/** Rezervasyon çakışması (dolu, geçersiz durum, eşzamanlı değişiklik) → 409 */
export class BookingConflictError extends HttpError {
  constructor(message: string, code = "BOOKING_CONFLICT", details?: unknown) {
    super(409, code, message, details);
    this.name = "BookingConflictError";
  }
}

/** Doğrulama hatası (tarih aralığı, kapasite) → 400 */
export class BookingValidationError extends HttpError {
  constructor(message: string) {
    super(400, "BOOKING_INVALID", message);
    this.name = "BookingValidationError";
  }
}

/**
 * Kayıt bulunamadı → 404. Başkasının rezervasyonuna erişim de 404 döner
 * (IDOR: kaynağın varlığı bile sızdırılmaz).
 */
export class BookingNotFoundError extends HttpError {
  constructor(message = "Rezervasyon bulunamadı") {
    super(404, "BOOKING_NOT_FOUND", message);
    this.name = "BookingNotFoundError";
  }
}

export interface CreateBookingInput {
  userId: string;
  propertyId: string;
  roomId: string;
  checkIn: string;
  checkOut: string;
  guestCount: number;
  /** Fiyat planı (yoksa varsayılan plan). */
  ratePlanId?: string;
  /** Oda adedi (varsayılan 1). */
  units?: number;
  /** Idempotency anahtarı (aynı anahtar + kullanıcı → aynı rezervasyon döner). */
  idempotencyKey?: string;
  /** Checkout'ta gösterilen teklif; verilirse fiyat birebir eşleşmelidir. */
  quoteId?: string;
  /** Tahsilat para birimi (yoksa teklifinki, o da yoksa tesisinki; P0-5). */
  currency?: string;
}

export interface BookingDTO {
  id: string;
  propertyId: string;
  roomId: string;
  ratePlanId: string | null;
  units: number;
  checkIn: string;
  checkOut: string;
  guestCount: number;
  /** Görüntüleme için ana birim (ör. 1234.5); hesaplamada `totalMinor` kullanılır. */
  totalPrice: number;
  totalMinor: number;
  currency: string;
  status: BookingStatus;
  holdExpiresAt: string | null;
  priceBreakdown: PricedStay | null;
}

export interface BookingResult {
  booking: BookingDTO;
  paymentRequired: boolean;
}

const bookingSelect = {
  id: true,
  propertyId: true,
  roomId: true,
  ratePlanId: true,
  units: true,
  checkIn: true,
  checkOut: true,
  guestCount: true,
  totalPriceMinor: true,
  currency: true,
  status: true,
  holdExpiresAt: true,
  priceBreakdown: true,
} satisfies Prisma.BookingSelect;

type BookingRow = Prisma.BookingGetPayload<{ select: typeof bookingSelect }>;

function toDto(row: BookingRow): BookingDTO {
  const currency = assertCurrency(row.currency);
  const totalMinor = minorFromDb(row.totalPriceMinor);
  return {
    id: row.id,
    propertyId: row.propertyId,
    roomId: row.roomId,
    ratePlanId: row.ratePlanId,
    units: row.units,
    checkIn: fromDate(row.checkIn),
    checkOut: fromDate(row.checkOut),
    guestCount: row.guestCount,
    totalPrice: Number(toDecimalString(money(totalMinor, currency))),
    totalMinor,
    currency,
    status: row.status,
    holdExpiresAt: row.holdExpiresAt?.toISOString() ?? null,
    priceBreakdown: (row.priceBreakdown as PricedStay | null) ?? null,
  };
}

/**
 * Aynı kullanıcı + Idempotency-Key ile önceki rezervasyon. Gövde özeti farklıysa 409
 * `IDEMPOTENCY_KEY_REUSED` (v4#9) — eski kayıt sessizce döndürülmez. Özeti olmayan (v4 öncesi)
 * satırlar geriye uyum için olduğu gibi döner.
 */
async function findByIdempotencyKey(
  userId: string,
  key: string,
  requestHash: string
): Promise<BookingDTO | null> {
  const row = await prisma.booking.findUnique({
    where: { userId_idempotencyKey: { userId, idempotencyKey: key } },
    select: { ...bookingSelect, idempotencyRequestHash: true },
  });
  if (!row) return null;
  if (row.idempotencyRequestHash && row.idempotencyRequestHash !== requestHash) {
    throw new BookingConflictError(
      "Bu Idempotency-Key farklı bir istekle kullanılmış",
      "IDEMPOTENCY_KEY_REUSED"
    );
  }
  return toDto(row);
}

async function loadQuoteSafe(quoteId: string): Promise<Quote | null> {
  try {
    return await loadQuote(quoteId);
  } catch (error) {
    logger.warn(errorFields(error), "quote load failed");
    return null;
  }
}

function roomLockKey(roomId: string): string {
  return `booking:lock:room:${roomId}`;
}

export async function createBooking(input: CreateBookingInput): Promise<BookingResult> {
  const config = getConfig();
  const units = input.units ?? 1;
  if (!Number.isInteger(units) || units < 1 || units > 10) {
    throw new BookingValidationError("Oda adedi 1–10 olmalıdır");
  }
  // "Geçmiş tarih" kontrolü tesisin yerel bugününe göre (v3#6) → önce saat dilimi.
  const clock = await prisma.roomType
    .findUnique({
      where: { id: input.roomId },
      select: { property: { select: { timeZone: true, checkInTime: true, checkOutTime: true } } },
    })
    .then((r) => clockOf(r?.property ?? {}));
  let stay;
  try {
    stay = parseStay(input.checkIn, input.checkOut, {
      maxNights: config.MAX_STAY_NIGHTS,
      today: todayIn(clock.timeZone),
    });
  } catch (error) {
    if (error instanceof DateRangeError) throw new BookingValidationError(error.message);
    throw error;
  }
  if (!Number.isInteger(input.guestCount) || input.guestCount < 1) {
    throw new BookingValidationError("Misafir sayısı en az 1 olmalıdır");
  }

  // v4#9: anahtar, doğrulanmış gövdeye bağlanır (checkout `hashRequest` deseni).
  const requestHash = hashIdempotentRequest([
    input.propertyId,
    input.roomId,
    stay.checkIn,
    stay.checkOut,
    input.guestCount,
    units,
    input.ratePlanId,
    input.currency,
  ]);
  if (input.idempotencyKey) {
    const existing = await findByIdempotencyKey(input.userId, input.idempotencyKey, requestHash);
    if (existing) return { booking: existing, paymentRequired: existing.status === "HELD" };
  }

  let quote: Quote | null = null;
  if (input.quoteId) {
    quote = await loadQuoteSafe(input.quoteId);
    if (!quote) {
      throw new BookingConflictError(
        "Fiyat teklifinin süresi doldu, lütfen yenileyin",
        "QUOTE_EXPIRED"
      );
    }
    if (
      quote.roomId !== input.roomId ||
      quote.propertyId !== input.propertyId ||
      quote.checkIn !== stay.checkIn ||
      quote.checkOut !== stay.checkOut ||
      quote.guests !== input.guestCount ||
      (quote.units ?? 1) !== units ||
      (input.ratePlanId !== undefined && quote.ratePlan?.id !== input.ratePlanId)
    ) {
      throw new BookingValidationError("Teklif bu rezervasyon bilgileriyle eşleşmiyor");
    }
  }

  // Hızlı yol: kilit almadan önce dolu olduğu kesin olan istekleri erken reddet.
  // Yalnızca optimizasyondur; sorgu hata verirse atlanır (kilitli yol yetkili kaynaktır).
  const full = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM "InventoryDay"
      WHERE "roomTypeId" = ${input.roomId}
        AND date >= ${toDbDate(stay.checkIn)} AND date < ${toDbDate(stay.checkOut)}
        AND sold + held + ${units} > total`
    .then((r) => Number(r[0]?.n ?? 0))
    .catch(() => 0);
  if (full > 0) {
    bookingsCreated.inc({ outcome: "sold_out" });
    throw new SoldOutError();
  }

  // P0-5: teklif varsa onun sabitlediği kur tablosu → teklif süresince tahsilat tutarı değişmez.
  const fx =
    (quote ? await getFxById(quote.fxSnapshotId ?? null).catch(() => null) : null) ??
    (await getCurrentFx());

  try {
    const ratePlanId = input.ratePlanId ?? quote?.ratePlan?.id;
    const row = await redlock.withLock(
      roomLockKey(input.roomId),
      () =>
        reserveInTransaction(
          { ...input, ratePlanId, units, requestHash },
          stay.checkIn,
          stay.checkOut,
          stay.nights,
          quote,
          fx
        ),
      { ttlMs: 15_000, retryCount: 200, retryDelayMs: 25 }
    );
    bookingsCreated.inc({ outcome: "held" });
    await afterWrite(row.propertyId, row.id);
    return { booking: row, paymentRequired: true };
  } catch (error) {
    if (error instanceof LockError) {
      bookingsCreated.inc({ outcome: "busy" });
      throw new BookingConflictError(
        "Oda şu anda başka bir misafir tarafından rezerve ediliyor. Lütfen tekrar deneyin.",
        "ROOM_BUSY"
      );
    }
    // Idempotency yarışı: aynı userId+key eşzamanlı iki istekte unique ihlali (P2002)
    if (
      input.idempotencyKey &&
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const existing = await findByIdempotencyKey(input.userId, input.idempotencyKey, requestHash);
      if (existing) return { booking: existing, paymentRequired: existing.status === "HELD" };
    }
    if (error instanceof SoldOutError || error instanceof RestrictionError) {
      bookingsCreated.inc({ outcome: "sold_out" });
    }
    throw error;
  }
}

async function reserveInTransaction(
  input: CreateBookingInput & { units: number; requestHash: string },
  checkIn: IsoDate,
  checkOut: IsoDate,
  nights: IsoDate[],
  quote: Quote | null,
  fx: FxTable
): Promise<BookingDTO> {
  return withSerializableRetry((tx) =>
    reserveBookingInTx(tx, input, checkIn, checkOut, nights, quote, fx)
  );
}

/** Sepet (P1-1) gibi dış işlemden çağrılan tutmalar için ek seçenekler. */
export interface ReserveOptions {
  /** Rezervasyonun bağlandığı sepet (grup kimliği). */
  cartId?: string;
  /** Tüm sepet kalemleri için ortak tutma bitişi (verilmezse şimdi + TTL). */
  holdExpiresAt?: Date;
}

/**
 * Tek rezervasyonun kilitli fiyatlaması + HELD kaydı + koşullu sayaç (`holdUnits`) + outbox.
 * ÇAĞIRANIN SERIALIZABLE işlemi içinde çalışır ve oda tipi Redlock'unu çağıran tutar;
 * herhangi bir hata tüm işlemi (diğer sepet kalemleri dahil) geri aldırır.
 */
export async function reserveBookingInTx(
  tx: Prisma.TransactionClient,
  input: CreateBookingInput & { units: number; requestHash: string },
  checkIn: IsoDate,
  checkOut: IsoDate,
  nights: IsoDate[],
  quote: Quote | null,
  fx: FxTable,
  options: ReserveOptions = {}
): Promise<BookingDTO> {
  const config = getConfig();
  const policySelect = { select: { kind: true, version: true, rules: true } } as const;
  const room = await tx.roomType.findFirst({
    // Önceden alınmış teklif olsa bile doğrulanmamış ilan satılamaz (v3#26).
    where: { id: input.roomId, propertyId: input.propertyId, property: LISTABLE_PROPERTY },
    select: {
      id: true,
      maxOccupancy: true,
      units: true,
      available: true,
      priceModifierMinor: true,
      ratePlans: {
        select: {
          id: true,
          code: true,
          name: true,
          mealPlan: true,
          refundable: true,
          priceModifierBps: true,
          isDefault: true,
          active: true,
          cancellationPolicy: policySelect,
        },
      },
      property: {
        select: {
          currency: true,
          cancellationPolicy: policySelect,
          location: { select: { country: true } },
        },
      },
    },
  });
  if (!room) throw new BookingNotFoundError("Oda veya mülk bulunamadı");
  if (input.guestCount > room.maxOccupancy * input.units) {
    throw new BookingValidationError(`Bu oda en fazla ${room.maxOccupancy} kişiliktir`);
  }
  if (!room.available || input.units > room.units) throw new SoldOutError();
  let plan;
  try {
    plan = pickRatePlan(room.ratePlans, input.ratePlanId);
  } catch (error) {
    if (error instanceof SoldOutError) throw error;
    throw new BookingValidationError((error as Error).message);
  }
  const currency = assertCurrency(room.property.currency);

  const rows = await tx.$queryRaw<
    Array<{
      id: string;
      date: Date;
      priceMinor: bigint;
      total: number;
      sold: number;
      held: number;
    }>
  >`
    SELECT id, date, "priceMinor", total, sold, held
    FROM "InventoryDay"
    WHERE "roomTypeId" = ${room.id}
      AND date >= ${toDbDate(checkIn)}
      AND date < ${toDbDate(checkOut)}
    ORDER BY date
    FOR UPDATE
  `;
  const restrictions = await tx.restriction.findMany({
    where: { roomTypeId: room.id, date: { gte: toDbDate(checkIn), lte: toDbDate(checkOut) } },
  });
  const violation = checkRestrictions({ checkIn, checkOut, nights }, restrictions);
  if (violation) throw new RestrictionError(describeViolation(violation), violation.code);
  const nightInputs = nightsFromInventory(rows, nights, currency, input.units);
  if (!nightInputs) throw new SoldOutError();

  const priced = priceStay({
    nights: nightInputs,
    modifierMinor: minorFromDb(room.priceModifierMinor),
    planModifierBps: plan.priceModifierBps,
    units: input.units,
    currency,
    taxRules: taxRulesFor(room.property.location.country),
    guests: input.guestCount,
  });
  // İade edilemez plan → NON_REFUNDABLE; değilse planın (yoksa mülkün) politikası.
  const policy = plan.refundable
    ? toSnapshot(plan.cancellationPolicy ?? room.property.cancellationPolicy)
    : DEFAULT_POLICIES.NON_REFUNDABLE;
  if (quote && !samePrice(quote, priced)) {
    throw new BookingConflictError("Fiyat değişti, lütfen yeni fiyatı onaylayın", "PRICE_CHANGED", {
      previousTotal: quote.total,
      currentTotal: priced.total,
      currency,
    });
  }

  const chargeCurrency = resolveChargeCurrency(currency, input.currency ?? quote?.charge?.currency);
  const charge = chargeAmount(money(priced.total, currency), chargeCurrency, fx);
  if (
    quote?.charge &&
    quote.charge.currency === charge.currency &&
    quote.charge.total !== charge.total
  ) {
    throw new BookingConflictError("Fiyat değişti, lütfen yeni fiyatı onaylayın", "PRICE_CHANGED", {
      previousTotal: quote.charge.total,
      currentTotal: charge.total,
      currency: charge.currency,
    });
  }

  const status = transition("PENDING", "HOLD");
  const holdExpiresAt =
    options.holdExpiresAt ?? new Date(Date.now() + config.BOOKING_HOLD_TTL_MINUTES * 60_000);
  const booking = await tx.booking.create({
    data: {
      userId: input.userId,
      propertyId: input.propertyId,
      roomId: room.id,
      ratePlanId: plan.id,
      units: input.units,
      checkIn: toDbDate(checkIn),
      checkOut: toDbDate(checkOut),
      guestCount: input.guestCount,
      totalPriceMinor: minorToDb(charge.total),
      currency: charge.currency,
      status,
      holdExpiresAt,
      priceBreakdown: priced as unknown as Prisma.InputJsonValue,
      quoteId: quote?.quoteId ?? null,
      policySnapshot: policy as unknown as Prisma.InputJsonValue,
      fxSnapshotId: fx.id,
      fxSnapshot: fx as unknown as Prisma.InputJsonValue,
      idempotencyKey: input.idempotencyKey ?? null,
      idempotencyRequestHash: input.idempotencyKey ? input.requestHash : null,
      cartId: options.cartId ?? null,
    },
    select: bookingSelect,
  });

  // Koşullu sayaç: yer yoksa (0 satır / eksik gece) işlem geri alınır → SOLD_OUT.
  try {
    await holdUnits(tx, { roomTypeId: room.id, checkIn, checkOut, units: input.units });
  } catch (error) {
    if (error instanceof InventoryUnavailableError) throw new SoldOutError();
    throw error;
  }

  await appendOutbox(
    tx,
    makeEvent<BookingCreatedPayload>(
      EventTypes.BookingCreated,
      booking.id,
      "booking",
      {
        bookingId: booking.id,
        propertyId: input.propertyId,
        roomId: room.id,
        checkIn,
        checkOut,
        userId: input.userId,
        status: "HELD",
        guestCount: input.guestCount,
        totalMinor: priced.total,
        currency,
        holdExpiresAt: holdExpiresAt.toISOString(),
      },
      input.idempotencyKey
    )
  );

  return toDto(booking);
}

async function afterWrite(propertyId: string, bookingId: string): Promise<void> {
  await invalidatePropertySearchCache(propertyId);
  await invalidateBookingCache(bookingId);
}

/**
 * Rezervasyonun tuttuğu envanteri iade eder. `status` geçişten ÖNCEKİ durumdur:
 * HELD/PENDING → `held −= units`, CONFIRMED → `sold −= units`. Aynı işlemde yapılan koşullu
 * durum geçişi bu çağrının rezervasyon başına tek kez olmasını garanti eder.
 */
export async function releaseInventory(
  tx: Prisma.TransactionClient,
  booking: { roomId: string; checkIn: Date; checkOut: Date; units: number; status: string }
): Promise<void> {
  await releaseForStatus(tx, booking.status, {
    roomTypeId: booking.roomId,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    units: booking.units,
  });
}

export interface CancelResult {
  bookingId: string;
  status: BookingStatus;
  previousStatus: BookingStatus;
}

/**
 * İptal (durum makinesi: PENDING/HELD/CONFIRMED → CANCELLED). Envanter iade edilir.
 * Koşullu güncelleme (status + version) eşzamanlı iptal/onay yarışını güvenli kılar.
 * İade hesaplaması ödeme katmanında (`cancelBookingWithRefund`) yapılır.
 */
export async function cancelBooking(bookingId: string, userId: string): Promise<CancelResult> {
  const result = await withSerializableRetry(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        userId: true,
        status: true,
        version: true,
        roomId: true,
        propertyId: true,
        checkIn: true,
        checkOut: true,
        units: true,
      },
    });
    if (!booking || booking.userId !== userId) throw new BookingNotFoundError();

    let next: BookingState;
    try {
      next = transition(booking.status as BookingState, "CANCEL");
    } catch {
      throw new BookingConflictError("Bu rezervasyon iptal edilemez", "INVALID_STATE");
    }

    const updated = await tx.booking.updateMany({
      where: { id: booking.id, status: booking.status, version: booking.version },
      data: {
        status: next as BookingStatus,
        cancelledAt: new Date(),
        version: { increment: 1 },
        holdExpiresAt: null,
      },
    });
    if (updated.count !== 1) {
      throw new BookingConflictError("Rezervasyon eşzamanlı olarak değişti", "CONCURRENT_UPDATE");
    }
    await releaseInventory(tx, booking);

    await appendOutbox(
      tx,
      makeEvent<BookingCancelledPayload>(EventTypes.BookingCancelled, booking.id, "booking", {
        bookingId: booking.id,
        propertyId: booking.propertyId,
        roomId: booking.roomId,
        checkIn: fromDate(booking.checkIn),
        checkOut: fromDate(booking.checkOut),
        userId: booking.userId,
      })
    );
    return {
      bookingId: booking.id,
      status: next as BookingStatus,
      previousStatus: booking.status,
      propertyId: booking.propertyId,
    };
  });

  await afterWrite(result.propertyId, bookingId);
  return {
    bookingId: result.bookingId,
    status: result.status,
    previousStatus: result.previousStatus,
  };
}

/**
 * Süresi dolan tutmaları (HELD ve eski sürümden kalan PENDING) EXPIRED yapar ve
 * envanteri iade eder. `FOR UPDATE SKIP LOCKED` ile birden çok işçi güvenle çalışır.
 * @returns süresi dolan rezervasyon sayısı
 */
export async function expireHolds(now: Date = new Date(), limit = 100): Promise<number> {
  const config = getConfig();
  const legacyCutoff = new Date(now.getTime() - config.BOOKING_HOLD_TTL_MINUTES * 60_000);

  const expired = await withSerializableRetry(async (tx) => {
    const candidates = await tx.$queryRaw<
      Array<{
        id: string;
        userId: string;
        roomId: string;
        propertyId: string;
        checkIn: Date;
        checkOut: Date;
        status: BookingStatus;
        units: number;
      }>
    >`
      SELECT id, "userId", "roomId", "propertyId", "checkIn", "checkOut", status, units
      FROM "Booking"
      WHERE (status = 'HELD' AND "holdExpiresAt" <= ${now})
         OR (status = 'PENDING' AND "createdAt" <= ${legacyCutoff})
      ORDER BY "holdExpiresAt" NULLS FIRST
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    `;

    const done: typeof candidates = [];
    for (const booking of candidates) {
      const next = transition(booking.status as BookingState, "EXPIRE");
      const updated = await tx.booking.updateMany({
        where: { id: booking.id, status: booking.status },
        data: {
          status: next as BookingStatus,
          expiredAt: now,
          holdExpiresAt: null,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) continue;
      await releaseInventoryOrSkipDrift(tx, booking);
      await appendOutbox(
        tx,
        makeEvent<BookingExpiredPayload>(EventTypes.BookingExpired, booking.id, "booking", {
          bookingId: booking.id,
          propertyId: booking.propertyId,
          roomId: booking.roomId,
          checkIn: fromDate(booking.checkIn),
          checkOut: fromDate(booking.checkOut),
          userId: booking.userId,
          reason: "hold_timeout",
        })
      );
      done.push(booking);
    }
    return done;
  });

  for (const booking of expired) await afterWrite(booking.propertyId, booking.id);
  if (expired.length > 0) {
    bookingsExpired.inc(expired.length);
    logger.info({ expired: expired.length }, "expired booking holds");
  }
  return expired.length;
}

/**
 * Süre dolumu için envanter iadesi; sayaç tutarsızsa (ör. `held` hiç artırılmamış eski/seed
 * PENDING kaydı) işi DÜŞÜRMEZ. Aksi halde tek bir tutarsız kayıt tüm toplu işlemi geri
 * alır ve hiçbir tutma bir daha süresi dolmaz (kaos/yük deneyinde görüldü: 4000+ HELD
 * birikti, envanter kilitli kaldı). SAVEPOINT ile kısmi iade geri alınır; rezervasyon yine
 * EXPIRED olur (zaten tutulmayan birimi iade etmemek doğrudur) ve durum hata olarak loglanır.
 */
async function releaseInventoryOrSkipDrift(
  tx: Prisma.TransactionClient,
  booking: {
    id: string;
    roomId: string;
    checkIn: Date;
    checkOut: Date;
    units: number;
    status: string;
  }
): Promise<void> {
  await tx.$executeRawUnsafe("SAVEPOINT expire_release");
  try {
    await releaseInventory(tx, booking);
    await tx.$executeRawUnsafe("RELEASE SAVEPOINT expire_release");
  } catch (error) {
    if (!(error instanceof InventoryUnavailableError)) throw error;
    await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT expire_release");
    inventoryDriftOnExpire.inc();
    logger.error(
      { ...errorFields(error), bookingId: booking.id, status: booking.status },
      "inventory counter drift on expire; hold expired without release"
    );
  }
}

/**
 * Saga telafisi (P0-7): ödeme adımları başarısız olunca tutmayı HEMEN serbest bırakır
 * (HELD → EXPIRED + envanter iadesi + outbox). Koşullu geçiş → idempotent; rezervasyon
 * bu arada onaylandıysa/düştüyse hiçbir şey yapmaz.
 * @returns tutma bu çağrıyla serbest bırakıldıysa true
 */
export async function releaseHold(bookingId: string): Promise<boolean> {
  const released = await withSerializableRetry(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        userId: true,
        status: true,
        roomId: true,
        propertyId: true,
        checkIn: true,
        checkOut: true,
        units: true,
      },
    });
    if (!booking || booking.status !== BookingStatus.HELD) return null;
    const updated = await tx.booking.updateMany({
      where: { id: booking.id, status: BookingStatus.HELD },
      data: {
        status: transition("HELD", "EXPIRE") as BookingStatus,
        expiredAt: new Date(),
        holdExpiresAt: null,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) return null;
    await releaseInventory(tx, booking);
    await appendOutbox(
      tx,
      makeEvent<BookingExpiredPayload>(EventTypes.BookingExpired, booking.id, "booking", {
        bookingId: booking.id,
        propertyId: booking.propertyId,
        roomId: booking.roomId,
        checkIn: fromDate(booking.checkIn),
        checkOut: fromDate(booking.checkOut),
        userId: booking.userId,
        reason: "payment_failed",
      })
    );
    return booking;
  });
  if (!released) return false;
  await afterWrite(released.propertyId, bookingId);
  bookingsExpired.inc();
  return true;
}

/**
 * Rezervasyon detayı (sahibine). Değişken olmayan kısım `BOOKING_CACHE_TTL_SECONDS` kadar
 * önbelleklenir ve durum olaylarında outbox tüketicisi siler; ödeme durumu (iade/capture
 * commit sonrası değişebilir) önbelleğe ALINMAZ, her okumada taze okunur (v4#14).
 */
const bookingDetailInclude = {
  property: { include: { location: true } },
  room: true,
  payment: true,
} satisfies Prisma.BookingInclude;

export type BookingDetail = Prisma.BookingGetPayload<{ include: typeof bookingDetailInclude }>;

export async function getBooking(bookingId: string, userId: string): Promise<BookingDetail> {
  const cacheKey = bookingCacheKey(bookingId);
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      // Önbellekteki JSON'da tarih/Decimal alanları serileştirilmiş hâldedir (yanıt JSON'u ile aynı).
      const parsed = JSON.parse(cached) as BookingDetail;
      if (parsed.id === bookingId && parsed.userId === userId) {
        const payment = await prisma.payment.findUnique({ where: { bookingId } });
        return { ...parsed, payment };
      }
    }
  } catch (error) {
    logger.warn(errorFields(error), "booking cache read failed");
  }

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: bookingDetailInclude,
  });
  if (!booking) throw new BookingNotFoundError();

  // BOLA: kaynağa yalnız sahibi erişebilir; başkasına 404 (varlık sızdırılmaz).
  requireOwnership(booking.userId, userId, () => new BookingNotFoundError());

  const ttl = getConfig().BOOKING_CACHE_TTL_SECONDS;
  if (ttl > 0) {
    try {
      await redis.set(cacheKey, JSON.stringify({ ...booking, payment: null }), { ex: ttl });
    } catch (error) {
      logger.warn(errorFields(error), "booking cache write failed");
    }
  }
  return booking;
}

const bookingListInclude = {
  property: { include: { location: true } },
  room: { select: { name: true } },
} satisfies Prisma.BookingInclude;

export type UserBookingRow = Prisma.BookingGetPayload<{ include: typeof bookingListInclude }>;

export interface UserBookingsPage {
  items: UserBookingRow[];
  /** Sonraki sayfanın opak imleci; son sayfada `null`. */
  nextCursor: string | null;
}

interface CursorPosition {
  createdAt: Date;
  id: string;
}

function encodeCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(JSON.stringify([row.createdAt.toISOString(), row.id])).toString("base64url");
}

function decodeCursor(cursor: string): CursorPosition {
  try {
    const [at, id] = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown[];
    const createdAt = new Date(String(at));
    if (typeof id !== "string" || !id || id.length > 64 || Number.isNaN(createdAt.getTime())) {
      throw new Error("bad cursor");
    }
    return { createdAt, id };
  } catch {
    throw new ValidationError("Geçersiz sayfa imleci");
  }
}

/**
 * Kullanıcının rezervasyonları, en yeniden eskiye; (createdAt, id) üzerinden keyset (cursor)
 * sayfalama (v4#14). İmleç satırın konumunu taşır, kimliği değil → başka kullanıcının
 * kaydını işaret etse bile yalnızca `userId` filtresindeki satırlar döner.
 */
export async function listUserBookingsPage(
  userId: string,
  opts: { cursor?: string | null; limit?: number } = {}
): Promise<UserBookingsPage> {
  const config = getConfig();
  const limit = Math.min(
    Math.max(1, Math.trunc(opts.limit ?? config.BOOKINGS_PAGE_SIZE_DEFAULT)),
    config.BOOKINGS_PAGE_SIZE_MAX
  );
  const after = opts.cursor ? decodeCursor(opts.cursor) : null;
  const rows = await prisma.booking.findMany({
    where: {
      userId,
      ...(after
        ? {
            OR: [
              { createdAt: { lt: after.createdAt } },
              { createdAt: after.createdAt, id: { lt: after.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    include: bookingListInclude,
  });
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return { items, nextCursor: rows.length > limit && last ? encodeCursor(last) : null };
}

/** Geriye uyum: ilk sayfanın satırları (varsayılan sayfa boyutu). */
export async function listUserBookings(userId: string): Promise<UserBookingRow[]> {
  return (await listUserBookingsPage(userId)).items;
}

/**
 * API sunumu (ADR 0019): `*Minor` BigInt alanlar `number` olur ve yanlarına geriye uyumlu
 * ondalık string'ler eklenir (`totalPrice`, `payment.amount`, `property.basePrice`, …).
 */
export function presentBooking<
  T extends {
    currency: string;
    totalPriceMinor: bigint | number;
    property?: ({ currency: string } & object) | null;
    room?: object | null;
    payment?: ({ currency: string } & object) | null;
  },
>(row: T) {
  const propertyCurrency = row.property?.currency ?? row.currency;
  return {
    ...withLegacyDecimals(row),
    ...(row.property ? { property: withLegacyDecimals(row.property) } : {}),
    ...(row.room ? { room: withLegacyDecimals(row.room, propertyCurrency) } : {}),
    ...(row.payment !== undefined
      ? { payment: row.payment ? withLegacyDecimals(row.payment) : null }
      : {}),
  };
}
