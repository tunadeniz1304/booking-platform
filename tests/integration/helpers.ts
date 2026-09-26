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

/**
 * Sabit pencereli sayaçlar (`floor(now / window)` kovası) pencere sınırında sıfırlanır:
 * "N deneme → N+1'inci 429" testi sınırı keserse son deneme yeni kovaya düşer ve flake olur.
 * Mevcut pencerede en az `marginMs` kalana dek bekler (pencere 60 sn, pay 15 sn → ~%25
 * olasılıkla en çok 15 sn bekleme; pencereyi büyütmek beklemeyi pratikte sıfırlar).
 */
export async function awayFromWindowEdge(windowSeconds: number, marginMs = 15_000): Promise<void> {
  const windowMs = windowSeconds * 1000;
  const left = windowMs - (Date.now() % windowMs);
  if (left < marginMs) await new Promise((r) => setTimeout(r, left + 50));
}
