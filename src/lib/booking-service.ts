import { Prisma, BookingStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { invalidatePropertySearchCache } from "@/lib/search";
import { createRedlock, LockError } from "@/lib/distributed-lock/redlock";
import { appendOutbox } from "@/lib/cqrs";
import {
  EventTypes,
  BookingCreatedPayload,
  BookingCancelledPayload,
  makeEvent,
} from "@/lib/events/events";
import { requireOwnership } from "@/lib/security/ownership";
import { HttpError } from "@/lib/http/errors";

const BOOKING_CACHE_PREFIX = "booking:";
const BOOKING_CACHE_TTL = 60 * 10; // 10 dakika

/** Uygulama-çapı Redlock örneği (kilit yenileme + fencing token desteği). */
const redlock = createRedlock(redis);

/** Rezervasyon çakışması (oda başka biri tarafından kilitli/dolu, geçersiz durum) → 409 */
export class BookingConflictError extends HttpError {
  constructor(message: string, code = "BOOKING_CONFLICT") {
    super(409, code, message);
    this.name = "BookingConflictError";
  }
}

/** Doğrulama hatası (tarih aralığı, kapasite, uygunluk) → 400 */
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
  currency?: string;
  /** Idempotency anahtarı (aynı anahtar + kullanıcı → aynı rezervasyon döner) */
  idempotencyKey?: string;
}

export interface BookingResult {
  booking: {
    id: string;
    propertyId: string;
    roomId: string;
    checkIn: Date;
    checkOut: Date;
    guestCount: number;
    totalPrice: number;
    currency: string;
    status: BookingStatus;
  };
  paymentRequired: boolean;
}

