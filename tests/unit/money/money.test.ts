import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  add,
  allocate,
  formatMoney,
  money,
  MoneyError,
  multiplyRate,
  sum,
  toDecimalString,
  toMinor,
} from "@/lib/money/money";

describe("regression: #20 para — tamsayı minor-unit", () => {
  it("float toplama hatası yok: 0.1 + 0.2 = 0.30", () => {
    const a = money(toMinor("0.1", "TRY"), "TRY");
    const b = money(toMinor("0.2", "TRY"), "TRY");
    expect(toDecimalString(add(a, b))).toBe("0.30");
  });

  it("Decimal string ↔ minor dönüşümü kayıpsız", () => {
    expect(toMinor("1234.5", "TRY")).toBe(123450);
    expect(toMinor("12", "TRY")).toBe(1200);
    expect(toMinor("-0.01", "TRY")).toBe(-1);
    expect(toDecimalString(money(5, "TRY"))).toBe("0.05");
    expect(toDecimalString(money(-123456, "USD"))).toBe("-1234.56");
    expect(() => toMinor("1.234", "TRY")).toThrow(MoneyError);
    expect(toMinor("1.230", "TRY")).toBe(123);
  });

  it("farklı para birimleri toplanamaz, tamsayı olmayan tutar reddedilir", () => {
    expect(() => add(money(1, "TRY"), money(1, "USD"))).toThrow(MoneyError);
    expect(() => money(1.5, "TRY")).toThrow(MoneyError);
    expect(() => money(1, "XYZ")).toThrow(MoneyError);
  });

  it("%1 konaklama vergisi half-up yuvarlanır", () => {
    expect(multiplyRate(money(12345, "TRY"), 0.01).amount).toBe(123); // 123.45 → 123
    expect(multiplyRate(money(12350, "TRY"), 0.01).amount).toBe(124); // 123.5 → 124
    expect(multiplyRate(money(99, "TRY"), 0.01).amount).toBe(1);
  });

  it("biçimlendirme yalnızca gösterim içindir", () => {
    expect(formatMoney(money(123450, "TRY"))).toContain("1.234,50");
  });

  it("property: allocate parçalarının toplamı daima bütüne eşit", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.array(fc.integer({ min: 1, max: 100 }), { minLength: 1, maxLength: 8 }),
        (amount, ratios) => {
          const parts = allocate(money(amount, "TRY"), ratios);
          expect(parts.reduce((s, p) => s + p.amount, 0)).toBe(amount);
          expect(parts.every((p) => Number.isInteger(p.amount) && p.amount >= 0)).toBe(true);
        }
      )
    );
  });

  it("property: toMinor(toDecimalString(x)) = x", () => {
    fc.assert(
      fc.property(fc.integer({ min: -1e12, max: 1e12 }), (amount) => {
        expect(toMinor(toDecimalString(money(amount, "EUR")), "EUR")).toBe(amount);
      })
    );
  });

  it("property: toplama birleşmeli ve sum ile tutarlı", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 1e9 }), { maxLength: 30 }), (xs) => {
        const total = sum(
          xs.map((x) => money(x, "TRY")),
          "TRY"
        );
        expect(total.amount).toBe(xs.reduce((s, x) => s + x, 0));
      })
    );
  });
});
