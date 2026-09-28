import { Prisma, PaymentStatus } from "@prisma/client";
import { ConflictError } from "@/lib/http/errors";
import { withSerializableRetry } from "@/lib/db/transactions";
import { minorFromDb } from "@/lib/money/money";
import { holdUnits, InventoryUnavailableError } from "@/lib/booking/inventory";
import { reclaimPromotionRedemptions } from "@/lib/pricing/promotion-redemption";
import { counter } from "@/lib/observability/metrics";
import { activeCreditSpend, reserveBookingCreditInTx } from "@/lib/wallet/wallet-service";
import { LATE_SUCCESS_HOLD_MS, OPEN_STATUSES, SETTLED_STATUSES } from "./payment-core";
import { confirmInTransaction } from "./confirm";

export const latePaymentSuccessTotal = counter(
  "payment_late_success_total",
  "Onay penceresi kapandıktan sonra gelen başarılı ödeme olayları (v4#8)",
  ["outcome"] as const
);

/**
 * Geç gelen başarılı ödeme için mutabakat (v4#8). Rezervasyon süresi dolmuş (EXPIRED) ya da
 * tutma süresi geçmiş HELD ise ve envanter hâlâ uygunsa: tutma yeniden alınır, rezervasyon
 * HELD'e döner ve AYNI işlemde onaylanır (defter + outbox dahil). İptal edilmiş, başka
 * ödemeyle onaylanmış ya da envanteri dolmuş rezervasyon → `false` (çağıran iade eder).
 */
export async function reconcileLateSuccess(
  bookingId: string,
  providerRef: string,
  record: (tx: Prisma.TransactionClient) => Promise<unknown>
): Promise<boolean> {
  try {
    return await withSerializableRetry(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Booking" WHERE id = ${bookingId} FOR UPDATE`;
      const booking = await tx.booking.findUnique({
        where: { id: bookingId },
        select: {
          id: true,
          status: true,
          version: true,
          roomId: true,
          checkIn: true,
          checkOut: true,
          units: true,
          payment: { select: { status: true } },
        },
      });
      if (!booking || (booking.payment && SETTLED_STATUSES.includes(booking.payment.status))) {
        return false;
      }
      if (booking.status === "EXPIRED") {
        // Süre dolunca tutulan birimler bırakıldı → yer varsa yeniden tut (yoksa fırlatır).
        await holdUnits(tx, {
          roomTypeId: booking.roomId,
          checkIn: booking.checkIn,
          checkOut: booking.checkOut,
          units: booking.units,
        });
        // v2-P0-1: süre dolumunda iade edilen limitli promosyon kullanımı yeniden sayılır
        // (limit bu arada dolduysa 409 → işlem geri alınır, iade).
        await reclaimPromotionRedemptions(tx, booking.id);
      } else if (booking.status !== "HELD") {
        return false;
      }
      const reopened = await tx.booking.updateMany({
        where: { id: booking.id, status: booking.status, version: booking.version },
        data: {
          status: "HELD",
          expiredAt: null,
          holdExpiresAt: new Date(Date.now() + LATE_SUCCESS_HOLD_MS),
          version: { increment: 1 },
        },
      });
      if (reopened.count !== 1) {
        throw new ConflictError("Rezervasyon eşzamanlı olarak değişti", "CONCURRENT_UPDATE");
      }
      // P1-7: süre dolumunda bırakılan kredi payı yeniden rezerve edilir (yetmezse 409 → iade).
      const late = await tx.payment.findFirst({
        where: { bookingId: booking.id, providerRef },
        select: { amountMinor: true, userId: true },
      });
      const full = await tx.booking.findUniqueOrThrow({
        where: { id: booking.id },
        select: { totalPriceMinor: true, currency: true, userId: true },
      });
      const creditGap = late ? full.totalPriceMinor - late.amountMinor : 0n;
      if (creditGap > 0n && !(await activeCreditSpend(tx, booking.id))) {
        await reserveBookingCreditInTx(tx, {
          bookingId: booking.id,
          userId: full.userId,
          currency: full.currency,
          amountMinor: minorFromDb(creditGap),
        });
      }
      // Bu providerRef'in ödeme satırı (süresi dolunca açık kalmış) tahsil hakkını alır.
      await tx.payment.updateMany({
        where: { bookingId: booking.id, providerRef, status: { in: OPEN_STATUSES } },
        data: { status: PaymentStatus.AUTHORIZED, failureCode: null },
      });
      await record(tx);
      await confirmInTransaction(tx, booking.id, providerRef);
      return true;
    });
  } catch (error) {
    if (error instanceof ConflictError || error instanceof InventoryUnavailableError) return false;
    throw error;
  }
}
