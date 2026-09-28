import { checkInInstant, type PolicySnapshot } from "@/lib/booking/cancellation";
import { getConfig, type AppConfig } from "@/lib/config/app-config";
import type { IsoDate, PropertyClock } from "@/lib/time/nights";

/** P1-3 RNPL uygunluk ve vade hesabı (saf; ADR 0028). */

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export type RnplUnavailableReason =
  | "DISABLED"
  | "PROVIDER_UNSUPPORTED"
  | "NON_REFUNDABLE"
  | "NO_FREE_CANCELLATION"
  | "TOO_LATE"
  | "CART_BOOKING"
  | "CREDIT_NOT_SUPPORTED"
  | "NOT_PAYABLE";

export type RnplTerms =
  | { available: true; freeCancellationUntil: Date; dueAt: Date }
  | { available: false; reason: RnplUnavailableReason };

/**
 * Ücretsiz iptal süresinin bitişi: %100 iade basamağının en büyük `hoursBefore` değeri kadar
 * check-in anından önce. %100 basamağı yoksa (iade edilemez / kısmi) null.
 */
export function freeCancellationDeadline(
  snapshot: PolicySnapshot,
  checkIn: IsoDate,
  clock: PropertyClock
): Date | null {
  const full = snapshot.rules.tiers.filter((t) => t.refundPercent >= 100);
  if (full.length === 0) return null;
  const hours = Math.max(...full.map((t) => t.hoursBefore));
  return new Date(checkInInstant(checkIn, clock).getTime() - hours * HOUR_MS);
}

/** Saf uygunluk + vade hesabı (config enjekte edilebilir). */
export function rnplTerms(
  input: { refundable: boolean; snapshot: PolicySnapshot; checkIn: IsoDate; clock: PropertyClock },
  now: Date,
  cfg: Pick<
    AppConfig,
    "RNPL_ENABLED" | "RNPL_CHARGE_DAYS_BEFORE_DEADLINE" | "RNPL_MIN_LEAD_HOURS"
  > = getConfig()
): RnplTerms {
  if (!cfg.RNPL_ENABLED) return { available: false, reason: "DISABLED" };
  if (!input.refundable || input.snapshot.kind === "NON_REFUNDABLE") {
    return { available: false, reason: "NON_REFUNDABLE" };
  }
  const deadline = freeCancellationDeadline(input.snapshot, input.checkIn, input.clock);
  if (!deadline) return { available: false, reason: "NO_FREE_CANCELLATION" };
  const dueAt = new Date(deadline.getTime() - cfg.RNPL_CHARGE_DAYS_BEFORE_DEADLINE * DAY_MS);
  if (dueAt.getTime() - now.getTime() < cfg.RNPL_MIN_LEAD_HOURS * HOUR_MS) {
    return { available: false, reason: "TOO_LATE" };
  }
  return { available: true, freeCancellationUntil: deadline, dueAt };
}
