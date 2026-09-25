import type { IsoDate } from "@/lib/time/nights";

/**
 * Türkiye resmî tatilleri (P1-5 gelir önerisi için talep sinyali).
 *
 * Sabit tarihli tatiller her yıl aynıdır; dini bayramlar hicri takvime bağlı olduğundan
 * Diyanet takvimine göre yıl yıl listelenir (arefe yarım gün olduğu için dahil değildir).
 * Listede olmayan yıllarda yalnız sabit tatiller döner — öneri yine deterministiktir.
 */

const FIXED: ReadonlyArray<readonly [string, string]> = [
  ["01-01", "Yılbaşı"],
  ["04-23", "Ulusal Egemenlik ve Çocuk Bayramı"],
  ["05-01", "Emek ve Dayanışma Günü"],
  ["05-19", "Atatürk'ü Anma, Gençlik ve Spor Bayramı"],
  ["07-15", "Demokrasi ve Millî Birlik Günü"],
  ["08-30", "Zafer Bayramı"],
  ["10-29", "Cumhuriyet Bayramı"],
];

/** Dini bayramlar: [ilk gün, son gün] (dahil). */
const RELIGIOUS: ReadonlyArray<readonly [string, string, string]> = [
  ["2026-03-20", "2026-03-22", "Ramazan Bayramı"],
  ["2026-05-27", "2026-05-30", "Kurban Bayramı"],
  ["2027-03-09", "2027-03-11", "Ramazan Bayramı"],
  ["2027-05-16", "2027-05-19", "Kurban Bayramı"],
];

/** Gecenin denk geldiği resmî tatilin adı; tatil değilse `null`. */
export function trHolidayOn(date: IsoDate | string): string | null {
  const monthDay = date.slice(5, 10);
  const fixed = FIXED.find(([md]) => md === monthDay);
  if (fixed) return fixed[1];
  const religious = RELIGIOUS.find(([from, to]) => date >= from && date <= to);
  return religious ? religious[2] : null;
}
