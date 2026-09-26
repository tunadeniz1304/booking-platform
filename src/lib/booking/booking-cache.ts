import { redis } from "@/lib/redis";
import { errorFields, logger } from "@/lib/observability/logger";

/**
 * Rezervasyon detay önbelleği (`getBooking`). Durum değişiminde iki kez silinir:
 * yazan işlem commit ettikten hemen sonra (en iyi çaba) ve outbox tüketicisi olayı
 * işlediğinde (v4#14) — ikincisi at-least-once olduğundan bayat kayıt TTL'i beklemez.
 */
export const BOOKING_CACHE_PREFIX = "booking:";

export function bookingCacheKey(bookingId: string): string {
  return `${BOOKING_CACHE_PREFIX}${bookingId}`;
}

/** Idempotent; Redis hatası çağıranı düşürmez. */
export async function invalidateBookingCache(bookingId: string): Promise<void> {
  try {
    await redis.del(bookingCacheKey(bookingId));
  } catch (error) {
    logger.warn({ bookingId, ...errorFields(error) }, "booking cache delete failed");
  }
}
