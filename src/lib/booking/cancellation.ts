import { z } from "zod";
import { money, multiplyRate, type CurrencyCode } from "@/lib/money/money";
import { checkInAt, type IsoDate, type PropertyClock } from "@/lib/time/nights";

/**
 * Sürümlü iptal politikaları ve iade hesabı.
 *
 * Rezervasyon anında mülkün politikası `Booking.policySnapshot` olarak kopyalanır;
 * politika sonradan değişse de misafire o anki kurallar uygulanır.
 *
 * Kural: iptal anında check-in anına (check-in günü, TESİSİN saat diliminde giriş saati —
 * v3#6, ADR 0011) kalan gerçek saat
 * bir basamağın `hoursBefore` değerine eşit/büyükse o basamağın `refundPercent`'i
 * iade edilir (en cömert basamaktan başlanır). Check-in anı geçtiyse (no-show) iade yok.
 * `graceHours`: rezervasyondan sonraki bu süre içinde, check-in en az
 * `graceMinLeadHours` uzaktaysa tam iade (cayma penceresi).
 * İade yüzdesi vergi dahil ödenen toplama uygulanır; minor-unit, half-up.
 */

export const policyRulesSchema = z.object({
  tiers: z
    .array(z.object({ hoursBefore: z.number().min(0), refundPercent: z.number().min(0).max(100) }))
    .min(1),
  graceHours: z.number().min(0).optional(),
  graceMinLeadHours: z.number().min(0).optional(),
});

export type PolicyRules = z.infer<typeof policyRulesSchema>;
export type PolicyKind = "NON_REFUNDABLE" | "FLEXIBLE" | "MODERATE" | "STRICT";

export interface PolicySnapshot {
  kind: PolicyKind;
  version: number;
  rules: PolicyRules;
}

/** Migration'daki sürüm-1 politikalarıyla birebir (mülke atanmamışsa MODERATE). */
export const DEFAULT_POLICIES: Record<PolicyKind, PolicySnapshot> = {
  NON_REFUNDABLE: {
    kind: "NON_REFUNDABLE",
    version: 1,
    rules: { tiers: [{ hoursBefore: 0, refundPercent: 0 }] },
  },
  FLEXIBLE: {
    kind: "FLEXIBLE",
    version: 1,
    rules: {
      tiers: [
        { hoursBefore: 24, refundPercent: 100 },
        { hoursBefore: 0, refundPercent: 0 },
      ],
    },
  },
  MODERATE: {
    kind: "MODERATE",
    version: 1,
    rules: {
      tiers: [
        { hoursBefore: 120, refundPercent: 100 },
        { hoursBefore: 24, refundPercent: 50 },
        { hoursBefore: 0, refundPercent: 0 },
      ],
    },
  },
  STRICT: {
    kind: "STRICT",
    version: 1,
    rules: {
      tiers: [
        { hoursBefore: 336, refundPercent: 100 },
        { hoursBefore: 168, refundPercent: 50 },
        { hoursBefore: 0, refundPercent: 0 },
      ],
      graceHours: 48,
      graceMinLeadHours: 336,
    },
  },
};

export function toSnapshot(
  policy: { kind: string; version: number; rules: unknown } | null | undefined
): PolicySnapshot {
  if (!policy) return DEFAULT_POLICIES.MODERATE;
  return {
    kind: policy.kind as PolicyKind,
    version: policy.version,
    rules: policyRulesSchema.parse(policy.rules),
  };
}

export function parseSnapshot(value: unknown): PolicySnapshot {
  if (!value || typeof value !== "object") return DEFAULT_POLICIES.MODERATE;
  const v = value as { kind?: string; version?: number; rules?: unknown };
  return toSnapshot({ kind: v.kind ?? "MODERATE", version: v.version ?? 1, rules: v.rules });
}

export interface RefundDecision {
  refundMinor: number;
  refundPercent: number;
  hoursBeforeCheckIn: number;
  reason: "grace_period" | "tier" | "no_show" | "not_paid";
}

/** Check-in anı: check-in günü, tesisin yerel giriş saatinde (DST güvenli). */
export function checkInInstant(checkIn: IsoDate, clock: PropertyClock): Date {
  return checkInAt(checkIn, clock);
}

export function computeRefund(
  snapshot: PolicySnapshot,
  booking: { checkIn: IsoDate; createdAt: Date; paidMinor: number; currency: CurrencyCode },
  now: Date,
  clock: PropertyClock
): RefundDecision {
  const start = checkInInstant(booking.checkIn, clock);
  const hoursBefore = (start.getTime() - now.getTime()) / 3_600_000;
  const base = { hoursBeforeCheckIn: Math.round(hoursBefore * 100) / 100 };

  if (booking.paidMinor <= 0)
    return { ...base, refundMinor: 0, refundPercent: 0, reason: "not_paid" };
  if (hoursBefore <= 0) return { ...base, refundMinor: 0, refundPercent: 0, reason: "no_show" };

  const { graceHours, graceMinLeadHours = 0 } = snapshot.rules;
  if (graceHours !== undefined) {
    const sinceBooking = (now.getTime() - booking.createdAt.getTime()) / 3_600_000;
    const leadAtBooking = (start.getTime() - booking.createdAt.getTime()) / 3_600_000;
    if (sinceBooking <= graceHours && leadAtBooking >= graceMinLeadHours) {
      return {
        ...base,
        refundMinor: booking.paidMinor,
        refundPercent: 100,
        reason: "grace_period",
      };
    }
  }

  const tiers = [...snapshot.rules.tiers].sort((a, b) => b.hoursBefore - a.hoursBefore);
  const tier = tiers.find((t) => hoursBefore >= t.hoursBefore) ?? { refundPercent: 0 };
  const refund = multiplyRate(money(booking.paidMinor, booking.currency), tier.refundPercent / 100);
  return {
    ...base,
    refundMinor: Math.min(refund.amount, booking.paidMinor),
    refundPercent: tier.refundPercent,
    reason: "tier",
  };
}
