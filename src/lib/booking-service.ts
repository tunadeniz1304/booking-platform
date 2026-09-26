import { Prisma, BookingStatus } from "@prisma/client";
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
import { HttpError } from "@/lib/http/errors";
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
import { money, toDecimalString, toMinor, assertCurrency } from "@/lib/money/money";
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

const BOOKING_CACHE_PREFIX = "booking:";
const BOOKING_CACHE_TTL = 60 * 10;
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
  totalPrice: true,
  currency: true,
  status: true,
  holdExpiresAt: true,
  priceBreakdown: true,
} satisfies Prisma.BookingSelect;

type BookingRow = Prisma.BookingGetPayload<{ select: typeof bookingSelect }>;

function toDto(row: BookingRow): BookingDTO {
  const currency = assertCurrency(row.currency);
  const totalMinor = toMinor(row.totalPrice.toString(), currency);
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

async function findByIdempotencyKey(userId: string, key: string): Promise<BookingDTO | null> {
  const row = await prisma.booking.findUnique({
    where: { userId_idempotencyKey: { userId, idempotencyKey: key } },
    select: bookingSelect,
  });
  return row ? toDto(row) : null;
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

  if (input.idempotencyKey) {
    const existing = await findByIdempotencyKey(input.userId, input.idempotencyKey);
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
          { ...input, ratePlanId, units },
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
      const existing = await findByIdempotencyKey(input.userId, input.idempotencyKey);
      if (existing) return { booking: existing, paymentRequired: existing.status === "HELD" };
    }
    if (error instanceof SoldOutError || error instanceof RestrictionError) {
      bookingsCreated.inc({ outcome: "sold_out" });
    }
    throw error;
  }
}

async function reserveInTransaction(
  input: CreateBookingInput & { units: number },
  checkIn: IsoDate,
  checkOut: IsoDate,
  nights: IsoDate[],
  quote: Quote | null,
  fx: FxTable
): Promise<BookingDTO> {
  const config = getConfig();
  return withSerializableRetry(async (tx) => {
    const policySelect = { select: { kind: true, version: true, rules: true } } as const;
    const room = await tx.roomType.findFirst({
      // Önceden alınmış teklif olsa bile doğrulanmamış ilan satılamaz (v3#26).
      where: { id: input.roomId, propertyId: input.propertyId, property: LISTABLE_PROPERTY },
      select: {
        id: true,
        maxOccupancy: true,
        units: true,
        available: true,
        priceModifier: true,
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
        price: Prisma.Decimal;
        total: number;
        sold: number;
        held: number;
      }>
    >`
      SELECT id, date, price, total, sold, held
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
      modifierMinor: toMinor(room.priceModifier.toString(), currency),
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
      throw new BookingConflictError(
        "Fiyat değişti, lütfen yeni fiyatı onaylayın",
        "PRICE_CHANGED",
        {
          previousTotal: quote.total,
          currentTotal: priced.total,
          currency,
        }
      );
    }

    const chargeCurrency = resolveChargeCurrency(
      currency,
      input.currency ?? quote?.charge?.currency
    );
    const charge = chargeAmount(money(priced.total, currency), chargeCurrency, fx);
    if (
      quote?.charge &&
      quote.charge.currency === charge.currency &&
      quote.charge.total !== charge.total
    ) {
      throw new BookingConflictError(
        "Fiyat değişti, lütfen yeni fiyatı onaylayın",
        "PRICE_CHANGED",
        {
          previousTotal: quote.charge.total,
          currentTotal: charge.total,
          currency: charge.currency,
        }
      );
    }

    const status = transition("PENDING", "HOLD");
    const holdExpiresAt = new Date(Date.now() + config.BOOKING_HOLD_TTL_MINUTES * 60_000);
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
        totalPrice: new Prisma.Decimal(toDecimalString(money(charge.total, charge.currency))),
        currency: charge.currency,
        status,
        holdExpiresAt,
        priceBreakdown: priced as unknown as Prisma.InputJsonValue,
        quoteId: quote?.quoteId ?? null,
        policySnapshot: policy as unknown as Prisma.InputJsonValue,
        fxSnapshotId: fx.id,
        fxSnapshot: fx as unknown as Prisma.InputJsonValue,
        idempotencyKey: input.idempotencyKey ?? null,
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
  });
}

async function afterWrite(propertyId: string, bookingId: string): Promise<void> {
  await invalidatePropertySearchCache(propertyId);
  try {
    await redis.del(`${BOOKING_CACHE_PREFIX}${bookingId}`);
  } catch (error) {
    logger.warn(errorFields(error), "booking cache delete failed");
  }
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

export async function getBooking(bookingId: string, userId: string) {
  const cacheKey = `${BOOKING_CACHE_PREFIX}${bookingId}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached) as { id: string; userId: string };
      if (parsed.id === bookingId && parsed.userId === userId) return parsed;
    }
  } catch (error) {
    logger.warn(errorFields(error), "booking cache read failed");
  }

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      property: { include: { location: true } },
      room: true,
      payment: true,
    },
  });
  if (!booking) throw new BookingNotFoundError();

  // BOLA: kaynağa yalnız sahibi erişebilir; başkasına 404 (varlık sızdırılmaz).
  requireOwnership(booking.userId, userId, () => new BookingNotFoundError());

  try {
    await redis.set(cacheKey, JSON.stringify(booking), { ex: BOOKING_CACHE_TTL });
  } catch (error) {
    logger.warn(errorFields(error), "booking cache write failed");
  }
  return booking;
}

export async function listUserBookings(userId: string) {
  return prisma.booking.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: {
      property: { include: { location: true } },
      room: { select: { name: true } },
    },
  });
}
