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
  /** Rezervasyon detay önbelleği (sn); durum değişiminde outbox tüketicisi siler (v4#14). */
  BOOKING_CACHE_TTL_SECONDS: int(600, 0, 3600),
  /** GET /api/bookings sayfa boyutu: varsayılan ve üst sınır (cursor pagination, v4#14). */
  BOOKINGS_PAGE_SIZE_DEFAULT: int(50, 1, 500),
  BOOKINGS_PAGE_SIZE_MAX: int(100, 1, 500),

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
  /** Bu kadar günden eski, rezervasyona bağlı olmayan kur satırları budanır (en yenisi kalır). */
  FX_RETENTION_DAYS: int(90, 1, 3650),
  /** Güncel tablo bellekte bu kadar saniye tutulur. */
  FX_CACHE_SECONDS: int(60, 0, 3600),
  /** Tesis para birimi dışında tahsilat yapılabilecek para birimleri ("USD,EUR"); boş → yalnızca tesis. */
  FX_CHARGE_CURRENCIES: z.string().default(""),

  // Dinamik fiyat / olay sinyalleri
  PRICE_FLOOR_MULTIPLIER: num(0.6, 0.1, 1),
  PRICE_CEILING_MULTIPLIER: num(2.0, 1, 10),
  EVENT_FACTOR_PER_POINT: num(0.05, 0, 0.5),
  YIELD_HOLD_MAX_SHARE: num(0.2, 0, 1),

  // Host gelir paneli (P1-5)
  /** KPI penceresi: bugünden itibaren kaç gece (doluluk, ADR, RevPAR). */
  REVENUE_WINDOW_DAYS: int(30, 1, 365),
  /** Pickup grafiği: geriye doğru kaç günlük rezervasyon girişi. */
  REVENUE_PICKUP_DAYS: int(30, 1, 365),
  /** Öneri üretilen ileri gece sayısı (yarından itibaren). */
  REVENUE_SUGGESTION_DAYS: int(14, 1, 90),
  /** Hedef doluluk: üstü fiyatı artırır, altı düşürür. */
  REVENUE_OCCUPANCY_TARGET: num(0.7, 0, 1),
  /** Doluluk sapmasının çarpana etkisi: 1 + ağırlık × (doluluk − hedef). */
  REVENUE_OCCUPANCY_WEIGHT: num(0.5, 0, 5),
  /** Son dakika penceresi (gün): hedefin altındaki doluluk için indirim uygulanır. */
  REVENUE_LAST_MINUTE_DAYS: int(3, 0, 60),
  /** Son dakika indirimi (baz puan). */
  REVENUE_LAST_MINUTE_DISCOUNT_BPS: int(1000, 0, 9000),
  /** Resmî tatil/bayram gecesi artışı (baz puan). */
  REVENUE_HOLIDAY_UPLIFT_BPS: int(1500, 0, 20_000),
  /** Gelir önerisi LLM açıklaması önbelleği (sn); aynı olgular günde bir kez açıklanır. 0 = kapalı. */
  REVENUE_EXPLAIN_CACHE_TTL_SECONDS: int(86_400, 0, 7 * 86_400),

  // Fiyat içgörüsü + fiyat alarmı (P1-4)
  /** Split conformal hata oranı: 0.1 → %90 tahmin aralığı. */
  PRICE_INSIGHT_ALPHA: num(0.1, 0.01, 0.5),
  /** Aralık için gereken asgari kalibrasyon gecesi; altında etiket verilmez. */
  PRICE_INSIGHT_MIN_CALIBRATION: int(20, 1, 100_000),
  /** Kalibrasyon için bugünden geriye/ileriye bakılan gün sayısı (aynı konum). */
  PRICE_INSIGHT_WINDOW_DAYS: int(90, 7, 400),
  /** Omnibus referans fiyatı: son N günün en düşük gözlenen fiyatı ("önceki fiyat"). */
  PRICE_OMNIBUS_DAYS: int(30, 1, 365),
  /** Günlük fiyat alarmı işi (cron, UTC). */
  PRICE_ALERT_CRON: z.string().min(1).default("15 6 * * *"),
  /** Kullanıcı başına azami aktif fiyat alarmı. */
  PRICE_ALERT_MAX_PER_USER: int(20, 1, 1000),

  // Transfer
  FEATURE_TRANSFER: bool(true),
  /** Devir sonrası satıcıya (mock) payout işinin cron'u (UTC). */
  PAYOUT_CRON: z.string().min(1).default("*/15 * * * *"),
  TRANSFER_MAX_ASK_RATIO: num(1.0, 0.1, 2),
  TRANSFER_MIN_HOURS_BEFORE_CHECKIN: int(48, 0, 24 * 60),
  TRANSFER_LINK_TTL_HOURS: int(24 * 7, 1, 24 * 60),
  /** CAPTURE_PENDING'de bu süreden uzun kalan devir süpürülür (void/iade + FAILED). */
  TRANSFER_CAPTURE_PENDING_TIMEOUT_SECONDS: int(15 * 60, 60, 24 * 60 * 60),
  TRANSFER_SWEEP_CRON: z.string().min(1).default("*/5 * * * *"),

  // Defter (P0-3)
  /** Günlük PSP ↔ jurnal mutabakat işinin cron'u (UTC); dünün kayıtlarını karşılaştırır. */
  LEDGER_RECONCILE_CRON: z.string().min(1).default("45 2 * * *"),

  // Fraud v2 (P1-8): skor → allow < challenge_3ds < step_up_passkey < review < deny
  FRAUD_CHALLENGE_THRESHOLD: int(30, 0, 100),
  FRAUD_STEP_UP_THRESHOLD: int(45, 0, 100),
  FRAUD_REVIEW_THRESHOLD: int(60, 0, 100),
  FRAUD_BLOCK_THRESHOLD: int(80, 0, 100),
  /** Hız kuralları: kullanıcı / 10 dk, istemci anahtarı / saat, kart / saat. */
  FRAUD_VELOCITY_USER_MAX: int(3, 1, 1000),
  FRAUD_VELOCITY_IP_MAX: int(10, 1, 10_000),
  FRAUD_VELOCITY_CARD_MAX: int(5, 1, 1000),
  /** Yeni hesapta "yüksek tutar" eşiği (minor-unit; 2.000.000 = 20.000 TRY). */
  FRAUD_HIGH_AMOUNT_MINOR: int(2_000_000, 1),
  /** Aynı cihaz izinde bundan fazla farklı hesap → device_shared. */
  FRAUD_DEVICE_MAX_ACCOUNTS: int(3, 1, 100),
  /** Cihaz izi ↔ hesap eşleşmelerinin tutulma süresi (gün). */
  FRAUD_DEVICE_TTL_DAYS: int(90, 1, 365),
  /** Passkey step-up doğrulamasının geçerlilik süresi (tek kullanımlık). */
  STEP_UP_TTL_SECONDS: int(300, 30, 3600),

  // Mesajlaşma (P1-6)
  MESSAGE_MAX_LENGTH: int(2000, 50, 20_000),
  /** Thread başına döndürülen azami mesaj. */
  MESSAGE_PAGE_SIZE: int(200, 10, 1000),
  /** SSE bağlantısı canlı tutma aralığı. */
  MESSAGE_SSE_HEARTBEAT_MS: int(25_000, 1000, 120_000),

  // Yorum moderasyonu (P1-7)
  /** Bu kadar farklı kullanıcı şikâyeti → yorum otomatik gizlenir (admin incelemesine düşer). */
  REVIEW_REPORT_HIDE_THRESHOLD: int(3, 1, 100),

  // Kanal yöneticisi (P1-9, v3#21)
  /** iCal abonelikleri bu aralıkla (dk) koşullu GET ile yoklanır. */
  ICAL_POLL_MINUTES: int(30, 5, 24 * 60),
  /** Tek yoklama turunda işlenecek azami abonelik. */
  ICAL_POLL_BATCH: int(50, 1, 1000),
  ICAL_FETCH_TIMEOUT_MS: int(10_000, 500, 60_000),
  /** Uzak iCal gövdesi için üst sınır (bayt); aşılırsa istek kesilir. */
  ICAL_MAX_BYTES: int(1_000_000, 10_000, 10_000_000),
  /** Tek iCal çekiminin TOPLAM süre sınırı (ms; yavaş-damla gövdeye karşı, v4#11). */
  ICAL_FETCH_DEADLINE_MS: int(30_000, 1_000, 300_000),
  /** Bir yoklama turunda aynı anda çekilen azami abonelik (v4#11). */
  ICAL_POLL_CONCURRENCY: int(4, 1, 32),
  /** Parite uyarısı: harici kanal fiyatı bizimkinden bu kadar baz puan farklıysa host uyarılır. */
  CHANNEL_PARITY_TOLERANCE_BPS: int(100, 0, 10_000),
  /** Ajan checkout oturumu (ACP) geçerlilik süresi (dk); dolunca oturum iptal sayılır. */
  CHECKOUT_SESSION_TTL_MINUTES: int(30, 5, 1440),

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
  // v4#12: kilit yerine (istemci, e-posta) kademeli gecikme + iş kanıtı (PoW).
  /** Çift başına gecikmesiz başarısız deneme sayısı. */
  AUTH_LOGIN_FREE_FAILURES: int(3, 0, 100),
  AUTH_LOGIN_DELAY_BASE_MS: int(1000, 0, 60_000),
  AUTH_LOGIN_DELAY_MAX_MS: int(30_000, 0, 15 * 60_000),
  /** PoW zorluğu (baştaki sıfır bit; ~2^bit SHA-256). */
  AUTH_POW_DIFFICULTY_BITS: int(16, 1, 28),
  AUTH_POW_TTL_SECONDS: int(300, 30, 3600),
  /** Giriş / şifre sıfırlama yanıtlarının asgari süresi (zamanlama ile hesap keşfi yok). */
  AUTH_MIN_RESPONSE_MS: int(300, 0, 5000),
  /** E-posta başına pencerede en çok şifre sıfırlama e-postası. */
  AUTH_RESET_PER_EMAIL_MAX: int(3, 1, 100),
  AUTH_RESET_WINDOW_SECONDS: int(3600, 60, 86_400),
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
  /** MCP HTTP ve ajan checkout uçları (`/api/mcp`, `/api/agentic`) — fail-closed. */
  RATE_LIMIT_AGENTIC_MAX: int(30, 1),
  /** IP bilinmeyen anonimlerin paylaştığı `anon` kovasının limit çarpanı (v4#4). */
  RATE_LIMIT_ANON_SHARED_MULTIPLIER: int(20, 1, 1000),

  // Canlı ısı haritası (SSE)
  LIVE_MAX_RANGE_DAYS: int(60, 1, 366),
  LIVE_MAX_CONNECTIONS_PER_IP: int(3, 1, 100),
  LIVE_POLL_INTERVAL_MS: int(3000, 500, 60000),
  LIVE_VIEW_DEDUPE_SECONDS: int(600, 1, 86400),
  /** İstemci anahtarı başına pencerede basılabilecek yeni izleyici çerezi (v4#18). */
  LIVE_VIEWER_MINT_MAX: int(20, 1, 10_000),

  // Rota optimizasyonu
  ROUTING_MAX_CITIES: int(12, 2, 16),
  ROUTING_FLIGHT_COST_PER_KM: num(0.09, 0),
  ROUTING_FLIGHT_COST_BASE: num(40, 0),

  // Outbox
  OUTBOX_MAX_ATTEMPTS: int(8, 1, 50),
  OUTBOX_LEASE_SECONDS: int(60, 5, 3600),
  OUTBOX_BACKOFF_BASE_MS: int(1000, 10, 60000),

  // Redis istemcisi
  /** Tek Redis komutunun üst süresi (ms); aşılırsa komut reddedilir (fail-open/closed çağırana kalır). */
  REDIS_COMMAND_TIMEOUT_MS: int(1000, 50, 30_000),

  // SERIALIZABLE işlem yeniden denemesi (P2034 / 40001)
  /** Serileştirme çakışmasında toplam deneme sayısı (ilk deneme dahil). */
  DB_SERIALIZABLE_RETRY_ATTEMPTS: int(6, 1, 20),
  /** Üstel geri çekilme tabanı (ms); gecikme = taban·2^(n−1) + aynı büyüklükte rastgele pay. */
  DB_SERIALIZABLE_RETRY_BASE_MS: int(15, 1, 1000),

  // P1-1 hibrit arama (RRF)
  SEARCH_RRF_K: int(60, 1, 1000),
  SEARCH_HYBRID_CANDIDATES: int(200, 10, 5000),
  SEARCH_HYBRID_MIN_SIMILARITY: num(0.2, -1, 1),
  SEARCH_HYBRID_MIN_TRGM: num(0.45, 0, 1),

  // P1-2 LTR (ONNX); dosya yoksa ağırlıklı sıralamaya düşülür
  LTR_MODEL_PATH: z.string().min(1).default("models/ranker.onnx"),

  // P1-10 görsel zekâ & çok-modlu arama (ADR 0022)
  /** CLIP görsel embedding + "bu fotoğraftaki gibi" araması; kapalıysa API/UI açıklama döner. */
  VISION_CLIP_ENABLED: bool(false),
  /** transformers.js model kimliği ve yerel önbellek dizini (`npm run vision:download`). */
  VISION_CLIP_MODEL: z.string().min(1).default("Xenova/clip-vit-base-patch32"),
  VISION_MODEL_DIR: z.string().min(1).default("models/transformers"),
  /** Yerel dosya yoksa modeli HF Hub'dan indirmeye izin ver (varsayılan kapalı: çevrimdışı). */
  VISION_ALLOW_REMOTE_MODELS: bool(false),
  /** Yükleme sınırları: bayt, normalize edilen uzun kenar (px), mülk başına fotoğraf. */
  VISION_MAX_UPLOAD_BYTES: int(10 * 1024 * 1024, 10_000, 50 * 1024 * 1024),
  VISION_MAX_EDGE_PX: int(1600, 256, 4096),
  VISION_MAX_PHOTOS_PER_PROPERTY: int(40, 1, 500),
  /** Laplacian varyansı bu değerde netlik skoru 1'e doyar (analiz 512 px gri tonda). */
  VISION_BLUR_VARIANCE_GOOD: num(300, 1, 100_000),
  /** Kalite skorunda netlik ağırlığı (kalanı pozlama). */
  VISION_QUALITY_BLUR_WEIGHT: num(0.6, 0, 1),
  /** Bu skorun altındaki fotoğraf için "düşük kalite" uyarısı. */
  VISION_LOW_QUALITY_THRESHOLD: num(0.35, 0, 1),
  /** pHash Hamming mesafesi ≤ eşik → duplikat (64 bit üzerinden). */
  VISION_DUPLICATE_MAX_HAMMING: int(8, 0, 32),
  /** Görsel kNN kanalına girmek için en düşük kosinüs benzerliği (CLIP'te ilgisiz görseller ~0.5–0.7). */
  VISION_MIN_SIMILARITY: num(0.75, -1, 1),

  // P1-3 deneyler: anonim bucket çerezi ömrü (gün)
  EXPERIMENT_COOKIE_DAYS: int(90, 1, 730),

  // v4 F1-B: hassas işlem güvenliği (v4#2) ve ödeme sağlamlığı (v4#7, v4#13)
  /** Hassas işlemler için son kimlik doğrulamanın (auth_time) azami yaşı (sn). */
  RECENT_AUTH_MAX_AGE_SECONDS: int(300, 30, 3600),
  /** Yeniden doğrulama (parola) denemesi sınırı / pencere (kullanıcı başına). */
  REAUTH_MAX_ATTEMPTS: int(5, 1, 100),
  REAUTH_WINDOW_SECONDS: int(900, 60, 86_400),
  /** Yeni kaydedilen passkey bu süre (saat) boyunca ödeme step-up'ında kullanılamaz. */
  PASSKEY_STEP_UP_COOLDOWN_HOURS: int(24, 0, 24 * 30),
  /** Rezervasyon başına başarısız ödeme/3DS denemesi sınırı; aşılınca ödeme FAILED. */
  PAYMENT_MAX_ATTEMPTS: int(5, 1, 50),
  /** Deneme sayacının ömrü (sn). */
  PAYMENT_ATTEMPTS_WINDOW_SECONDS: int(86_400, 60, 30 * 86_400),
  /** Sunucu imzalı cihaz kimliği çerezinin ömrü (gün). */
  DEVICE_COOKIE_DAYS: int(365, 1, 730),
  /** Başarısız PSP iadesinin otomatik yeniden deneme sayısı ve üstel gecikme tabanı (ms). */
  REFUND_RETRY_MAX_ATTEMPTS: int(8, 1, 50),
  REFUND_RETRY_BASE_DELAY_MS: int(30_000, 10, 3_600_000),
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
