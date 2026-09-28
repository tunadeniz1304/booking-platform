import type { RedisClient } from "@/lib/redis";
import type { AppConfig } from "@/lib/config/app-config";
import { isDemoMode } from "@/lib/config/demo";

/**
 * Sabit pencereli rate-limit (Redis `INCR` + `EXPIRE`, tek Lua çağrısı).
 *
 * Anahtar YALNIZCA doğrulanmış kimlikten türetilir: geçerli JWT `sub` veya
 * güvenilir proxy zincirinden çözülen IP. İstemcinin gönderdiği `x-user-id`
 * gibi başlıklar asla anahtara girmez (atlatma önlenir).
 *
 * Redis hatasında hassas kategoriler (auth, booking, payment, agentic, ai) fail-CLOSED,
 * diğerleri fail-open davranır. `ai` ölçülmeyen LLM harcamasına kapı açmamak için
 * kapalı kalır (v4#4).
 */

export type RateLimitCategory =
  "auth" | "booking" | "payment" | "search" | "ai" | "agentic" | "default";

const SENSITIVE: ReadonlySet<RateLimitCategory> = new Set([
  "auth",
  "booking",
  "payment",
  "agentic",
  "ai",
]);

/**
 * LLM çağıran uçlar — §3 v3-b, v5#12. Liste `tests/unit/security/v5-rate-limit-category.test.ts`
 * içinde LLM istemcisini çağıran modüllere ulaşan route'lardan statik olarak doğrulanır;
 * ön ek kovalarından (booking/search) ÖNCE değerlendirilir (ör. mesaj taslağı).
 */
const AI_PREFIXES = ["/api/ai", "/api/search/smart"] as const;
const AI_EXACT: ReadonlySet<string> = new Set([
  "/api/compare",
  "/api/admin/events",
  "/api/admin/reviews",
  "/api/host/revenue/suggestions",
  "/api/support/chat",
]);
const AI_PATTERNS: readonly RegExp[] = [
  /^\/api\/properties\/[^/]+\/reviews\/summary$/,
  /^\/api\/properties\/[^/]+\/review-highlights$/,
  /^\/api\/bookings\/[^/]+\/messages\/draft$/,
];

function isAiPath(pathname: string): boolean {
  return (
    AI_PREFIXES.some((p) => pathname.startsWith(p)) ||
    AI_EXACT.has(pathname) ||
    AI_PATTERNS.some((re) => re.test(pathname))
  );
}

export function categorize(pathname: string): RateLimitCategory {
  if (pathname.startsWith("/api/auth")) return "auth";
  // Tüm AI uçları `ai` kategorisinde (maliyetli; Redis yoksa fail-closed).
  if (isAiPath(pathname)) return "ai";
  if (
    pathname.startsWith("/api/bookings") ||
    pathname.startsWith("/api/transfers") ||
    pathname.startsWith("/api/cart") ||
    pathname.startsWith("/api/coupons")
  ) {
    return "booking";
  }
  // P1-2 bölünmüş ödeme payları (katılımcı ödeme sayfası) ödeme kovasında.
  if (pathname.startsWith("/api/payments") || pathname.startsWith("/api/pay/share")) {
    return "payment";
  }
  // Ajan uçları (P1-11, v5#12): MCP HTTP + ACP + UCP checkout — ayrı kova, rezervasyon/ödeme yapabilir.
  if (
    pathname.startsWith("/api/mcp") ||
    pathname.startsWith("/api/agentic") ||
    pathname.startsWith("/api/ucp")
  ) {
    return "agentic";
  }
  if (
    pathname.startsWith("/api/search") ||
    pathname.startsWith("/api/properties") ||
    pathname.startsWith("/api/locations") ||
    pathname.startsWith("/api/quote") ||
    // v5#7: herkese açık ucuz okumalar (görsel, fiyat içgörüsü).
    pathname.startsWith("/api/photos/") ||
    pathname.startsWith("/api/price-insight")
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
    case "agentic":
      return config.RATE_LIMIT_AGENTIC_MAX;
    default:
      return config.RATE_LIMIT_DEFAULT_MAX;
  }
}

/**
 * Demo/E2E gevşetme çarpanı: yalnızca demo modunda `RATE_LIMIT_DEMO_RELAX_MULTIPLIER`,
 * aksi halde (üretim) her zaman 1 — üretim limitleri env ile yanlışlıkla gevşetilemez.
 */
export function rateLimitRelaxFactor(
  config: Pick<AppConfig, "RATE_LIMIT_DEMO_RELAX_MULTIPLIER">,
  env: Record<string, string | undefined> = process.env
): number {
  return isDemoMode(env) ? Math.max(1, config.RATE_LIMIT_DEMO_RELAX_MULTIPLIER) : 1;
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
  input: {
    category: RateLimitCategory;
    identity: string;
    config: AppConfig;
    now?: number;
    /** Paylaşılan anonim kova gibi çok istemcili kimlikler için limit çarpanı. */
    limitMultiplier?: number;
  }
): Promise<RateLimitDecision> {
  const { category, identity, config } = input;
  const limit =
    limitFor(category, config) *
    Math.max(1, input.limitMultiplier ?? 1) *
    rateLimitRelaxFactor(config);
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
