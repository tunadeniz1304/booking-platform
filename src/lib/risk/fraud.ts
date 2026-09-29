import type { RedisClient } from "@/lib/redis";
import { getConfig, type AppConfig } from "@/lib/config/app-config";
import { binCountry } from "@/lib/risk/bin-table";

/**
 * Kural tabanlı fraud skoru v2 (P1-8). Her kural açıklanabilir sebep kodu + puan ekler
 * (toplam ≤ 100); karar yalnızca config eşiklerinden deterministik türetilir (LLM yok):
 *
 *   skor ≥ FRAUD_BLOCK_THRESHOLD      → deny            (ödeme reddedilir)
 *   skor ≥ FRAUD_REVIEW_THRESHOLD     → review          (3DS zorunlu + admin inceleme kuyruğu)
 *   skor ≥ FRAUD_STEP_UP_THRESHOLD    → step_up_passkey (passkey ile yeniden doğrulama; passkey yoksa 3DS)
 *   skor ≥ FRAUD_CHALLENGE_THRESHOLD  → challenge_3ds   (3DS zorunlu)
 *   aksi halde                        → allow
 *
 * Hız sayaçları Redis `INCR`+TTL ile (kullanıcı / istemci anahtarı / kart token'ı). İstemci
 * anahtarı güvenilir vekil ayarına göre çözülür (v3#3 IP düzeltmesi); "unknown" kovası sayılmaz.
 * Cihaz kimliği sunucu imzalı `did` çerezinden (`device-cookie.ts`), BIN PSP token
 * metadata'sından gelir; ikisi de istemci gövdesinden alınmaz (v4#13).
 * Redis erişilemezse hız/cihaz kuralları puan eklemez (fail-open).
 */

export const FRAUD_DECISIONS = [
  "allow",
  "challenge_3ds",
  "step_up_passkey",
  "review",
  "deny",
] as const;
export type FraudDecision = (typeof FRAUD_DECISIONS)[number];

export interface FraudSignals {
  userId: string;
  ip: string;
  cardToken: string;
  amountMinor: number;
  accountCreatedAt: Date;
  recentFailedPayments: number;
  ipCountry?: string | null;
  billingCountry?: string | null;
  /** Kartın ilk 6 hanesi (PSP hosted field'dan; tam numara sunucuya gelmez). */
  cardBin?: string | null;
  /** İstemci cihaz izi (hash). */
  deviceId?: string | null;
  now?: Date;
}

export interface DeviceSignals {
  /** Kullanıcının daha önce görülmüş başka cihazı var ve bu cihaz yeni. */
  newDevice: boolean;
  /** Bu cihazı kullanan farklı hesap sayısı. */
  accountsOnDevice: number;
}

export interface VelocitySignals {
  user: number;
  ip: number;
  card: number;
}

export interface FraudRuleHit {
  /** Açıklanabilir sebep kodu. */
  rule: string;
  points: number;
  detail: string;
}

export interface FraudAssessment {
  score: number;
  decision: FraudDecision;
  hits: FraudRuleHit[];
}

/** Kural ağırlıkları (puan). Eşikler config'te; ağırlıklar kuralın tanımının parçasıdır. */
export const RULE_POINTS = {
  velocity_user: 25,
  velocity_ip: 20,
  velocity_card: 20,
  new_account_high_amount: 30,
  country_mismatch: 20,
  bin_ip_country_mismatch: 20,
  failed_payments: 25,
  new_device: 10,
  device_shared: 25,
} as const;
export type FraudRule = keyof typeof RULE_POINTS;

const MAX_SCORE = 100;
const HOUR_MS = 3_600_000;
const DAY_SECONDS = 86_400;
const NEW_ACCOUNT_HOURS = 24;
const VELOCITY_USER_WINDOW_SECONDS = 600;
const VELOCITY_WINDOW_SECONDS = 3600;

const hit = (rule: FraudRule, detail: string): FraudRuleHit => ({
  rule,
  points: RULE_POINTS[rule],
  detail,
});

const sameCountry = (a: string, b: string) => a.toUpperCase() === b.toUpperCase();

type Thresholds = Pick<
  AppConfig,
  | "FRAUD_BLOCK_THRESHOLD"
  | "FRAUD_REVIEW_THRESHOLD"
  | "FRAUD_STEP_UP_THRESHOLD"
  | "FRAUD_CHALLENGE_THRESHOLD"
>;

/** Skor → karar (yalnızca config eşikleri; en ağır eşikten başlanır). */
export function decide(score: number, cfg: Thresholds = getConfig()): FraudDecision {
  if (score >= cfg.FRAUD_BLOCK_THRESHOLD) return "deny";
  if (score >= cfg.FRAUD_REVIEW_THRESHOLD) return "review";
  if (score >= cfg.FRAUD_STEP_UP_THRESHOLD) return "step_up_passkey";
  if (score >= cfg.FRAUD_CHALLENGE_THRESHOLD) return "challenge_3ds";
  return "allow";
}

