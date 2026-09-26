// P1-2: bölünmüş ödeme paylaştırması — Σ pay = toplam, negatif pay yok, kalan kuruş organizatöre.
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  allocateCapped,
  allocateMinor,
  resolveSplitAmounts,
  splitEvenly,
  SplitAmountError,
} from "@/lib/money/split";

const total = fc.integer({ min: 0, max: 50_000_000_000 });
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

describe("allocateMinor / splitEvenly (tek yuvarlama kuralı)", () => {
  it("property: Σ = toplam, pay ≥ 0, katılımcı payları floor, fark organizatörde", () => {
    fc.assert(
      fc.property(
        total,
        fc.array(fc.integer({ min: 0, max: 1_000_000 }), { minLength: 1, maxLength: 20 }),
        (t, weights) => {
          fc.pre(weights.some((w) => w > 0));
          const out = allocateMinor(t, weights);
          expect(out).toHaveLength(weights.length);
          expect(sum(out)).toBe(t);
          for (const x of out) expect(x).toBeGreaterThanOrEqual(0);
          const w = sum(weights);
          for (let i = 1; i < out.length; i++) {
            expect(BigInt(out[i])).toBe((BigInt(t) * BigInt(weights[i])) / BigInt(w));
          }
        }
      ),
      { numRuns: 500 }
    );
  });

  it("property: eşit bölmede katılımcılar eşit, organizatör en fazla n−1 kuruş fazla öder", () => {
    fc.assert(
      fc.property(total, fc.integer({ min: 1, max: 20 }), (t, n) => {
        const [org, ...rest] = splitEvenly(t, n);
        expect(org + sum(rest)).toBe(t);
        for (const r of rest) expect(r).toBe(Math.floor(t / n));
        expect(org - Math.floor(t / n)).toBeGreaterThanOrEqual(0);
        expect(org - Math.floor(t / n)).toBeLessThan(n);
      }),
      { numRuns: 500 }
    );
  });

  it("100,00 TL / 3 → 33,34 + 33,33 + 33,33", () => {
    expect(splitEvenly(10_000, 3)).toEqual([3_334, 3_333, 3_333]);
  });

  it("geçersiz girdiler reddedilir", () => {
    expect(() => allocateMinor(-1, [1])).toThrow(RangeError);
    expect(() => allocateMinor(10, [])).toThrow(RangeError);
    expect(() => allocateMinor(10, [0, 0])).toThrow(RangeError);
    expect(() => allocateMinor(1.5, [1])).toThrow(RangeError);
    expect(() => splitEvenly(10, 0)).toThrow(RangeError);
  });
});

describe("resolveSplitAmounts", () => {
  it("eşit: organizatör + katılımcılar, Σ = toplam", () => {
    expect(resolveSplitAmounts(10_001, { mode: "equal", participants: 2 })).toEqual({
      organizer: 3_335,
      participants: [3_333, 3_333],
    });
  });

  it("özel: organizatör kalanı öder (0 olabilir); aşım ve sıfır pay reddedilir", () => {
    expect(resolveSplitAmounts(1_000, { mode: "custom", participantAmounts: [300, 200] })).toEqual({
      organizer: 500,
      participants: [300, 200],
    });
    expect(
      resolveSplitAmounts(1_000, { mode: "custom", participantAmounts: [600, 400] }).organizer
    ).toBe(0);
    expect(() =>
      resolveSplitAmounts(1_000, { mode: "custom", participantAmounts: [600, 401] })
    ).toThrow(SplitAmountError);
    expect(() => resolveSplitAmounts(1_000, { mode: "custom", participantAmounts: [0] })).toThrow(
      SplitAmountError
    );
    expect(() => resolveSplitAmounts(1_000, { mode: "custom", participantAmounts: [] })).toThrow(
      SplitAmountError
    );
    expect(() => resolveSplitAmounts(2, { mode: "equal", participants: 2 })).toThrow(
      SplitAmountError
    );
  });

  it("property: özel tutarlar → Σ = toplam, negatif yok", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 1_000_000 }), { minLength: 1, maxLength: 9 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        (amounts, extra) => {
          const t = sum(amounts) + extra;
          const r = resolveSplitAmounts(t, { mode: "custom", participantAmounts: amounts });
          expect(r.organizer).toBe(extra);
          expect(r.organizer + sum(r.participants)).toBe(t);
        }
      )
    );
  });
});

describe("allocateCapped (iade dağıtımı)", () => {
  it("property: Σ = tutar, 0 ≤ pay ≤ üst sınır", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 5_000_000 }), { minLength: 1, maxLength: 12 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (caps, ratio) => {
          const capacity = sum(caps);
          const amount = Math.floor(capacity * ratio);
          const out = allocateCapped(amount, caps);
          expect(sum(out)).toBe(amount);
          out.forEach((x, i) => {
            expect(x).toBeGreaterThanOrEqual(0);
            expect(x).toBeLessThanOrEqual(caps[i]);
          });
        }
      ),
      { numRuns: 500 }
    );
  });

  it("kapasiteyi aşan tutar reddedilir", () => {
    expect(() => allocateCapped(11, [5, 5])).toThrow(RangeError);
    expect(allocateCapped(0, [5, 5])).toEqual([0, 0]);
  });
});
