import { redis } from "@/lib/redis";
import { logger, errorFields } from "@/lib/observability/logger";

const DENY_PREFIX = "auth:deny:";

/** Erişim token'ını kalan ömrü boyunca iptal listesine ekler (logout). */
export async function denyAccessToken(jti: string, expUnixSeconds: number): Promise<void> {
  const ttl = Math.max(1, expUnixSeconds - Math.floor(Date.now() / 1000));
  await redis.set(`${DENY_PREFIX}${jti}`, "1", { ex: ttl });
}

/**
 * Token iptal edilmiş mi? Redis erişilemezse `false` (fail-open) — erişim
 * token'ları zaten kısa ömürlüdür; durum loglanır.
 */
export async function isAccessTokenDenied(jti: string): Promise<boolean> {
  try {
    return (await redis.exists(`${DENY_PREFIX}${jti}`)) === 1;
  } catch (error) {
    logger.warn(errorFields(error), "denylist check failed (fail-open)");
    return false;
  }
}
