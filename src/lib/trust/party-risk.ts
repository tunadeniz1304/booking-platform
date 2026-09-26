import { getConfig, type AppConfig } from "@/lib/config/app-config";

/**
 * P1-6 parti riski skoru — deterministik, açıklanabilir kural toplamı (LLM YOK).
 *
 * Sinyaller (ağırlıklar ve eşikler `PARTY_RISK_*` config'inde):
 *  - YOUNG_ACCOUNT : misafir hesabı rezervasyon anında `PARTY_RISK_YOUNG_ACCOUNT_DAYS` günden genç
 *  - SINGLE_NIGHT  : tek gecelik konaklama
 *  - LARGE_GROUP   : misafir sayısı ≥ `PARTY_RISK_LARGE_GROUP_MIN`
 *  - NEAR_DATE     : giriş, rezervasyon gününden `PARTY_RISK_NEAR_DATE_DAYS` günden az sonra
 *  - WEEKEND       : konaklama bir cuma veya cumartesi gecesini içeriyor
 *
 * Skor = tetiklenen sinyallerin ağırlık toplamı (üst sınır 100); skor ≥ `PARTY_RISK_THRESHOLD`
 * → "işaretli" (ev sahibine uyarı). Sınırlamalar ve önyargı tartışması: docs/METHODOLOGY.md.
 * Skor tek başına rezervasyonu reddetmez; yalnızca ev sahibini bilgilendirir.
 */

export type PartyRiskReason =
  "YOUNG_ACCOUNT" | "SINGLE_NIGHT" | "LARGE_GROUP" | "NEAR_DATE" | "WEEKEND";

export interface PartyRiskInput {
  accountCreatedAt: Date;
  bookedAt: Date;
  /** UTC gece tarihi (@db.Date). */
  checkIn: Date;
  checkOut: Date;
  guestCount: number;
}

export interface PartyRiskResult {
  score: number;
  /** Ağırlığa göre azalan gerekçe kodları. */
  reasons: PartyRiskReason[];
  /** Her gerekçenin skora katkısı (açıklanabilirlik). */
  contributions: Array<{ reason: PartyRiskReason; weight: number }>;
  flagged: boolean;
}

export type PartyRiskConfig = Pick<
  AppConfig,
  | "PARTY_RISK_THRESHOLD"
  | "PARTY_RISK_YOUNG_ACCOUNT_DAYS"
  | "PARTY_RISK_WEIGHT_YOUNG_ACCOUNT"
  | "PARTY_RISK_WEIGHT_SINGLE_NIGHT"
  | "PARTY_RISK_LARGE_GROUP_MIN"
  | "PARTY_RISK_WEIGHT_LARGE_GROUP"
  | "PARTY_RISK_NEAR_DATE_DAYS"
  | "PARTY_RISK_WEIGHT_NEAR_DATE"
  | "PARTY_RISK_WEIGHT_WEEKEND"
>;

const DAY_MS = 86_400_000;
const utcDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

/** Cuma (5) veya cumartesi (6) gecesi içeriyor mu (gece = giriş ≤ d < çıkış). */
export function includesWeekendNight(checkIn: Date, checkOut: Date): boolean {
  for (let t = utcDay(checkIn); t < utcDay(checkOut); t += DAY_MS) {
    const dow = new Date(t).getUTCDay();
    if (dow === 5 || dow === 6) return true;
  }
  return false;
}

export function scorePartyRisk(
  input: PartyRiskInput,
  cfg: PartyRiskConfig = getConfig()
): PartyRiskResult {
  const nights = Math.round((utcDay(input.checkOut) - utcDay(input.checkIn)) / DAY_MS);
  const accountAgeDays = (input.bookedAt.getTime() - input.accountCreatedAt.getTime()) / DAY_MS;
  const leadDays = Math.round((utcDay(input.checkIn) - utcDay(input.bookedAt)) / DAY_MS);

  const rules: Array<[PartyRiskReason, boolean, number]> = [
    [
      "YOUNG_ACCOUNT",
      accountAgeDays < cfg.PARTY_RISK_YOUNG_ACCOUNT_DAYS,
      cfg.PARTY_RISK_WEIGHT_YOUNG_ACCOUNT,
    ],
    ["SINGLE_NIGHT", nights === 1, cfg.PARTY_RISK_WEIGHT_SINGLE_NIGHT],
    [
      "LARGE_GROUP",
      input.guestCount >= cfg.PARTY_RISK_LARGE_GROUP_MIN,
      cfg.PARTY_RISK_WEIGHT_LARGE_GROUP,
    ],
    ["NEAR_DATE", leadDays < cfg.PARTY_RISK_NEAR_DATE_DAYS, cfg.PARTY_RISK_WEIGHT_NEAR_DATE],
    ["WEEKEND", includesWeekendNight(input.checkIn, input.checkOut), cfg.PARTY_RISK_WEIGHT_WEEKEND],
  ];
  const contributions = rules
    .filter(([, hit, weight]) => hit && weight > 0)
    .map(([reason, , weight]) => ({ reason, weight }))
    .sort((a, b) => b.weight - a.weight || a.reason.localeCompare(b.reason));
  const score = Math.min(
    100,
    contributions.reduce((sum, c) => sum + c.weight, 0)
  );
  return {
    score,
    reasons: contributions.map((c) => c.reason),
    contributions,
    flagged: score >= cfg.PARTY_RISK_THRESHOLD,
  };
}
