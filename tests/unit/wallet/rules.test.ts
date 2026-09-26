import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  cashbackMinor,
  pickLots,
  splitCreditRefund,
  splitRefund,
  staysToNextTier,
  tierFor,
} from "@/lib/wallet/rules";
import { assertBalanced, creditExpired, creditIssued, creditSpent } from "@/lib/ledger";

const T = [0, 2, 5, 10];

describe("P1-7 sadakat kuralları", () => {
  it("seviye tamamlanan konaklama eşiklerine göre", () => {
    expect([0, 1, 2, 4, 5, 9, 10, 99].map((n) => tierFor(n, T))).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
    expect(staysToNextTier(0, T)).toBe(2);
    expect(staysToNextTier(6, T)).toBe(4);
    expect(staysToNextTier(10, T)).toBeNull();
  });

  it("cashback half-up bps, sınırlı", () => {
    expect(cashbackMinor(10_000, 100, "TRY")).toBe(100);
    expect(cashbackMinor(149, 100, "TRY")).toBe(1); // 1.49 → 1
    expect(cashbackMinor(150, 100, "TRY")).toBe(2); // 1.5 → 2 (half-up)
    expect(cashbackMinor(0, 500, "TRY")).toBe(0);
    expect(cashbackMinor(1000, 20_000, "TRY")).toBe(1000); // en fazla %100
  });
});

describe("P1-7 lot seçimi (FIFO, son kullanma en yakın önce)", () => {
  const d = (n: number) => new Date(Date.UTC(2027, 0, n));
  it("en yakın son kullanma tarihli lot önce, eşitlikte id", () => {
    const lots = [
      { id: "c", remainingMinor: 500, expiresAt: d(20) },
      { id: "b", remainingMinor: 300, expiresAt: d(10) },
      { id: "a", remainingMinor: 200, expiresAt: d(10) },
    ];
    expect(pickLots(lots, 600)).toEqual([
      { id: "a", amountMinor: 200 },
      { id: "b", amountMinor: 300 },
      { id: "c", amountMinor: 100 },
    ]);
    expect(pickLots(lots, 1001)).toBeNull();
    expect(pickLots(lots, 0)).toEqual([]);
  });

  it("property: dağılım toplamı = tutar, hiçbir lot aşılmaz", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({ r: fc.integer({ min: 0, max: 10_000 }), e: fc.integer({ min: 1, max: 28 }) }),
          {
            minLength: 1,
            maxLength: 8,
          }
        ),
        fc.integer({ min: 0, max: 80_000 }),
        (raw, amount) => {
          const lots = raw.map((l, i) => ({ id: `l${i}`, remainingMinor: l.r, expiresAt: d(l.e) }));
          const total = lots.reduce((s, l) => s + l.remainingMinor, 0);
          const picks = pickLots(lots, amount);
          if (amount > total) return picks === null;
          const sum = picks!.reduce((s, p) => s + p.amountMinor, 0);
          return (
            sum === amount &&
            picks!.every(
              (p) =>
                p.amountMinor > 0 &&
                p.amountMinor <= lots.find((l) => l.id === p.id)!.remainingMinor
            )
          );
        }
      ),
      { numRuns: 300 }
    );
  });
});

describe("P1-7 iade simetrisi (kart / kredi)", () => {
  it("tam iade → tam kart + tam kredi; kısmi iade oransal", () => {
    expect(splitRefund(10_000, 7_000, 3_000)).toEqual({ cardMinor: 7_000, creditMinor: 3_000 });
    expect(splitRefund(5_000, 7_000, 3_000)).toEqual({ cardMinor: 3_500, creditMinor: 1_500 });
    expect(splitRefund(1, 7_000, 3_000)).toEqual({ cardMinor: 1, creditMinor: 0 });
    expect(splitRefund(500, 1_000, 0)).toEqual({ cardMinor: 500, creditMinor: 0 });
    expect(splitRefund(0, 1_000, 10)).toEqual({ cardMinor: 0, creditMinor: 0 });
  });

  it("property: parçalar toplamı iadeye eşit, hiçbir parça ödenenini aşmaz", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5_000_000 }),
        fc.integer({ min: 0, max: 5_000_000 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (card, credit, frac) => {
          const refund = Math.floor((card + credit) * frac);
          const p = splitRefund(refund, card, credit);
          return (
            p.cardMinor + p.creditMinor === refund &&
            p.cardMinor >= 0 &&
            p.creditMinor >= 0 &&
            p.cardMinor <= card &&
            p.creditMinor <= credit
          );
        }
      ),
      { numRuns: 500 }
    );
  });

  it("property: kredi iadesi lot dağılımı açık tutarları aşmaz, toplam korunur", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 50_000 }), { minLength: 1, maxLength: 6 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (opens, frac) => {
          const allocs = opens.map((o, i) => ({ id: `a${i}`, openMinor: o }));
          const total = opens.reduce((s, o) => s + o, 0);
          const refund = Math.floor(total * frac);
          const parts = splitCreditRefund(refund, allocs);
          const sum = parts.reduce((s, p) => s + p.amountMinor, 0);
          return (
            sum === refund &&
            parts.every((p) => p.amountMinor <= allocs.find((a) => a.id === p.id)!.openMinor)
          );
        }
      ),
      { numRuns: 500 }
    );
    expect(() => splitCreditRefund(11, [{ id: "a", openMinor: 10 }])).toThrow(RangeError);
  });
});

describe("P1-7 kredi jurnal şablonları", () => {
  it("verme → harcama → süre dolumu dengeli", () => {
    const issued = creditIssued({
      creditRef: "cashback:b1",
      guestId: "u1",
      amountMinor: 1_000n,
      fundedBy: "platform",
      currency: "TRY",
    });
    const spent = creditSpent({
      spendRef: "s1",
      guestId: "u1",
      bookingId: "b2",
      amountMinor: 600n,
      taxMinor: 100n,
      currency: "TRY",
    });
    const expired = creditExpired({
      expiryRef: "lot1:0",
      guestId: "u1",
      amountMinor: 400n,
      currency: "TRY",
    });
    for (const e of [issued, spent, expired]) expect(() => assertBalanced(e.lines)).not.toThrow();
    expect(expired.idempotencyKey).toBe("credit-expired:lot1:0");
    expect(() =>
      creditExpired({ expiryRef: "x", guestId: "u1", amountMinor: 0n, currency: "TRY" })
    ).toThrow();
  });
});
