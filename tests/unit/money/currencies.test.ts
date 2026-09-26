import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  currencyExponent,
  decimalToMinorHalfUp,
  isIsoCurrency,
  ISO_CURRENCY_EXPONENTS,
  minorToDecimalString,
  roundHalfUp,
} from "@/lib/money/currencies";
import {
  MoneyError,
  minorFromDb,
  minorToDb,
  money,
  moneyFromDb,
  parseMoney,
  toDecimalString,
  toMajorNumber,
  toMinor,
} from "@/lib/money/money";
import { convert } from "@/lib/money/fx";

const safeMinor = fc.integer({ min: -Number.MAX_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER });

describe("ISO 4217 üs tablosu", () => {
  it("bilinen birimlerin üsleri doğrudur", () => {
    expect(currencyExponent("JPY")).toBe(0);
    expect(currencyExponent("VND")).toBe(0);
    expect(currencyExponent("TRY")).toBe(2);
    expect(currencyExponent("EUR")).toBe(2);
    expect(currencyExponent("USD")).toBe(2);
    expect(currencyExponent("GBP")).toBe(2);
    expect(currencyExponent("IDR")).toBe(2);
    expect(currencyExponent("KWD")).toBe(3);
    expect(currencyExponent("BHD")).toBe(3);
  });

  it("bilinmeyen kod reddedilir", () => {
    expect(isIsoCurrency("XYZ")).toBe(false);
    expect(() => currencyExponent("XYZ")).toThrow(RangeError);
    expect(() => money(1, "XYZ")).toThrow(MoneyError);
  });

  it("tablodaki her üs 0, 2, 3 veya 4'tür", () => {
    for (const exp of Object.values(ISO_CURRENCY_EXPONENTS)) {
      expect([0, 2, 3, 4]).toContain(exp);
    }
  });
});

describe("roundHalfUp — tek yuvarlama noktası", () => {
  it("yarım sıfırdan uzağa yuvarlanır (banker's değil)", () => {
    expect(roundHalfUp(5n, 2n)).toBe(3n); // 2.5 → 3 (banker's: 2)
    expect(roundHalfUp(25n, 10n)).toBe(3n);
    expect(roundHalfUp(35n, 10n)).toBe(4n);
    expect(roundHalfUp(-5n, 2n)).toBe(-3n);
    expect(roundHalfUp(24n, 10n)).toBe(2n);
    expect(roundHalfUp(7n, -2n)).toBe(-4n);
    expect(() => roundHalfUp(1n, 0n)).toThrow(RangeError);
  });

  it("property: sonuç gerçek bölüme en fazla yarım uzaklıktadır ve yarımda yukarı gider", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 15n), max: 10n ** 15n }),
        fc.bigInt({ min: 1n, max: 10n ** 6n }),
        (n, d) => {
          const q = roundHalfUp(n, d);
          const diff2 = (n - q * d) * 2n; // 2·(n/d − q)·d
          const abs = diff2 < 0n ? -diff2 : diff2;
          expect(abs <= d).toBe(true);
          if (abs === d) {
            // tam yarım: |q| büyük olan tarafa (sıfırdan uzağa)
            expect(q < 0n ? -q * d >= -n : q * d >= n).toBe(true);
          }
        }
      )
    );
  });
});

