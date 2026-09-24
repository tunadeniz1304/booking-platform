import { Prisma, PaymentStatus, BookingStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { HttpError } from "@/lib/http/errors";

/**
 * Ödeme servisi — oda rezervasyonunu onaylayan (CONFIRMED) ödeme akışı.
 *
 * Idempotent: aynı booking için ikinci kez çağrılırsa mevcut ödemeyi döndürür.
 * BOLA: ödeme yalnızca rezervasyon sahibi (requesterId == booking.userId) tarafından
 * tetiklenebilir.
 */

const PAYMENT_CACHE_PREFIX = "payment:";
const PAYMENT_CACHE_TTL = 60 * 30;

export class PaymentValidationError extends HttpError {
  constructor(message: string, status = 400) {
    super(status, "PAYMENT_INVALID", message);
    this.name = "PaymentValidationError";
  }
}

export interface ChargedPayment {
  id: string;
  bookingId: string;
  status: PaymentStatus;
  amount: number;
  currency: string;
  provider: string;
  paidAt: Date | null;
}

export interface ChargeInput {
  bookingId: string;
  amount: number;
  requesterId: string;
  /** Ödeme sağlayıcısı adı; varsayılan dahili "mock-provider". */
  provider?: string;
}

export async function chargeBooking(input: ChargeInput): Promise<ChargedPayment> {
  // Not (hata #1): önbellek okuması YOK — sahiplik kontrolü her zaman ilk adımdır.
  const cacheKey = `${PAYMENT_CACHE_PREFIX}${input.bookingId}`;

  const payment = await prisma.$transaction(
    async (tx) => {
      const booking = await tx.booking.findUnique({
        where: { id: input.bookingId },
        select: {
          id: true,
          userId: true,
          totalPrice: true,
          currency: true,
          status: true,
          payment: { select: { id: true, status: true } },
        },
      });

      // Sahiplik: başkasının rezervasyonu "bulunamadı" olarak görünür (IDOR).
      if (!booking || booking.userId !== input.requesterId) {
        throw new PaymentValidationError("Rezervasyon bulunamadı", 404);
      }
      if (booking.status === BookingStatus.CANCELLED) {
        throw new PaymentValidationError("İptal edilmiş rezervasyon için ödeme yapılamaz");
      }

      // Idempotent: ödeme daha önce tamamlanmışsa mevcut kaydı döndür
      if (booking.payment && booking.payment.status === PaymentStatus.PAID) {
        return tx.payment.findUnique({
          where: { bookingId: booking.id },
          select: {
            id: true,
            bookingId: true,
            status: true,
            amount: true,
            currency: true,
            provider: true,
            paidAt: true,
          },
        });
      }

      const expectedAmount = Number(booking.totalPrice);
      if (Math.abs(expectedAmount - input.amount) > 0.01) {
        throw new PaymentValidationError(`Tutar eşleşmiyor: beklenen ${expectedAmount.toFixed(2)}`);
      }

      const created = await tx.payment.create({
        data: {
          bookingId: booking.id,
          userId: booking.userId,
          amount: new Prisma.Decimal(input.amount.toFixed(2)),
          currency: booking.currency,
          provider: input.provider ?? "internal-grpc",
          status: PaymentStatus.PAID,
          paidAt: new Date(),
        },
        select: {
          id: true,
          bookingId: true,
          status: true,
          amount: true,
          currency: true,
          provider: true,
          paidAt: true,
        },
      });

      await tx.booking.update({
        where: { id: booking.id },
        data: { status: BookingStatus.CONFIRMED },
      });

      return created;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );

  if (!payment) {
    throw new PaymentValidationError("Ödeme kaydı oluşturulamadı");
  }

  const normalized: ChargedPayment = {
    ...payment,
    amount: Number(payment.amount),
  };

  try {
    await redis.set(cacheKey, JSON.stringify(normalized), { ex: PAYMENT_CACHE_TTL });
  } catch {
    // cache yazım arızası zararsız
  }

  return normalized;
}
