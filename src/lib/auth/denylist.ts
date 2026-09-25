import { redis } from "@/lib/redis";
import { logger, errorFields } from "@/lib/observability/logger";

const DENY_PREFIX = "auth:deny:";

/** Erişim token'ını kalan ömrü boyunca iptal listesine ekler (logout). */
export async function denyAccessToken(jti: string, expUnixSeconds: number): Promise<void> {
  const ttl = Math.max(1, expUnixSeconds - Math.floor(Date.now() / 1000));
  await redis.set(`${DENY_PREFIX}${jti}`, "1", { ex: ttl });
}

/**
 * Token iptal edilmiş mi? Redis erişilemezse `true` (fail-CLOSED, v3#14): çıkış veya
 * rol değişiminden hemen sonraki kısa pencerede iptal edilmiş bir token'ın kabul
 * edilmemesi, geçici bir oturum kesintisinden daha önemlidir. Erişim token'ı ömrü
 * (5 dk) bu pencereyi sınırlar; durum loglanır.
 */
export async function isAccessTokenDenied(jti: string): Promise<boolean> {
  try {
    return (await redis.exists(`${DENY_PREFIX}${jti}`)) === 1;
  } catch (error) {
    logger.warn(errorFields(error), "denylist check failed (fail-closed)");
    return true;
  }
}
