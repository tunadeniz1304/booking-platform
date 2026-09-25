import { BookingStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { transition, type BookingState } from "@/lib/booking/state-machine";
import { checkOutAt, clockOf, fromDate } from "@/lib/time/nights";
import { logger } from "@/lib/observability/logger";
import { counter } from "@/lib/observability/metrics";

const completedTotal = counter("booking_completed_total", "COMPLETED yapılan konaklamalar");

/**
 * `complete-stays` (v3#18): tesisin YEREL çıkış saati geçmiş CONFIRMED rezervasyonları
 * COMPLETED yapar. Yorum yazma hakkı COMPLETED'a bağlıdır (P1-7).
 *
 * Aday seçimi kaba bir UTC ön filtresiyle (çıkış günü ≤ bugün + 1) yapılır; kesin karar her
 * rezervasyon için tesisin saat diliminde `checkOutAt` ile verilir (Tokyo 11:00 ≠ New York
 * 11:00). Geçiş `status + version` koşulludur → birden çok işçi güvenle çalışır; idempotent.
 * Envanter değişmez (satılan gece zaten geçmişte kaldı).
 */
export async function completeStays(now: Date = new Date(), limit = 500): Promise<number> {
  const horizon = new Date(now.getTime() + 36 * 3_600_000);
  const candidates = await prisma.booking.findMany({
    where: { status: BookingStatus.CONFIRMED, checkOut: { lte: horizon } },
    select: {
      id: true,
      version: true,
      checkOut: true,
      property: { select: { timeZone: true, checkInTime: true, checkOutTime: true } },
    },
    orderBy: { checkOut: "asc" },
    take: limit,
  });
  let completed = 0;
  for (const b of candidates) {
    if (checkOutAt(fromDate(b.checkOut), clockOf(b.property)).getTime() > now.getTime()) continue;
    const next = transition(BookingStatus.CONFIRMED as BookingState, "COMPLETE");
    const res = await prisma.booking.updateMany({
      where: { id: b.id, status: BookingStatus.CONFIRMED, version: b.version },
      data: { status: next as BookingStatus, version: { increment: 1 } },
    });
    completed += res.count;
  }
  if (completed > 0) {
    completedTotal.inc(completed);
    logger.info({ completed }, "stays completed");
  }
  return completed;
}
