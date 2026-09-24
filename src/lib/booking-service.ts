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
import { toSnapshot } from "@/lib/booking/cancellation";
import { money, toDecimalString, toMinor, assertCurrency } from "@/lib/money/money";
import { DateRangeError, fromDate, parseStay, toDbDate, type IsoDate } from "@/lib/time/nights";
import {
  loadQuote,
  nightsFromRows,
  priceStay,
  samePrice,
  SoldOutError,
  type PricedStay,
  type Quote,
} from "@/lib/pricing/quote";
import { logger, errorFields } from "@/lib/observability/logger";
import { counter } from "@/lib/observability/metrics";

/**
 * Rezervasyon çekirdeği — çift rezervasyon kanıtlanabilir biçimde imkânsızdır:
 *
 *  1. Redlock (oda düzeyi, fencing token) — aynı odaya eşzamanlı yazanları sıralar.
 *  2. SERIALIZABLE işlem + `SELECT … FOR UPDATE` — gecelik envanter satırları kilitlenir;
 *     Redis kilidi kaybedilse bile veritabanı tek doğruluk kaynağıdır.
 *  3. Idempotency anahtarı — (userId, key) benzersiz; tekrar eden istek aynı sonucu alır.
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
  /** Idempotency anahtarı (aynı anahtar + kullanıcı → aynı rezervasyon döner). */
  idempotencyKey?: string;
  /** Checkout'ta gösterilen teklif; verilirse fiyat birebir eşleşmelidir. */
  quoteId?: string;
}

export interface BookingDTO {
  id: string;
  propertyId: string;
  roomId: string;
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
  let stay;
  try {
    stay = parseStay(input.checkIn, input.checkOut, { maxNights: config.MAX_STAY_NIGHTS });
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
      quote.guests !== input.guestCount
    ) {
      throw new BookingValidationError("Teklif bu rezervasyon bilgileriyle eşleşmiyor");
    }
  }

  // Hızlı yol: kilit almadan önce dolu olduğu kesin olan istekleri erken reddet.
  const occupied = await prisma.availability.count({
    where: {
      roomId: input.roomId,
      date: { gte: toDbDate(stay.checkIn), lt: toDbDate(stay.checkOut) },
      isAvailable: false,
    },
  });
  if (occupied > 0) {
    bookingsCreated.inc({ outcome: "sold_out" });
    throw new SoldOutError();
  }

  try {
    const row = await redlock.withLock(
      roomLockKey(input.roomId),
      () => reserveInTransaction(input, stay.checkIn, stay.checkOut, stay.nights, quote),
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
    if (error instanceof SoldOutError) bookingsCreated.inc({ outcome: "sold_out" });
    throw error;
  }
}

async function reserveInTransaction(
  input: CreateBookingInput,
  checkIn: IsoDate,
  checkOut: IsoDate,
  nights: IsoDate[],
  quote: Quote | null
): Promise<BookingDTO> {
  const config = getConfig();
  return withSerializableRetry(async (tx) => {
    const room = await tx.room.findFirst({
      where: { id: input.roomId, propertyId: input.propertyId, property: { isActive: true } },
      select: {
        id: true,
        capacity: true,
        available: true,
        priceModifier: true,
        property: {
          select: {
            currency: true,
            cancellationPolicy: { select: { kind: true, version: true, rules: true } },
          },
        },
      },
    });
    if (!room) throw new BookingNotFoundError("Oda veya mülk bulunamadı");
    if (input.guestCount > room.capacity) {
      throw new BookingValidationError(`Bu oda en fazla ${room.capacity} kişiliktir`);
    }
    if (!room.available) throw new SoldOutError();
    const currency = assertCurrency(room.property.currency);

    const rows = await tx.$queryRaw<
      Array<{ id: string; date: Date; price: Prisma.Decimal; isAvailable: boolean }>
    >`
      SELECT id, date, price, "isAvailable"
      FROM "Availability"
      WHERE "roomId" = ${room.id}
        AND date >= ${toDbDate(checkIn)}
        AND date < ${toDbDate(checkOut)}
      ORDER BY date
      FOR UPDATE
    `;
    const nightInputs = nightsFromRows(rows, nights, currency);
    if (!nightInputs) throw new SoldOutError();

    const priced = priceStay({
      nights: nightInputs,
      modifierMinor: toMinor(room.priceModifier.toString(), currency),
      currency,
      taxRate: config.ACCOMMODATION_TAX_RATE,
    });
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

    const status = transition("PENDING", "HOLD");
    const holdExpiresAt = new Date(Date.now() + config.BOOKING_HOLD_TTL_MINUTES * 60_000);
    const booking = await tx.booking.create({
      data: {
        userId: input.userId,
        propertyId: input.propertyId,
        roomId: room.id,
        checkIn: toDbDate(checkIn),
        checkOut: toDbDate(checkOut),
        guestCount: input.guestCount,
        totalPrice: new Prisma.Decimal(toDecimalString(money(priced.total, currency))),
        currency,
        status,
        holdExpiresAt,
        priceBreakdown: priced as unknown as Prisma.InputJsonValue,
        quoteId: quote?.quoteId ?? null,
        policySnapshot: toSnapshot(
          room.property.cancellationPolicy
        ) as unknown as Prisma.InputJsonValue,
        idempotencyKey: input.idempotencyKey ?? null,
      },
      select: bookingSelect,
    });

    await tx.availability.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: { isAvailable: false, lockedBy: booking.id },
    });

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

/** Rezervasyonun tuttuğu gece envanterini serbest bırakır (yalnızca bu booking'in kilitleri). */
export async function releaseInventory(
  tx: Prisma.TransactionClient,
  booking: { id: string; roomId: string; checkIn: Date; checkOut: Date }
): Promise<number> {
  const res = await tx.availability.updateMany({
    where: {
      roomId: booking.roomId,
      date: { gte: booking.checkIn, lt: booking.checkOut },
      lockedBy: booking.id,
    },
    data: { isAvailable: true, lockedBy: null },
  });
  return res.count;
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
      }>
    >`
      SELECT id, "userId", "roomId", "propertyId", "checkIn", "checkOut", status
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
