import { Prisma } from "@prisma/client";

/**
 * v5 P0-6 (chaos bulgusu): Postgres ya da Redis'e o an ulaşılamaması sunucu hatası değil,
 * geçici bağımlılık kesintisidir → route yanıtı 503 + Retry-After (500 değil).
 *
 * - Prisma: başlatma hatası (veritabanına ulaşılamıyor), P1001 (ulaşılamıyor), P1002 (zaman
 *   aşımı), P1008 (işlem zaman aşımı), P1017 (sunucu bağlantıyı kapattı), P2024 (havuzdan
 *   bağlantı alınamadı) ve kodsuz "Server has closed the connection".
 * - Redis: `RedisUnavailableError` (bağlantı hazır değil) ve ioredis'in uçuştaki komut için
 *   bağlantı koptuğunda fırlattığı `MaxRetriesPerRequestError` / "Connection is closed.".
 *
 * Adla eşleşir (ioredis hata sınıflarını ve `@/lib/redis`'i içe aktarmadan).
 */
const PRISMA_UNAVAILABLE_CODES = new Set(["P1001", "P1002", "P1008", "P1017", "P2024"]);
const REDIS_UNAVAILABLE_NAMES = new Set(["RedisUnavailableError", "MaxRetriesPerRequestError"]);

export function isDependencyUnavailable(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientInitializationError) return true;
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return PRISMA_UNAVAILABLE_CODES.has(error.code);
  }
  if (error instanceof Prisma.PrismaClientUnknownRequestError) {
    return /Server has closed the connection|Can't reach database server/i.test(error.message);
  }
  if (error instanceof Error) {
    if (REDIS_UNAVAILABLE_NAMES.has(error.name)) return true;
    return error.message === "Connection is closed.";
  }
  return false;
}
