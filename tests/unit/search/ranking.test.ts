import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { rankResults, bayesianRating } from "@/lib/search/ranking";

describe("P1-2 açıklanabilir sıralama", () => {
  const items = [
    { id: "a", price: 3000, ratingAvg: 4.8, ratingCount: 120 },
    { id: "b", price: 1500, ratingAvg: 4.1, ratingCount: 30 },
    { id: "c", price: 2200, ratingAvg: 5.0, ratingCount: 1 },
  ];

  it("aynı girdi → aynı sıra (deterministik), girdi sırasından bağımsız", () => {
    const first = rankResults(items).map((r) => r.id);
    expect(rankResults([...items].reverse()).map((r) => r.id)).toEqual(first);
  });

  it("Bayes düzeltmesi: tek yorumlu 5.0, 120 yorumlu 4.8'i geçemez", () => {
    expect(bayesianRating(5, 1)).toBeLessThan(bayesianRating(4.8, 120));
  });

  it("property: explain bileşenlerinin toplamı skora eşittir, skor [0,1]", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.uuid(),
            price: fc.integer({ min: 100, max: 100_000 }),
            ratingAvg: fc.double({ min: 0, max: 5, noNaN: true }),
            ratingCount: fc.integer({ min: 0, max: 5000 }),
            personal: fc.double({ min: 0, max: 1, noNaN: true }),
            semantic: fc.double({ min: 0, max: 1, noNaN: true }),
          }),
          { minLength: 1, maxLength: 20 }
        ),
        (xs) => {
          for (const r of rankResults(xs)) {
            const sum = Object.values(r.explain).reduce((s, v) => s + v, 0);
            expect(Math.abs(sum - r.score)).toBeLessThan(1e-3);
            expect(r.score).toBeGreaterThanOrEqual(0);
            expect(r.score).toBeLessThanOrEqual(1.0001);
          }
        }
      )
    );
  });
});
