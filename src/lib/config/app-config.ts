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
  /** Platform hizmet bedeli (baz puan; 0 → yok). Vergi kuralları: TAX_RULES_JSON / data/tax-rules.json. */
  SERVICE_FEE_BPS: int(0, 0, 3000),
  /** Geçmiş envanter günleri bu kadar gün sonra budanır (P0-11). */
  INVENTORY_RETENTION_DAYS: int(400, 30, 3650),

  // Kur (P0-5)
  /** Sırayla denenecek kur kaynakları ("tcmb,ecb"); "none" → ağ yok, yalnızca statik tablo. */
  FX_SOURCES: z.string().default("tcmb,ecb"),
  FX_TCMB_URL: z.string().url().default("https://www.tcmb.gov.tr/kurlar/today.xml"),
  FX_ECB_URL: z
    .string()
    .url()
    .default("https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml"),
  FX_FETCH_TIMEOUT_MS: int(5000, 100, 60_000),
  /** Günlük yenileme (cron, UTC). TCMB kurları ~15:30 TR saatinde yayımlanır. */
  FX_REFRESH_CRON: z.string().min(1).default("45 12 * * *"),
  /** Bu kadar saatten eski kur tablosu "stale" sayılır. */
  FX_STALE_HOURS: int(72, 1, 24 * 30),
  /** Güncel tablo bellekte bu kadar saniye tutulur. */
  FX_CACHE_SECONDS: int(60, 0, 3600),
  /** Tesis para birimi dışında tahsilat yapılabilecek para birimleri ("USD,EUR"); boş → yalnızca tesis. */
  FX_CHARGE_CURRENCIES: z.string().default(""),

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
  /** hops=0 iken önde başlığı ezen tek ters vekil varsa `x-real-ip`'ye güven (v3#3). */
  TRUST_REAL_IP_HEADER: bool(false),
  /** Hesap (e-posta) bazlı giriş denemesi limiti — IP'den bağımsız (v3#3). */
  RATE_LIMIT_LOGIN_PER_ACCOUNT_MAX: int(10, 1),
  /** v3: 15 → 5 dk (denylist Redis yokken fail-closed; iptal penceresi kısa). */
  ACCESS_TOKEN_TTL_SECONDS: int(5 * 60, 60, 24 * 60 * 60),
  REFRESH_TOKEN_TTL_SECONDS: int(7 * 24 * 60 * 60, 60 * 60, 90 * 24 * 60 * 60),

  // Hesap güvenliği (P0-8)
  AUTH_LOCKOUT_THRESHOLD: int(5, 1, 100),
  AUTH_LOCKOUT_MINUTES: int(15, 1, 24 * 60),
  AUTH_RESET_TOKEN_TTL_MINUTES: int(30, 5, 24 * 60),
  AUTH_VERIFY_TOKEN_TTL_HOURS: int(24, 1, 24 * 14),
  /** WebAuthn: tarayıcıdaki alan adı (RP ID) ve beklenen origin. */
  WEBAUTHN_RP_ID: z.string().min(1).default("localhost"),
  WEBAUTHN_RP_NAME: z.string().min(1).default("booking-platform"),
  WEBAUTHN_ORIGIN: z.string().url().default("http://localhost:3000"),
  WEBAUTHN_CHALLENGE_TTL_SECONDS: int(300, 30, 3600),

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
