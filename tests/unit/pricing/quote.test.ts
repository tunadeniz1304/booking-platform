import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { nightsFromInventory, priceStay, samePrice } from "@/lib/pricing/quote";
import { money, toDecimalString, toMinor } from "@/lib/money/money";
import { TaxRuleSchema, type TaxRule } from "@/lib/pricing/tax";
import { addDays, nightsBetween, parseIsoDate } from "@/lib/time/nights";

/** Hariç (exclusive) konaklama vergisi kuralı. */
const accTax = (rateBps: number): TaxRule[] => [
  TaxRuleSchema.parse({
    code: "ACCOMMODATION_TAX",
    country: "*",
    kind: "ACCOMMODATION",
    label: "Konaklama vergisi",
    rateBps,
  }),
];

/** Veritabanı satırı benzetimi: Decimal fiyat string olarak gelir. */
function rowsFor(start: string, prices: number[]) {
  const first = parseIsoDate(start);
  return prices.map((p, i) => ({
    date: new Date(`${addDays(first, i)}T00:00:00.000Z`),
    priceMinor: BigInt(p),
    total: 1,
    sold: 0,
    held: 0,
  }));
}

describe("regression: #8 gösterilen fiyat = tahsil edilen fiyat", () => {
  it("vergi dahil all-in toplam ve kırılım tutarlı", () => {
    const rows = rowsFor("2026-10-01", [150000, 150000, 180000]);
    const nights = nightsFromInventory(
      rows,
      nightsBetween(parseIsoDate("2026-10-01"), parseIsoDate("2026-10-04")),
      "TRY"
    );
    const q = priceStay({
      nights: nights!,
      modifierMinor: 25000,
      currency: "TRY",
      taxRules: accTax(100),
    });
    expect(q.nights.map((n) => n.amount)).toEqual([175000, 175000, 205000]);
    expect(q.subtotal).toBe(555000);
    expect(q.taxes[0].amount).toBe(5550);
    expect(q.total).toBe(560550);
  });

  it("eksik veya dolu gece → teklif yok (SOLD_OUT)", () => {
    const rows = rowsFor("2026-10-01", [100000, 100000]);
    const stay = nightsBetween(parseIsoDate("2026-10-01"), parseIsoDate("2026-10-04"));
    expect(nightsFromInventory(rows, stay, "TRY")).toBeNull();
    rows[1].sold = 1; // tek odalı tip dolu
    expect(nightsFromInventory(rows, stay.slice(0, 2), "TRY")).toBeNull();
  });

  it("property: kart (arama) = PDP (/api/quote) = checkout (rezervasyon) = tahsilat", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1_000, max: 5_000_000 }), { minLength: 1, maxLength: 30 }),
        fc.integer({ min: 0, max: 500_000 }),
        fc.constantFrom(0, 100, 200, 800),
        (prices, modifier, taxBps) => {
          const stay = nightsBetween(
            parseIsoDate("2026-11-01"),
            addDays(parseIsoDate("2026-11-01"), prices.length)
          );
          const rows = rowsFor("2026-11-01", prices);
          // Arama kartı, PDP teklifi ve rezervasyon işlemi aynı satırlardan aynı fonksiyonu çağırır.
          const card = priceStay({
            nights: nightsFromInventory(rows, stay, "TRY")!,
            modifierMinor: modifier,
            currency: "TRY",
            taxRules: accTax(taxBps),
          });
          const pdp = priceStay({
            nights: nightsFromInventory([...rows].reverse(), stay, "TRY")!,
            modifierMinor: modifier,
            currency: "TRY",
            taxRules: accTax(taxBps),
          });
          const checkout = priceStay({
            nights: nightsFromInventory(rows, stay, "TRY")!,
            modifierMinor: modifier,
            currency: "TRY",
            taxRules: accTax(taxBps),
          });
          expect(samePrice(card, pdp)).toBe(true);
          expect(samePrice(pdp, checkout)).toBe(true);
          // Tahsilat tutarı Decimal'e yazılıp geri okunduğunda da aynı (Payment.amount)
          const paymentAmount = toMinor(toDecimalString(money(checkout.total, "TRY")), "TRY");
          expect(paymentAmount).toBe(card.total);
          // Toplam = geceler + vergi, hepsi tamsayı
          const subtotal = prices.reduce((s, p) => s + p + modifier, 0);
          expect(checkout.subtotal).toBe(subtotal);
          expect(Number.isSafeInteger(checkout.total)).toBe(true);
          expect(checkout.total).toBe(subtotal + checkout.taxes.reduce((s, t) => s + t.amount, 0));
        }
      ),
      { numRuns: 300 }
    );
  });

  it("toFixed yalnızca biçimlendirmede: fiyat modülleri float toplamaz", async () => {
    const { readFileSync } = await import("fs");
    for (const file of [
      "src/lib/pricing/quote.ts",
      "src/lib/booking-service.ts",
      "src/lib/search.ts",
    ]) {
      expect(readFileSync(file, "utf8")).not.toMatch(/\.toFixed\(/);
    }
  });
});

describe("v3 P0-2 oda adedi ve fiyat planı", () => {
  it("birden çok oda: gece başına kalan ≥ adet olmalı; plan farkı bps ile", () => {
    const rows = [
      { date: new Date("2026-10-01T00:00:00Z"), priceMinor: 100000n, total: 5, sold: 3, held: 0 },
      { date: new Date("2026-10-02T00:00:00Z"), priceMinor: 100000n, total: 5, sold: 2, held: 1 },
    ];
    const stay = nightsBetween(parseIsoDate("2026-10-01"), parseIsoDate("2026-10-03"));
    expect(nightsFromInventory(rows, stay, "TRY", 2)).not.toBeNull();
    expect(nightsFromInventory(rows, stay, "TRY", 3)).toBeNull();
    const nights = nightsFromInventory(rows, stay, "TRY", 2)!;
    const nonRef = priceStay({
      nights,
      modifierMinor: 0,
      planModifierBps: -1000,
      units: 2,
      currency: "TRY",
      taxRules: [],
    });
    expect(nonRef.nights.map((n) => n.amount)).toEqual([180000, 180000]); // 2 oda × 900 TL
    expect(nonRef.total).toBe(360000);
  });
});
