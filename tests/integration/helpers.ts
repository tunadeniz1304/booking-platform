import { describe } from "vitest";

/** Docker yoksa entegrasyon suite'ini açık gerekçeyle atlayan `describe`. */
export const describeInt: typeof describe = process.env.INTEGRATION_SKIP_REASON
  ? (describe.skip as typeof describe)
  : describe;

export function todayUtcMidnight(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function utcDay(fromToday: number): Date {
  return addDays(todayUtcMidnight(), fromToday);
}
