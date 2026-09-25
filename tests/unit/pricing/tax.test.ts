import { afterEach, describe, expect, it } from "vitest";
import fc from "fast-check";
import { resetConfigForTests } from "@/lib/config/app-config";
import {
  computeTaxes,
  loadTaxRules,
  rulesForNight,
  taxRulesFor,
  TaxRuleSchema,
  type TaxRule,
} from "@/lib/pricing/tax";
import type { IsoDate } from "@/lib/time/nights";

const d = (s: string) => s as IsoDate;
const rule = (r: Record<string, unknown>): TaxRule =>
  TaxRuleSchema.parse({ country: "*", label: r.code, ...r });

afterEach(() => {
  delete process.env.SERVICE_FEE_BPS;
  resetConfigForTests();
});

describe("P0-4 vergi motoru — TR varsayılan kuralları", () => {
  const tr = taxRulesFor("Türkiye", {});

  it("KDV %10 dahil: toplamı değiştirmez, net üzerinden konaklama vergisi %2 eklenir", () => {
    const r = computeTaxes({
      nights: [{ date: d("2027-02-01"), amount: 110_000 }],
      rules: tr,
      currency: "TRY",
    });
    const vat = r.taxes.find((t) => t.code === "VAT")!;
    const acc = r.taxes.find((t) => t.code === "ACCOMMODATION_TAX")!;
    expect(vat).toMatchObject({ amount: 10_000, inclusive: true, rateBps: 1000 });
    expect(acc).toMatchObject({ amount: 2_000, inclusive: false, rateBps: 200 });
    expect(r.addOn).toBe(2_000);
  });

  it("tarih aralıklı kural aralıksız kuralı ezer (1 Mayıs–31 Aralık 2026 → %1)", () => {
    expect(
      rulesForNight(tr, d("2026-06-01")).find((x) => x.code === "ACCOMMODATION_TAX")
    ).toMatchObject({ rateBps: 100 });
    expect(
      rulesForNight(tr, d("2026-04-30")).find((x) => x.code === "ACCOMMODATION_TAX")
    ).toMatchObject({ rateBps: 200 });
    const r = computeTaxes({
      nights: [
        { date: d("2026-12-31"), amount: 110_000 },
        { date: d("2027-01-01"), amount: 110_000 },
      ],
      rules: tr,
      currency: "TRY",
    });
    const acc = r.taxes.find((t) => t.code === "ACCOMMODATION_TAX")!;
    expect(acc.amount).toBe(1_000 + 2_000);
    expect(acc.rateBps).toBeUndefined(); // karışık oran → tek oran gösterilmez
  });

  it("ülke eşleşmesi büyük/küçük harf duyarsız; başka ülkede kural yok", () => {
    expect(taxRulesFor("TÜRKİYE", {}).length).toBe(3);
    expect(taxRulesFor("Greece", {})).toEqual([]);
  });
});

describe("P0-4 sabit tutar ve hizmet bedeli", () => {
  it("gece × oda × kişi başına sabit şehir vergisi; para birimi uyuşmazsa uygulanmaz", () => {
    const city = rule({
      code: "CITY",
      kind: "CITY",
      flatMinor: 50,
      perNight: true,
      perGuest: true,
    });
    const nights = [
      { date: d("2027-03-01"), amount: 10_000 },
      { date: d("2027-03-02"), amount: 10_000 },
    ];
    const r = computeTaxes({ nights, rules: [city], currency: "TRY", guests: 3, units: 2 });
    expect(r.addOn).toBe(50 * 2 * 3 * 2);
    const eurOnly = rule({ code: "CITY", kind: "CITY", flatMinor: 50, currency: "EUR" });
    expect(computeTaxes({ nights, rules: [eurOnly], currency: "TRY" }).addOn).toBe(0);
  });

  it("konaklama başına (perNight=false) sabit tutar yalnızca bir kez", () => {
    const once = rule({ code: "CLEAN", kind: "CITY", flatMinor: 3_000 });
    const nights = [1, 2, 3].map((i) => ({ date: d(`2027-03-0${i}`), amount: 10_000 }));
    expect(computeTaxes({ nights, rules: [once], currency: "TRY" }).addOn).toBe(3_000);
  });

  it("SERVICE_FEE_BPS → brüt tutar üzerinden hizmet bedeli (fees'te)", () => {
    process.env.SERVICE_FEE_BPS = "500";
    resetConfigForTests();
    const rules = taxRulesFor("Türkiye", {});
    const r = computeTaxes({
      nights: [{ date: d("2027-02-01"), amount: 110_000 }],
      rules,
      currency: "TRY",
    });
    expect(r.fees).toEqual([
      expect.objectContaining({ code: "SERVICE_FEE", amount: 5_500, inclusive: false }),
    ]);
    expect(r.addOn).toBe(2_000 + 5_500);
  });
});

describe("P0-4 kural kaynağı", () => {
  it("TAX_RULES_JSON varsayılanı tamamen değiştirir (dizi ya da {rules})", () => {
    const json = JSON.stringify([
      { code: "X", country: "*", kind: "CITY", label: "X", flatMinor: 1 },
    ]);
    expect(loadTaxRules({ TAX_RULES_JSON: json }).map((r) => r.code)).toEqual(["X"]);
    expect(loadTaxRules({ TAX_RULES_JSON: JSON.stringify({ rules: [] }) })).toEqual([]);
  });

  it("geçersiz TAX_RULES_JSON → varsayılan kurallar (çökmez)", () => {
    expect(loadTaxRules({ TAX_RULES_JSON: "{bozuk" }).length).toBe(3);
    const bad = JSON.stringify([{ code: "Y", country: "*", kind: "VAT", label: "Y" }]);
    expect(loadTaxRules({ TAX_RULES_JSON: bad }).length).toBe(3);
  });

  it("şema: rateBps xor flatMinor; sabit tutar dahil olamaz", () => {
    const base = { code: "A", country: "*", kind: "CITY", label: "A" };
    expect(TaxRuleSchema.safeParse({ ...base, rateBps: 1, flatMinor: 1 }).success).toBe(false);
    expect(TaxRuleSchema.safeParse({ ...base, flatMinor: 1, inclusive: true }).success).toBe(false);
  });
});

describe("P0-4 özellik: tamsayı, negatif değil, dahil vergi toplamı değiştirmez", () => {
  it("property", () => {
    const tr = taxRulesFor("Türkiye", {});
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 10_000_000 }), { minLength: 1, maxLength: 20 }),
        (amounts) => {
          const nights = amounts.map((amount, i) => ({
            date: d(`2027-01-${String(i + 1).padStart(2, "0")}`),
            amount,
          }));
          const r = computeTaxes({ nights, rules: tr, currency: "TRY" });
          const exclusive = [...r.taxes, ...r.fees].filter((t) => !t.inclusive);
          expect(r.addOn).toBe(exclusive.reduce((s, t) => s + t.amount, 0));
          for (const t of [...r.taxes, ...r.fees]) {
            expect(Number.isSafeInteger(t.amount) && t.amount > 0).toBe(true);
          }
          const vat = r.taxes.find((t) => t.code === "VAT")?.amount ?? 0;
          expect(vat).toBeLessThanOrEqual(amounts.reduce((s, a) => s + a, 0));
        }
      )
    );
  });
});