export function scoreSignals(
  s: FraudSignals,
  velocity: VelocitySignals,
  device: DeviceSignals = { newDevice: false, accountsOnDevice: 0 }
): FraudAssessment {
  const cfg = getConfig();
  const now = s.now ?? new Date();
  const hits: FraudRuleHit[] = [];
  if (velocity.user > cfg.FRAUD_VELOCITY_USER_MAX)
    hits.push(hit("velocity_user", `${velocity.user} ödeme denemesi / 10 dk`));
  if (velocity.ip > cfg.FRAUD_VELOCITY_IP_MAX)
    hits.push(hit("velocity_ip", `${velocity.ip} deneme / saat (aynı istemci)`));
  if (velocity.card > cfg.FRAUD_VELOCITY_CARD_MAX)
    hits.push(hit("velocity_card", `${velocity.card} deneme / saat (aynı kart)`));
  const ageHours = (now.getTime() - s.accountCreatedAt.getTime()) / HOUR_MS;
  if (ageHours < NEW_ACCOUNT_HOURS && s.amountMinor >= cfg.FRAUD_HIGH_AMOUNT_MINOR) {
    hits.push(hit("new_account_high_amount", "24 saatten yeni hesap ve yüksek tutar"));
  }
  if (s.ipCountry && s.billingCountry && !sameCountry(s.ipCountry, s.billingCountry)) {
    hits.push(
      hit("country_mismatch", `IP ülkesi ${s.ipCountry} ≠ fatura ülkesi ${s.billingCountry}`)
    );
  }
  const cardCountry = s.cardBin ? binCountry(s.cardBin) : null;
  if (s.ipCountry && cardCountry && !sameCountry(s.ipCountry, cardCountry)) {
    hits.push(
      hit("bin_ip_country_mismatch", `Kart ülkesi (BIN) ${cardCountry} ≠ IP ülkesi ${s.ipCountry}`)
    );
  }
  if (s.recentFailedPayments >= cfg.FRAUD_FAILED_PAYMENTS_MIN) {
    hits.push(hit("failed_payments", `${s.recentFailedPayments} başarısız ödeme / 24 saat`));
  }
  if (device.newDevice) hits.push(hit("new_device", "Hesap için yeni cihaz"));
  if (device.accountsOnDevice > cfg.FRAUD_DEVICE_MAX_ACCOUNTS) {
    hits.push(hit("device_shared", `Aynı cihazda ${device.accountsOnDevice} farklı hesap`));
  }
  const score = Math.min(
    MAX_SCORE,
    hits.reduce((sum, h) => sum + h.points, 0)
  );
  return { score, decision: decide(score, cfg), hits };
}

export type FraudRedis = Pick<RedisClient, "incrWithTtl" | "sadd" | "scard" | "expire">;

/** Cihaz sinyalleri: kullanıcı başına bilinen cihazlar, cihaz başına hesaplar (Redis set). */
export async function deviceSignals(
  redis: FraudRedis,
  userId: string,
  deviceId: string | null | undefined
): Promise<DeviceSignals> {
  if (!deviceId) return { newDevice: false, accountsOnDevice: 0 };
  const ttl = getConfig().FRAUD_DEVICE_TTL_DAYS * DAY_SECONDS;
  const userKey = `fraud:dev:user:${userId}`;
  const deviceKey = `fraud:dev:acct:${deviceId}`;
  try {
    const knownBefore = await redis.scard(userKey);
    const added = await redis.sadd(userKey, deviceId);
    await redis.sadd(deviceKey, userId);
    const accountsOnDevice = await redis.scard(deviceKey);
    await Promise.all([redis.expire(userKey, ttl), redis.expire(deviceKey, ttl)]);
    return { newDevice: knownBefore > 0 && added > 0, accountsOnDevice };
  } catch {
    return { newDevice: false, accountsOnDevice: 0 };
  }
}

export async function assessPayment(redis: FraudRedis, s: FraudSignals): Promise<FraudAssessment> {
  const count = (key: string, ttl: number) => redis.incrWithTtl(key, ttl).catch(() => 0);
  const [user, ip, card, device] = await Promise.all([
    count(`fraud:v:user:${s.userId}`, VELOCITY_USER_WINDOW_SECONDS),
    count(`fraud:v:ip:${s.ip}`, VELOCITY_WINDOW_SECONDS),
    count(`fraud:v:card:${s.cardToken}`, VELOCITY_WINDOW_SECONDS),
    deviceSignals(redis, s.userId, s.deviceId),
  ]);
  return scoreSignals(s, { user, ip: s.ip === "unknown" ? 0 : ip, card }, device);
}
