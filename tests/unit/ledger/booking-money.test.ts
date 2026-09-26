import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  assertBalanced,
  bookingCaptured,
  refundIssued,
  refundTaxMinor,
  taxShareMinor,
  type JournalInput,
} from "@/lib/ledger";

const breakdown = (taxes: number[], total: number) => ({
  taxes: taxes.map((amount) => ({ amount })),
  total,
});

/** Hesap kodu başına net (borç +, alacak −). */
function net(entries: JournalInput[]): Map<string, bigint> {
  const out = new Map<string, bigint>();
  for (const e of entries) {
    for (const l of e.lines) {
      const code = l.account.ownerId ? `${l.account.kind}:${l.account.ownerId}` : l.account.kind;
      const signed = l.side === "DEBIT" ? l.amountMinor : -l.amountMinor;
      out.set(code, (out.get(code) ?? 0n) + signed);
    }
  }
  return out;
}

describe("F2c booking-money: vergi payı + iade bölüşümü", () => {
  it("taxShareMinor: aynı para biriminde tam Σvergi; kur çevriminde oransal; bozuk girdi 0", () => {
    expect(taxShareMinor(breakdown([1000, 200], 11200), 11200n)).toBe(1200n);
    expect(taxShareMinor(breakdown([1000], 11000), 5500n)).toBe(500n);
    expect(taxShareMinor(null, 100n)).toBe(0n);
    expect(taxShareMinor({ taxes: "x" }, 100n)).toBe(0n);
    expect(taxShareMinor(breakdown([1.5, -3], 100), 100n)).toBe(0n);
    expect(taxShareMinor(breakdown([10], 0), 100n)).toBe(0n);
    expect(taxShareMinor(breakdown([10], 100), 0n)).toBe(0n);
    // Vergi toplamı kırılım toplamını aşsa bile tahsilatı aşmaz.
    expect(taxShareMinor(breakdown([500], 100), 100n)).toBe(100n);
  });

  it("property: parça parça iadeler → her jurnal dengeli, tam iadede emanet ve vergi sıfır", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10_000_000 }),
        fc.integer({ min: 0, max: 5000 }),
        fc.array(fc.integer({ min: 1, max: 1000 }), { minLength: 1, maxLength: 6 }),
        (grossNum, taxBps, weights) => {
          const gross = BigInt(grossNum);
          const bd = breakdown([Math.floor((grossNum * taxBps) / 10_000)], grossNum);
          const tax = taxShareMinor(bd, gross);
          const entries: JournalInput[] = [
            bookingCaptured({
              bookingId: "b",
              paymentId: "p",
              currency: "TRY",
              grossMinor: gross,
              taxMinor: tax,
            }),
          ];
          // Ağırlıklara göre tüm brütü parçalara böl (son parça kalanı alır).
          const sum = weights.reduce((a, b) => a + b, 0);
          let before = 0n;
          weights.forEach((w, i) => {
            const part =
              i === weights.length - 1 ? gross - before : (gross * BigInt(w)) / BigInt(sum);
            if (part <= 0n) return;
            entries.push(
              refundIssued({
                refundRef: `r${i}`,
                bookingId: "b",
                paymentId: "p",
                guestId: "g",
                currency: "TRY",
                amountMinor: part,
                taxMinor: refundTaxMinor(tax, gross, before, part),
                from: "escrow",
              })
            );
            before += part;
          });
          for (const e of entries) assertBalanced(e.lines);
          const n = net(entries);
          expect(n.get("PSP_CLEARING") ?? 0n).toBe(0n);
          expect(n.get("ESCROW") ?? 0n).toBe(0n);
          expect(n.get("TAX_PAYABLE") ?? 0n).toBe(0n);
        }
      ),
      { numRuns: 300 }
    );
  });

  it("refundTaxMinor: vergisiz / sıfır brüt → 0; tavan brüt", () => {
    expect(refundTaxMinor(0n, 100n, 0n, 50n)).toBe(0n);
    expect(refundTaxMinor(10n, 0n, 0n, 50n)).toBe(0n);
    expect(refundTaxMinor(10n, 100n, 90n, 50n)).toBe(1n);
  });
});
