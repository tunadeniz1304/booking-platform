import { getConfig } from "@/lib/config/app-config";

/**
 * Gelir paneli fiyat öneri motoru (P1-5) — saf ve deterministik.
 *
 * Taban: tesisin `basePrice` değeri (fiyat motorunun da orijinal tabanı, ADR 0016).
 * Faktörler sırayla çarpılır; her faktörün katkısı "önceki ara fiyat → sonraki ara fiyat"
 * farkıdır (minor-unit), böylece katkılar toplamı tam olarak `öneri − taban` eder:
 *
 *  - doluluk:   1 + ağırlık × (doluluk − hedef)
 *  - son dakika: varışa ≤ N gün ve doluluk hedefin altındaysa indirim
 *  - tatil:     resmî tatil/bayram gecesiyse artış
 *  - etkinlik:  1 + Σ onaylı olay etkisi × EVENT_FACTOR_PER_POINT
 *  - kırpma:    sonuç [taban × PRICE_FLOOR_MULTIPLIER, taban × PRICE_CEILING_MULTIPLIER]
 *
 * LLM burada hiçbir şeye karar vermez; yalnızca sonucu Türkçe tek cümleyle açıklar.
 */

export type RevenueFactor = "occupancy" | "lead_time" | "holiday" | "event" | "clamp";

export interface Contribution {
  factor: RevenueFactor;
  label: string;
  multiplier: number;
  amountMinor: number;
}

export interface SuggestionInput {
  baseMinor: number;
  /** Gecenin doluluğu 0..1 ((satılan + tutulan) / toplam). */
  occupancy: number;
  /** Bugünden geceye kalan gün. */
  leadDays: number;
  holiday: string | null;
  events: ReadonlyArray<{ title: string; impact: number }>;
}

export interface RevenueParams {
  floorMultiplier: number;
  ceilingMultiplier: number;
  occupancyTarget: number;
  occupancyWeight: number;
  lastMinuteDays: number;
  lastMinuteDiscountBps: number;
  holidayUpliftBps: number;
  eventFactorPerPoint: number;
}

export interface Suggestion {
  baseMinor: number;
  rawMinor: number;
  suggestedMinor: number;
  floorMinor: number;
  ceilingMinor: number;
  clamped: "floor" | "ceiling" | null;
  contributions: Contribution[];
}

const BPS = 10_000;

export function revenueParams(): RevenueParams {
  const c = getConfig();
  return {
    floorMultiplier: c.PRICE_FLOOR_MULTIPLIER,
    ceilingMultiplier: c.PRICE_CEILING_MULTIPLIER,
    occupancyTarget: c.REVENUE_OCCUPANCY_TARGET,
    occupancyWeight: c.REVENUE_OCCUPANCY_WEIGHT,
    lastMinuteDays: c.REVENUE_LAST_MINUTE_DAYS,
    lastMinuteDiscountBps: c.REVENUE_LAST_MINUTE_DISCOUNT_BPS,
    holidayUpliftBps: c.REVENUE_HOLIDAY_UPLIFT_BPS,
    eventFactorPerPoint: c.EVENT_FACTOR_PER_POINT,
  };
}

function finite(n: number, fallback: number): number {
  return Number.isFinite(n) ? n : fallback;
}