describe("minor-unit ⇄ ondalık round-trip (fast-check)", () => {
  it("KWD (3 hane): minor → string → minor değişmez", () => {
    fc.assert(
      fc.property(safeMinor, (amount) => {
        const text = toDecimalString(money(amount, "KWD"));
        expect(text).toMatch(/^-?\d+\.\d{3}$/);
        expect(toMinor(text, "KWD")).toBe(amount);
        expect(decimalToMinorHalfUp(text, "KWD")).toBe(BigInt(amount));
      })
    );
  });

  it("JPY (0 hane): minor → string → minor değişmez, ondalık nokta yok", () => {
    fc.assert(
      fc.property(safeMinor, (amount) => {
        const text = toDecimalString(money(amount, "JPY"));
        expect(text).toMatch(/^-?\d+$/);
        expect(toMinor(text, "JPY")).toBe(amount);
        expect(decimalToMinorHalfUp(text, "JPY")).toBe(BigInt(amount));
      })
    );
  });

  it("BigInt DB kolonu round-trip: minorToDb → minorFromDb", () => {
    fc.assert(
      fc.property(safeMinor, fc.constantFrom("KWD", "JPY", "TRY", "IDR"), (amount, currency) => {
        const stored = minorToDb(amount);
        expect(typeof stored).toBe("bigint");
        expect(moneyFromDb(stored, currency)).toEqual({ amount, currency });
      })
    );
  });

  it("parseMoney KWD'de 3 haneyi kabul eder, 4. haneyi reddeder; JPY'de kesir yok", () => {
    expect(parseMoney("12.345", "KWD").amount).toBe(12345);
    expect(() => parseMoney("12.3456", "KWD")).toThrow(MoneyError);
    expect(parseMoney("1500", "JPY").amount).toBe(1500);
    expect(() => parseMoney("1500.5", "JPY")).toThrow(MoneyError);
  });
});

describe("decimalToMinorHalfUp — eski Decimal kolonları için", () => {
  it("fazla basamak half-up yuvarlanır", () => {
    expect(decimalToMinorHalfUp("1500.50", "JPY")).toBe(1501n);
    expect(decimalToMinorHalfUp("1500.49", "JPY")).toBe(1500n);
    expect(decimalToMinorHalfUp("-1500.50", "JPY")).toBe(-1501n);
    expect(decimalToMinorHalfUp("12.34", "KWD")).toBe(12340n);
    expect(decimalToMinorHalfUp("12.3455", "KWD")).toBe(12346n);
    expect(decimalToMinorHalfUp("1234.5", "TRY")).toBe(123450n);
    expect(() => decimalToMinorHalfUp("1e3", "TRY")).toThrow(RangeError);
  });

  it("minorToDecimalString bigint de kabul eder", () => {
    expect(minorToDecimalString(1234567n, "KWD")).toBe("1234.567");
    expect(minorToDecimalString(-5, "TRY")).toBe("-0.05");
    expect(minorToDecimalString(1500, "JPY")).toBe("1500");
  });
});

describe("DB sınırı ve görüntüleme", () => {
  it("2⁵³ üstü BigInt sessizce kesilmez", () => {
    expect(() => minorFromDb(2n ** 60n)).toThrow(MoneyError);
    expect(() => minorToDb(1.5)).toThrow(MoneyError);
    expect(toMajorNumber(123456n, "TRY")).toBe(1234.56);
    expect(toMajorNumber(1500n, "JPY")).toBe(1500);
  });

  it("BigInt JSON'a güvenli tamsayı olarak yazılır", () => {
    expect(JSON.stringify({ priceMinor: 123n })).toBe('{"priceMinor":123}');
    expect(() => JSON.stringify({ x: 2n ** 60n })).toThrow(MoneyError);
  });

  it("kur çevirisi üs farkını uygular (TRY 2 hane → JPY 0 hane → KWD 3 hane)", () => {
    const table = {
      base: "TRY" as const,
      asOf: "2026-01-01",
      rates: { TRY: 1, JPY: 4, KWD: 0.01 },
    };
    // 100,00 TRY × 4 = 400 JPY
    expect(convert(money(10_000, "TRY"), "JPY", table)).toEqual({ amount: 400, currency: "JPY" });
    // 100,00 TRY × 0,01 = 1,000 KWD
    expect(convert(money(10_000, "TRY"), "KWD", table)).toEqual({ amount: 1000, currency: "KWD" });
    // 400 JPY → 100,00 TRY
    expect(convert(money(400, "JPY"), "TRY", table)).toEqual({ amount: 10_000, currency: "TRY" });
  });
});
