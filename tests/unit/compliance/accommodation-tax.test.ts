import { describe, expect, it } from "vitest";
import {
  accommodationTaxPeriods,
  accommodationTaxRateBps,
} from "@/lib/compliance/accommodation-tax";
import { computeTaxes, taxRulesFor } from "@/lib/pricing/tax";
import { nightsBetween, parseIsoDate } from "@/lib/time/nights";

/**
 * P1-13d — konaklama vergisi oran tarihçesi sınır günleriyle sabitlenir:
 * genel %2; 1 Mayıs–31 Aralık 2026 (dahil) %1.
 */
const ENV = {}; // TAX_RULES_JSON yok → data/tax-rules.json

describe("P1-13d konaklama vergisi oran tarihçesi", () => {
  it.each([
    ["2026-04-30", 200],
    ["2026-05-01", 100],
    ["2026-08-15", 100],
    ["2026-12-31", 100],
    ["2027-01-01", 200],
    ["2025-12-31", 200],
  ])("%s gecesi → %i bps", (date, bps) => {
    expect(accommodationTaxRateBps(date, "Türkiye", ENV)).toBe(bps);
  });

  it("ülke eşlemesi büyük/küçük harf duyarsız; kuralsız ülkede 0", () => {
    expect(accommodationTaxRateBps("2026-06-01", "türkiye", ENV)).toBe(100);
    expect(accommodationTaxRateBps("2026-06-01", "Germany", ENV)).toBe(0);
  });

  it("dönem kırılımı: 2026 boyunca üç dönem, sınırlar dahil", () => {
    expect(accommodationTaxPeriods("2026-04-29", "2027-01-02", "Türkiye", ENV)).toEqual([
      { from: "2026-04-29", to: "2026-04-30", rateBps: 200 },
      { from: "2026-05-01", to: "2026-12-31", rateBps: 100 },
      { from: "2027-01-01", to: "2027-01-02", rateBps: 200 },
    ]);
    expect(() => accommodationTaxPeriods("2020-01-01", "2031-01-01", "Türkiye", ENV)).toThrow(
      RangeError
    );
  });

  it("vergi motoru aynı fonksiyonu kullanır: 30 Nis→2 May konaklaması gece bazında %2 + %1", () => {
    const nights = nightsBetween(parseIsoDate("2026-04-29"), parseIsoDate("2026-05-02"));
    // KDV %10 dahil 110_000 → net 100_000: %2 → 2_000, %1 → 1_000.
    const r = computeTaxes({
      nights: nights.map((date) => ({ date, amount: 110_000 })),
      rules: taxRulesFor("Türkiye", ENV),
      currency: "TRY",
    });
    const acc = r.taxes.find((t) => t.kind === "ACCOMMODATION")!;
    expect(acc.amount).toBe(2_000 + 2_000 + 1_000);
    expect(acc.rateBps).toBeUndefined(); // karışık oran
    for (const date of nights) {
      const single = computeTaxes({
        nights: [{ date, amount: 110_000 }],
        rules: taxRulesFor("Türkiye", ENV),
        currency: "TRY",
      }).taxes.find((t) => t.kind === "ACCOMMODATION")!;
      expect(single.rateBps).toBe(accommodationTaxRateBps(date, "Türkiye", ENV));
    }
  });

  it("yılbaşı sınırı: 31 Ara %1, 1 Oca %2", () => {
    const nights = nightsBetween(parseIsoDate("2026-12-31"), parseIsoDate("2027-01-02"));
    const r = computeTaxes({
      nights: nights.map((date) => ({ date, amount: 110_000 })),
      rules: taxRulesFor("Türkiye", ENV),
      currency: "TRY",
    });
    expect(r.taxes.find((t) => t.kind === "ACCOMMODATION")!.amount).toBe(1_000 + 2_000);
  });
});
