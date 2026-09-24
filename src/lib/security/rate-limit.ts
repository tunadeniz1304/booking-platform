import type { RedisClient } from "@/lib/redis";
import type { AppConfig } from "@/lib/config/app-config";

/**
 * Sabit pencereli rate-limit (Redis `INCR` + `EXPIRE`, tek Lua çağrısı).
 *
 * Anahtar YALNIZCA doğrulanmış kimlikten türetilir: geçerli JWT `sub` veya
 * güvenilir proxy zincirinden çözülen IP. İstemcinin gönderdiği `x-user-id`
 * gibi başlıklar asla anahtara girmez (atlatma önlenir).
 *
 * Redis hatasında hassas kategoriler (auth, booking, payment) fail-CLOSED,
 * diğerleri fail-open davranır.
 */

export type RateLimitCategory = "auth" | "booking" | "payment" | "search" | "ai" | "default";

const SENSITIVE: ReadonlySet<RateLimitCategory> = new Set(["auth", "booking", "payment"]);

export function categorize(pathname: string): RateLimitCategory {
  if (pathname.startsWith("/api/auth")) return "auth";
  if (pathname.startsWith("/api/bookings") || pathname.startsWith("/api/transfers")) {
    return "booking";
  }
  if (pathname.startsWith("/api/payments")) return "payment";
  if (pathname.startsWith("/api/ai") || pathname.startsWith("/api/search/smart")) return "ai";
  if (
    pathname.startsWith("/api/search") ||
    pathname.startsWith("/api/properties") ||
    pathname.startsWith("/api/locations") ||
    pathname.startsWith("/api/quote")
  ) {
    return "search";
  }
  return "default";
}

export function isSensitiveCategory(category: RateLimitCategory): boolean {
  return SENSITIVE.has(category);
}

export function limitFor(category: RateLimitCategory, config: AppConfig): number {
  switch (category) {
    case "auth":
      return config.RATE_LIMIT_AUTH_MAX;
    case "booking":
    case "payment":
      return config.RATE_LIMIT_BOOKING_MAX;
    case "search":
      return config.RATE_LIMIT_SEARCH_MAX;
    case "ai":
      return config.RATE_LIMIT_AI_MAX;
    default:
      return config.RATE_LIMIT_DEFAULT_MAX;
  }
}

export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number;
  /** Redis erişilemediği için karar verilemedi (fail-closed → 503). */
  unavailable?: boolean;
}

export async function checkRateLimit(
  redis: Pick<RedisClient, "incrWithTtl">,
  input: { category: RateLimitCategory; identity: string; config: AppConfig; now?: number }
): Promise<RateLimitDecision> {
  const { category, identity, config } = input;
  const limit = limitFor(category, config);
  const window = config.RATE_LIMIT_WINDOW_SECONDS;
  const nowSeconds = Math.floor((input.now ?? Date.now()) / 1000);
  const bucket = Math.floor(nowSeconds / window);
  const key = `rl:${category}:${identity}:${bucket}`;
  try {
    const count = await redis.incrWithTtl(key, window);
    return {
      allowed: count <= limit,
      limit,
      remaining: Math.max(0, limit - count),
      resetSeconds: window - (nowSeconds % window),
    };
  } catch {
    const failClosed = isSensitiveCategory(category);
    return {
      allowed: !failClosed,
      limit,
      remaining: failClosed ? 0 : limit,
      resetSeconds: window,
      ...(failClosed ? { unavailable: true } : {}),
    };
  }
}
