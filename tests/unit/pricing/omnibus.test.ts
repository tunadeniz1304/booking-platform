import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { lowestPriceInWindow, type PricePoint } from "@/lib/pricing/omnibus";

const DAY = 86_400_000;
const NOW = new Date("2026-10-01T12:00:00Z");

/**
 * Kaba kuvvet kâhini: pencere [now−days, now] içindeki her "ilginç" anda (pencere başı, her
 * değişiklik anı, now) yürürlükteki fiyatı bulur; now'da yürürlükte olan `current`'tır.
 */
function oracle(history: PricePoint[], current: number, now: Date, days: number): number {
  const start = now.getTime() - days * DAY;
  const past = history.filter((p) => p.effectiveAt.getTime() <= now.getTime());
  const priceAt = (t: number): number | null => {
    let best: PricePoint | null = null;
    for (const p of past) {
      if (p.effectiveAt.getTime() <= t && (!best || p.effectiveAt >= best.effectiveAt)) best = p;
    }
    return best ? best.priceMinor : null;
  };
  const instants = [start, ...past.map((p) => p.effectiveAt.getTime()).filter((t) => t > start)];
  const prices = instants.map(priceAt).filter((p): p is number => p !== null);
  return Math.min(current, ...prices);
}

const arbHistory = fc
  .uniqueArray(fc.integer({ min: -90 * 24, max: 5 * 24 }), { maxLength: 25 })
  .chain((hours) =>
    fc.tuple(
      fc.constant(hours.sort((a, b) => a - b)),
      fc.array(fc.integer({ min: 1, max: 1_000_000 }), {
        minLength: hours.length,
        maxLength: hours.length,
      })
    )
  )
  .map(([hours, prices]) =>
    hours.map((h, i) => ({
      effectiveAt: new Date(NOW.getTime() + h * 3_600_000),
      priceMinor: prices[i],
    }))
  );

describe("P1-8 Omnibus: son N gün en düşük fiyat (property)", () => {
  it("kaba kuvvet kâhiniyle aynı; current'ı aşmaz; sıra bağımsız", () => {
    fc.assert(
      fc.property(
        arbHistory,
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 1, max: 60 }),
        (history, fallback, days) => {
          // Şu anki fiyat, now'a kadarki son değişiklikle aynıdır (tetik bunu garanti eder).
          const past = history.filter((p) => p.effectiveAt <= NOW);
          const current = past.length ? past[past.length - 1].priceMinor : fallback;
          const got = lowestPriceInWindow(history, current, NOW, days);
          expect(got).toBe(oracle(history, current, NOW, days));
          expect(got).toBeLessThanOrEqual(current);
          expect(lowestPriceInWindow([...history].reverse(), current, NOW, days)).toBe(got);
        }
      ),
      { numRuns: 500 }
    );
  });

  it("pencere öncesi indirim sayılmaz; pencere başında yürürlükteki fiyat sayılır", () => {
    const at = (daysAgo: number, priceMinor: number): PricePoint => ({
      effectiveAt: new Date(NOW.getTime() - daysAgo * DAY),
      priceMinor,
    });
    // 40 gün önce 500 → 35 gün önce 1000 → 10 gün önce 1200 (şimdi).
    const h = [at(40, 500), at(35, 1000), at(10, 1200)];
    expect(lowestPriceInWindow(h, 1200, NOW, 30)).toBe(1000);
    // Pencere 40 günü kapsarsa 500 (tam başlangıç anında yürürlükte).
    expect(lowestPriceInWindow(h, 1200, NOW, 40)).toBe(500);
    // Gelecekte planlanmış düşük fiyat yok sayılır.
    expect(
      lowestPriceInWindow(
        [...h, { effectiveAt: new Date(NOW.getTime() + DAY), priceMinor: 1 }],
        1200,
        NOW,
        30
      )
    ).toBe(1000);
    // Geçmiş yoksa şimdiki fiyat.
    expect(lowestPriceInWindow([], 777, NOW, 30)).toBe(777);
  });
});