function parseDate(dateStr: string): Date {
  // YYYY-MM-DD → UTC gece yarısı. Prisma @db.Date sütunları tarihi UTC karşılığına
  // göre saklar; tutarlılık için tüm tarih işlemleri UTC ekseninde yapılır.
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!match) {
    throw new BookingValidationError("Geçersiz tarih formatı");
  }
  const [, year, month, day] = match;
  const date = new Date(`${year}-${month}-${day}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new BookingValidationError("Geçersiz tarih formatı");
  }
  return date;
}

function validateDateRange(checkIn: Date, checkOut: Date): void {
  if (checkIn >= checkOut) {
    throw new BookingValidationError("checkOut değeri checkIn'den sonra olmalıdır");
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  if (checkIn < today) {
    throw new BookingValidationError("checkIn geçmişte olamaz");
  }

  const maxStayDays = 30;
  const stayDays = Math.round((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24));
  if (stayDays > maxStayDays) {
    throw new BookingValidationError(`Konaklama ${maxStayDays} günü aşamaz`);
  }
}

function getDatesBetween(checkIn: Date, checkOut: Date): Date[] {
  const dates: Date[] = [];
  const current = new Date(checkIn);
  current.setUTCHours(0, 0, 0, 0);

  while (current < checkOut) {
    dates.push(new Date(current));
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return dates;
}

export async function createBooking(input: CreateBookingInput): Promise<BookingResult> {
  const checkIn = parseDate(input.checkIn);
  const checkOut = parseDate(input.checkOut);
  validateDateRange(checkIn, checkOut);

  const dates = getDatesBetween(checkIn, checkOut);
  if (dates.length === 0) {
    throw new BookingValidationError("Geçersiz tarih aralığı");
  }

  // Idempotency: aynı kullanıcı + anahtar → önceden oluşturulmuş rezervasyon döndür
  if (input.idempotencyKey) {
    const existing = await prisma.booking.findUnique({
      where: {
        userId_idempotencyKey: {
          userId: input.userId,
          idempotencyKey: input.idempotencyKey,
        },
      },
      select: {
        id: true,
        propertyId: true,
        roomId: true,
        checkIn: true,
        checkOut: true,
        guestCount: true,
        totalPrice: true,
        currency: true,
        status: true,
      },
    });
    if (existing) {
      return {
        booking: { ...existing, totalPrice: Number(existing.totalPrice) },
        paymentRequired: true,
      };
    }
  }

  const lockResource = `booking:lock:${input.roomId}:${checkIn.toISOString().slice(0, 10)}:${checkOut
    .toISOString()
    .slice(0, 10)}`;

  try {
    const result = await redlock.withLock(
      lockResource,
      async () => {
        const result = await prisma.$transaction(
          async (tx) => {
            const property = await tx.property.findFirst({
              where: {
                id: input.propertyId,
                isActive: true,
              },
              select: {
                id: true,
                currency: true,
              },
            });

            if (!property) {
              throw new BookingNotFoundError("Property bulunamadı veya aktif değil");
            }

            const room = await tx.room.findFirst({
              where: {
                id: input.roomId,
                propertyId: input.propertyId,
                available: true,
                capacity: { gte: input.guestCount },
              },
              select: {
                id: true,
                priceModifier: true,
              },
            });

            if (!room) {
              throw new BookingValidationError("Oda bulunamadı, uygun değil veya kapasite aşıldı");
            }

            const availabilityRows = await tx.$queryRaw<
              Array<{ id: string; price: Prisma.Decimal }>
            >`
              SELECT id, price
              FROM "Availability"
              WHERE "roomId" = ${room.id}
                AND date >= ${checkIn}
                AND date < ${checkOut}
                AND "isAvailable" = true
              ORDER BY date
              FOR UPDATE
            `;

            if (availabilityRows.length !== dates.length) {
              throw new BookingConflictError("Oda seçilen tarihler için uygun değil");
            }

            const totalPrice =
              availabilityRows.reduce((sum, row) => sum + Number(row.price), 0) +
              Number(room.priceModifier) * dates.length;

            const booking = await tx.booking.create({
              data: {
                userId: input.userId,
                propertyId: input.propertyId,
                roomId: room.id,
                checkIn,
                checkOut,
                guestCount: input.guestCount,
                totalPrice: new Prisma.Decimal(totalPrice.toFixed(2)),
                currency: input.currency || property.currency,
                status: BookingStatus.PENDING,
                idempotencyKey: input.idempotencyKey ?? null,
              },
              select: {
                id: true,
                propertyId: true,
                roomId: true,
                checkIn: true,
                checkOut: true,
                guestCount: true,
                totalPrice: true,
                currency: true,
                status: true,
              },
            });

            await tx.availability.updateMany({
              where: {
                id: { in: availabilityRows.map((row) => row.id) },
              },
              data: {
                isAvailable: false,
                lockedBy: booking.id,
              },
            });

            // Transactional Outbox: booking.created olayı iş ile atomik
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
                  checkIn: checkIn.toISOString().slice(0, 10),
                  checkOut: checkOut.toISOString().slice(0, 10),
                  guestCount: input.guestCount,
                  totalPrice: Number(totalPrice.toFixed(2)),
                  currency: input.currency || property.currency,
                  userId: input.userId,
                },
                input.idempotencyKey
              )
            );

            return {
              booking,
              paymentRequired: true,
            };
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            maxWait: 5000,
            timeout: 10000,
          }
        );
        return result;
      },
      { ttlMs: 30000 }
    );

    await invalidatePropertySearchCache(input.propertyId);

    const normalizedBooking = {
      ...result.booking,
      totalPrice: Number(result.booking.totalPrice),
    };

    try {
      await redis.set(
        `${BOOKING_CACHE_PREFIX}${result.booking.id}`,
        JSON.stringify(normalizedBooking),
        { ex: BOOKING_CACHE_TTL }
      );
    } catch (error) {
      console.error("Booking cache write failed:", error);
    }

    return { booking: normalizedBooking, paymentRequired: result.paymentRequired };
  } catch (error) {
    if (error instanceof LockError) {
      throw new BookingConflictError(
        "Oda şu anda başka bir misafir tarafından rezerve ediliyor. Lütfen tekrar deneyin."
      );
    }
    // Idempotency yarışı: aynı userId+key eşzamanlı iki istekte unique ihlali (P2002)
    // → diğer isteğin oluşturduğu rezervasyonu döndür
    if (
      input.idempotencyKey &&
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const existing = await prisma.booking.findUnique({
        where: {
          userId_idempotencyKey: {
            userId: input.userId,
            idempotencyKey: input.idempotencyKey,
          },
        },
        select: {
          id: true,
          propertyId: true,
          roomId: true,
          checkIn: true,
          checkOut: true,
          guestCount: true,
          totalPrice: true,
          currency: true,
          status: true,
        },
      });
      if (existing) {
        return {
          booking: { ...existing, totalPrice: Number(existing.totalPrice) },
          paymentRequired: true,
        };
      }
    }
    throw error;
  }
}

export async function cancelBooking(bookingId: string, userId: string): Promise<void> {
  const result = await prisma.$transaction(
    async (tx) => {
      const booking = await tx.booking.findFirst({
        where: {
          id: bookingId,
          userId,
          status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
        },
        select: {
          id: true,
          roomId: true,
          checkIn: true,
          checkOut: true,
          propertyId: true,
        },
      });

      if (!booking) {
        throw new BookingConflictError(
          "Rezervasyon bulunamadı, iptal edilemez veya size ait değil"
        );
      }

      await tx.booking.update({
        where: { id: bookingId },
        data: { status: BookingStatus.CANCELLED },
      });

      await tx.availability.updateMany({
        where: {
          roomId: booking.roomId,
          date: {
            gte: booking.checkIn,
            lt: booking.checkOut,
          },
          lockedBy: bookingId,
        },
        data: {
          isAvailable: true,
          lockedBy: null,
        },
      });

      // Transactional Outbox: iptal olayı stok serbest bırakma ile atomik
      await appendOutbox(
        tx,
        makeEvent<BookingCancelledPayload>(EventTypes.BookingCancelled, bookingId, "booking", {
          bookingId,
          propertyId: booking.propertyId,
          roomId: booking.roomId,
          checkIn: booking.checkIn.toISOString().slice(0, 10),
          checkOut: booking.checkOut.toISOString().slice(0, 10),
        })
      );

      return booking.propertyId;
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 5000,
      timeout: 10000,
    }
  );

  await invalidatePropertySearchCache(result);

  try {
    await redis.del(`${BOOKING_CACHE_PREFIX}${bookingId}`);
  } catch (error) {
    console.error("Booking cache delete failed:", error);
  }
}

export async function getBooking(bookingId: string, userId: string) {
  const cacheKey = `${BOOKING_CACHE_PREFIX}${bookingId}`;

  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached) as { id: string; userId: string };
      if (parsed.id === bookingId && parsed.userId === userId) {
        return parsed;
      }
    }
  } catch (error) {
    console.error("Booking cache read failed:", error);
  }

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      property: {
        include: {
          location: true,
        },
      },
      room: true,
      payment: true,
    },
  });

  if (!booking) {
    throw new BookingNotFoundError("Rezervasyon bulunamadı");
  }

  // BOLA: kaynağa yalnız sahibi erişebilir (IDOR koruması)
  requireOwnership(booking.userId, userId, () => new BookingNotFoundError());

  try {
    await redis.set(cacheKey, JSON.stringify(booking), { ex: BOOKING_CACHE_TTL });
  } catch (error) {
    console.error("Booking cache write failed:", error);
  }

  return booking;
}

export async function listUserBookings(userId: string) {
  return prisma.booking.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: {
      property: {
        include: {
          location: true,
        },
      },
      room: {
        select: {
          name: true,
        },
      },
    },
  });
}
