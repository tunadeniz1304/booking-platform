import { z } from "zod";

/**
 * Uygulama geneli eşikler ve oranlar — "sihirli sayı yok" ilkesi.
 *
 * Her değer bir ortam değişkeniyle ezilebilir (adlar `.env.example`'da) ve zod ile
 * doğrulanır. Geçersiz değer uygulamayı düşürmez: varsayılana döner ve adı
 * `invalidKeys` listesine yazılır (başlangıçta loglanır).
 */

const num = (def: number, min?: number, max?: number) => {
  let s = z.coerce.number();
  if (min !== undefined) s = s.min(min);
  if (max !== undefined) s = s.max(max);
  return s.default(def);
};
const int = (def: number, min?: number, max?: number) => {
  let s = z.coerce.number().int();
  if (min !== undefined) s = s.min(min);
  if (max !== undefined) s = s.max(max);
  return s.default(def);
};
const bool = (def: boolean) =>
  z
    .enum(["true", "false", "1", "0"])
    .transform((v) => v === "true" || v === "1")
    .default(def ? "true" : "false");

const schema = z.object({
  // Rezervasyon
  BOOKING_HOLD_TTL_MINUTES: int(15, 1, 24 * 60),
  MAX_STAY_NIGHTS: int(30, 1, 365),
  QUOTE_TTL_MINUTES: int(15, 1, 120),
  ACCOMMODATION_TAX_RATE: num(0.01, 0, 0.5),

  // Dinamik fiyat / olay sinyalleri
  PRICE_FLOOR_MULTIPLIER: num(0.6, 0.1, 1),
  PRICE_CEILING_MULTIPLIER: num(2.0, 1, 10),
  EVENT_FACTOR_PER_POINT: num(0.05, 0, 0.5),
  YIELD_HOLD_MAX_SHARE: num(0.2, 0, 1),

  // Transfer
  FEATURE_TRANSFER: bool(true),
  TRANSFER_MAX_ASK_RATIO: num(1.0, 0.1, 2),
  TRANSFER_MIN_HOURS_BEFORE_CHECKIN: int(48, 0, 24 * 60),
  TRANSFER_LINK_TTL_HOURS: int(24 * 7, 1, 24 * 60),

  // Fraud
  FRAUD_REVIEW_THRESHOLD: int(40, 0, 100),
  FRAUD_BLOCK_THRESHOLD: int(80, 0, 100),

  // Güvenlik / ağ
  TRUSTED_PROXY_HOPS: int(0, 0, 10),
  ACCESS_TOKEN_TTL_SECONDS: int(15 * 60, 60, 24 * 60 * 60),
  REFRESH_TOKEN_TTL_SECONDS: int(7 * 24 * 60 * 60, 60 * 60, 90 * 24 * 60 * 60),

  // Rate-limit (pencere başına istek)
  RATE_LIMIT_WINDOW_SECONDS: int(60, 1, 3600),
  RATE_LIMIT_DEFAULT_MAX: int(100, 1),
  RATE_LIMIT_AUTH_MAX: int(20, 1),
  RATE_LIMIT_SEARCH_MAX: int(60, 1),
  RATE_LIMIT_BOOKING_MAX: int(30, 1),
  RATE_LIMIT_AI_MAX: int(20, 1),

  // Canlı ısı haritası (SSE)
  LIVE_MAX_RANGE_DAYS: int(60, 1, 366),
  LIVE_MAX_CONNECTIONS_PER_IP: int(3, 1, 100),
  LIVE_POLL_INTERVAL_MS: int(3000, 500, 60000),
  LIVE_VIEW_DEDUPE_SECONDS: int(600, 1, 86400),

  // Rota optimizasyonu
  ROUTING_MAX_CITIES: int(12, 2, 16),
  ROUTING_FLIGHT_COST_PER_KM: num(0.09, 0),
  ROUTING_FLIGHT_COST_BASE: num(40, 0),

  // Outbox
  OUTBOX_MAX_ATTEMPTS: int(8, 1, 50),
  OUTBOX_LEASE_SECONDS: int(60, 5, 3600),
  OUTBOX_BACKOFF_BASE_MS: int(1000, 10, 60000),

  // Pazarlık
  NEGOTIATION_MAX_ROUNDS: int(3, 1, 10),
});

export type AppConfig = z.infer<typeof schema> & { invalidKeys: string[] };

type Env = Record<string, string | undefined>;

export function parseAppConfig(env: Env): AppConfig {
  const raw: Record<string, string | undefined> = {};
  for (const key of Object.keys(schema.shape)) {
    const value = env[key]?.trim();
    raw[key] = value ? value : undefined;
  }
  const invalidKeys: string[] = [];
  let parsed = schema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0]);
      invalidKeys.push(key);
      raw[key] = undefined;
    }
    parsed = schema.safeParse(raw);
  }
  const data = parsed.success ? parsed.data : schema.parse({});
  return { ...data, invalidKeys };
}

let cached: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (!cached) cached = parseAppConfig(process.env);
  return cached;
}

/** Yalnızca testler için: ortam değişikliklerinden sonra yeniden okur. */
export function resetConfigForTests(): void {
  cached = null;
}