/** Saf öneri: sonuç her girdi için `[floorMinor, ceilingMinor]` aralığındadır. */
export function suggestPrice(
  input: SuggestionInput,
  params: RevenueParams = revenueParams()
): Suggestion {
  const baseMinor = Math.max(0, Math.round(finite(input.baseMinor, 0)));
  const occupancy = Math.min(1, Math.max(0, finite(input.occupancy, 0)));
  const leadDays = Math.max(0, finite(input.leadDays, 0));
  const floorMinor = Math.ceil(baseMinor * Math.min(1, params.floorMultiplier));
  const ceilingMinor = Math.floor(baseMinor * Math.max(1, params.ceilingMultiplier));

  const lastMinute = leadDays <= params.lastMinuteDays && occupancy < params.occupancyTarget;
  const eventPoints = input.events.reduce((s, e) => s + Math.max(0, finite(e.impact, 0)), 0);
  const steps: Array<{ factor: RevenueFactor; label: string; multiplier: number }> = [
    {
      factor: "occupancy",
      label: `Doluluk %${Math.round(occupancy * 100)}`,
      multiplier: 1 + params.occupancyWeight * (occupancy - params.occupancyTarget),
    },
    {
      factor: "lead_time",
      label: lastMinute ? `Son dakika (${leadDays} gün)` : `Varışa ${leadDays} gün`,
      multiplier: lastMinute ? 1 - params.lastMinuteDiscountBps / BPS : 1,
    },
    {
      factor: "holiday",
      label: input.holiday ?? "Resmî tatil yok",
      multiplier: input.holiday ? 1 + params.holidayUpliftBps / BPS : 1,
    },
    {
      factor: "event",
      label:
        input.events.length > 0
          ? input.events.map((e) => `${e.title} (${e.impact})`).join(", ")
          : "Onaylı etkinlik yok",
      multiplier: 1 + eventPoints * params.eventFactorPerPoint,
    },
  ];

  const contributions: Contribution[] = [];
  let running = baseMinor;
  for (const step of steps) {
    const multiplier = Math.max(0, finite(step.multiplier, 1));
    const next = running * multiplier;
    contributions.push({
      factor: step.factor,
      label: step.label,
      multiplier: Math.round(multiplier * BPS) / BPS,
      amountMinor: Math.round(next) - Math.round(running),
    });
    running = next;
  }
  const rawMinor = Math.round(running);
  const suggestedMinor = Math.min(ceilingMinor, Math.max(floorMinor, rawMinor));
  const clamped = rawMinor > ceilingMinor ? "ceiling" : rawMinor < floorMinor ? "floor" : null;
  contributions.push({
    factor: "clamp",
    label:
      clamped === "ceiling"
        ? "Tavan sınırı"
        : clamped === "floor"
          ? "Taban sınırı"
          : "Sınır içinde",
    multiplier: rawMinor === 0 ? 1 : Math.round((suggestedMinor / rawMinor) * BPS) / BPS,
    amountMinor: suggestedMinor - rawMinor,
  });
  return { baseMinor, rawMinor, suggestedMinor, floorMinor, ceilingMinor, clamped, contributions };
}

/** Minor-unit → "1150.00" (ondalık iki basamak; açıklama ve olgu kümesi aynı biçimi kullanır). */
export function majorString(minor: number): string {
  return (minor / 100).toFixed(2);
}

/** Deterministik Türkçe açıklama (LLM yoksa/guard reddederse kullanılan demo cümlesi). */
export function demoRevenueExplanation(input: {
  date: string;
  currency: string;
  currentMinor: number;
  suggestion: Suggestion;
  occupancy: number;
  leadDays: number;
  holiday: string | null;
  eventCount: number;
}): string {
  const s = input.suggestion;
  const direction =
    s.suggestedMinor > input.currentMinor
      ? "artırılması"
      : s.suggestedMinor < input.currentMinor
        ? "düşürülmesi"
        : "korunması";
  const reasons = [`doluluk %${Math.round(input.occupancy * 100)}`, `varışa ${input.leadDays} gün`];
  if (input.holiday) reasons.push(input.holiday);
  if (input.eventCount > 0) reasons.push(`${input.eventCount} onaylı etkinlik`);
  const bound =
    s.clamped === "ceiling"
      ? " (tavan sınırına kırpıldı)"
      : s.clamped === "floor"
        ? " (taban sınırına kırpıldı)"
        : "";
  return `${input.date} gecesi için fiyatın ${majorString(s.suggestedMinor)} ${input.currency} olarak ${direction} öneriliyor${bound}: ${reasons.join(", ")}.`;
}
