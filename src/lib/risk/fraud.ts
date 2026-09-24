import type { RedisClient } from "@/lib/redis";
import { getConfig } from "@/lib/config/app-config";

/**
 * Kural tabanlı fraud skoru (P1-10). Her kural açıklanabilir puan ekler (toplam ≤ 100):
 *   skor ≥ FRAUD_BLOCK_THRESHOLD  → ödeme engellenir
 *   skor ≥ FRAUD_REVIEW_THRESHOLD → 3DS doğrulaması zorunlu + admin inceleme kuyruğu
 * Hız sayaçları Redis `INCR`+TTL ile (kullanıcı / IP / kart token'ı başına).
 * Redis erişilemezse hız kuralları puan eklemez (fail-open, loglanır üst katmanda).
 */

export interface FraudSignals {
  userId: string;
  ip: string;
  cardToken: string;
  amountMinor: number;
  accountCreatedAt: Date;
  recentFailedPayments: number;
  ipCountry?: string | null;
  billingCountry?: string | null;
  now?: Date;
}

export interface FraudRuleHit {
  rule: string;
  points: number;
  detail: string;
}

export interface FraudAssessment {
  score: number;
  decision: "allow" | "review" | "block";
  hits: FraudRuleHit[];
}

export const HIGH_AMOUNT_MINOR = 2_000_000; // 20.000 TRY

export function scoreSignals(
  s: FraudSignals,
  velocity: { user: number; ip: number; card: number }
): FraudAssessment {
  const cfg = getConfig();
  const now = s.now ?? new Date();
  const hits: FraudRuleHit[] = [];
  if (velocity.user > 3)
    hits.push({
      rule: "velocity_user",
      points: 25,
      detail: `${velocity.user} ödeme denemesi / 10 dk`,
    });
  if (velocity.ip > 10)
    hits.push({
      rule: "velocity_ip",
      points: 20,
      detail: `${velocity.ip} deneme / saat (aynı IP)`,
    });
  if (velocity.card > 5)
    hits.push({
      rule: "velocity_card",
      points: 20,
      detail: `${velocity.card} deneme / saat (aynı kart)`,
    });
  const ageHours = (now.getTime() - s.accountCreatedAt.getTime()) / 3_600_000;
  if (ageHours < 24 && s.amountMinor >= HIGH_AMOUNT_MINOR) {
    hits.push({
      rule: "new_account_high_amount",
      points: 30,
      detail: "24 saatten yeni hesap ve yüksek tutar",
    });
  }
  if (
    s.ipCountry &&
    s.billingCountry &&
    s.ipCountry.toUpperCase() !== s.billingCountry.toUpperCase()
  ) {
    hits.push({
      rule: "country_mismatch",
      points: 20,
      detail: `IP ülkesi ${s.ipCountry} ≠ fatura ülkesi ${s.billingCountry}`,
    });
  }
  if (s.recentFailedPayments >= 3) {
    hits.push({
      rule: "failed_payments",
      points: 25,
      detail: `${s.recentFailedPayments} başarısız ödeme / 24 saat`,
    });
  }
  const score = Math.min(
    100,
    hits.reduce((sum, h) => sum + h.points, 0)
  );
  const decision =
    score >= cfg.FRAUD_BLOCK_THRESHOLD
      ? "block"
      : score >= cfg.FRAUD_REVIEW_THRESHOLD
        ? "review"
        : "allow";
  return { score, decision, hits };
}

export async function assessPayment(
  redis: Pick<RedisClient, "incrWithTtl">,
  s: FraudSignals
): Promise<FraudAssessment> {
  const count = (key: string, ttl: number) => redis.incrWithTtl(key, ttl).catch(() => 0);
  const [user, ip, card] = await Promise.all([
    count(`fraud:v:user:${s.userId}`, 600),
    count(`fraud:v:ip:${s.ip}`, 3600),
    count(`fraud:v:card:${s.cardToken}`, 3600),
  ]);
  return scoreSignals(s, { user, ip: s.ip === "unknown" ? 0 : ip, card });
}
