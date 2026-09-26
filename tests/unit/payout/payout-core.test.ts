import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { assertBalanced, escrowReleased, LedgerError, reserveReleased } from "@/lib/ledger";
import { accountCode } from "@/lib/ledger/accounts";
import { computeReleaseSplit, releaseAt } from "@/lib/payout/escrow";
import { scheduleDue } from "@/lib/payout/payout-engine";
import { MockPayoutProvider } from "@/lib/payout/mock-payout";
import { kycFromStripeAccount, StripeConnectPayoutProvider } from "@/lib/payout/stripe-connect";
import { PayoutProviderError } from "@/lib/payout/provider";
import { stripeFake } from "../../support/stripe-fake";

const bps = fc.integer({ min: 0, max: 10_000 });
const amount = fc.bigInt({ min: 0n, max: 10n ** 12n });

describe("P1-4 serbest bırakma bölüşümü", () => {
  it("komisyon + rezerv + ev sahibi = tutar; hepsi negatif değil; half-up", () => {
    fc.assert(
      fc.property(amount, bps, bps, (a, c, r) => {
        const s = computeReleaseSplit(a, c, r);
        expect(s.feeMinor + s.reserveMinor + s.hostNetMinor).toBe(a);
        expect(s.feeMinor >= 0n && s.reserveMinor >= 0n && s.hostNetMinor >= 0n).toBe(true);
        // Komisyon tam oranın yarım birim yakınında.
        const exact = a * BigInt(c);
        expect(s.feeMinor * 10_000n * 2n >= exact * 2n - 10_000n).toBe(true);
        expect(s.feeMinor * 10_000n * 2n <= exact * 2n + 10_000n).toBe(true);
      }),
      { numRuns: 300 }
    );
  });

  it("örnek: 100.000 kuruş, %15 komisyon, %5 rezerv", () => {
    expect(computeReleaseSplit(100_000n, 1500, 500)).toEqual({
      feeMinor: 15_000n,
      reserveMinor: 4_250n,
      hostNetMinor: 80_750n,
    });
    // Yarım yukarı: 3 × %50 = 1,5 → 2
    expect(computeReleaseSplit(3n, 5000, 0).feeMinor).toBe(2n);
  });

  it("geçersiz oran / negatif tutar reddedilir", () => {
    expect(() => computeReleaseSplit(-1n, 0, 0)).toThrow(RangeError);
    expect(() => computeReleaseSplit(1n, 10_001, 0)).toThrow(RangeError);
    expect(() => computeReleaseSplit(1n, 0, 1.5)).toThrow(RangeError);
  });

  it("escrowReleased (rezervli) ve reserveReleased dengeli; alt hesap kodları", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 1n, max: 10n ** 12n }), bps, bps, (a, c, r) => {
        const s = computeReleaseSplit(a, c, r);
        const rel = escrowReleased({
          bookingId: "b1",
          hostId: "h1",
          currency: "TRY",
          amountMinor: a,
          platformFeeMinor: s.feeMinor,
          reserveMinor: s.reserveMinor,
        });
        assertBalanced(rel.lines);
        expect(rel.idempotencyKey).toBe("escrow-released:b1");
        const reserveLine = rel.lines.find((l) => l.account.kind === "HOST_RESERVE");
        expect(reserveLine?.amountMinor ?? 0n).toBe(s.reserveMinor);
        if (s.reserveMinor > 0n) {
          const back = reserveReleased({
            bookingId: "b1",
            hostId: "h1",
            currency: "TRY",
            amountMinor: s.reserveMinor,
          });
          assertBalanced(back.lines);
          expect(back.idempotencyKey).toBe("reserve-released:b1");
        }
      }),
      { numRuns: 200 }
    );
    expect(accountCode({ kind: "HOST_RESERVE", ownerId: "h1" })).toBe("host_reserve:h1");
  });

  it("bölüşüm tutarı aşarsa 422", () => {
    expect(() =>
      escrowReleased({
        bookingId: "b",
        hostId: "h",
        currency: "TRY",
        amountMinor: 100n,
        platformFeeMinor: 60n,
        reserveMinor: 50n,
      })
    ).toThrow(LedgerError);
  });
});

describe("P1-4 zamanlama", () => {
  it("serbest bırakma anı tesisin yerel giriş saatinden + N saat", () => {
    const at = releaseAt(
      new Date("2026-10-10T00:00:00Z"),
      { timeZone: "Europe/Istanbul", checkInTime: "15:00" },
      24
    );
    // 15:00 İstanbul (UTC+3) = 12:00Z; + 24 saat.
    expect(at.toISOString()).toBe("2026-10-11T12:00:00.000Z");
  });

  it("payout takvimi vadesi (UTC)", () => {
    const now = new Date("2026-10-15T10:00:00Z");
    expect(scheduleDue("DAILY", null, now)).toBe(true);
    expect(scheduleDue("DAILY", new Date("2026-10-15T01:00:00Z"), now)).toBe(false);
    expect(scheduleDue("DAILY", new Date("2026-10-14T23:59:00Z"), now)).toBe(true);
    expect(scheduleDue("WEEKLY", new Date("2026-10-09T10:00:00Z"), now)).toBe(false);
    expect(scheduleDue("WEEKLY", new Date("2026-10-08T10:00:00Z"), now)).toBe(true);
    expect(scheduleDue("MONTHLY", new Date("2026-10-01T00:00:00Z"), now)).toBe(false);
    expect(scheduleDue("MONTHLY", new Date("2026-09-30T23:00:00Z"), now)).toBe(true);
  });
});

describe("P1-4 payout sağlayıcıları", () => {
  it("mock: deterministik hesap + eski devir referans biçimi", async () => {
    const p = new MockPayoutProvider();
    const a = await p.createConnectedAccount({ userId: "u1" });
    expect(a.accountRef).toMatch(/^acct_mock_[0-9a-f]{24}$/);
    expect(a).toMatchObject({ kycStatus: "VERIFIED", payoutsEnabled: true });
    expect((await p.createConnectedAccount({ userId: "u1" })).accountRef).toBe(a.accountRef);
    const out = await p.sendPayout({
      idempotencyKey: "payout:x",
      amountMinor: 10n,
      currency: "TRY",
      destination: null,
    });
    expect(out.reference).toMatch(/^po_mock_[0-9a-f]{24}$/);
    await expect(
      p.sendPayout({ idempotencyKey: "k", amountMinor: 0n, currency: "TRY", destination: null })
    ).rejects.toBeInstanceOf(PayoutProviderError);
  });

  it("Stripe hesap alanları → KYC durumu", () => {
    const base = { id: "acct_1", payouts_enabled: false, details_submitted: false };
    expect(kycFromStripeAccount(base).kycStatus).toBe("NOT_STARTED");
    expect(kycFromStripeAccount({ ...base, details_submitted: true }).kycStatus).toBe("PENDING");
    expect(
      kycFromStripeAccount({ ...base, details_submitted: true, payouts_enabled: true })
    ).toEqual({ kycStatus: "VERIFIED", payoutsEnabled: true });
    expect(
      kycFromStripeAccount({ ...base, requirements: { disabled_reason: "rejected.fraud" } })
    ).toEqual({ kycStatus: "REJECTED", payoutsEnabled: false });
  });

  it("Stripe Connect: Express hesap + idempotent transfer (ağsız)", async () => {
    const { fetchImpl, calls } = stripeFake((call) => {
      if (call.method === "POST" && call.path === "/v1/accounts")
        return {
          body: {
            id: "acct_123",
            object: "account",
            payouts_enabled: false,
            details_submitted: false,
          },
        };
      if (call.method === "GET" && call.path === "/v1/accounts/acct_123")
        return {
          body: {
            id: "acct_123",
            object: "account",
            payouts_enabled: true,
            details_submitted: true,
          },
        };
      if (call.method === "POST" && call.path === "/v1/transfers")
        return { body: { id: "tr_1", object: "transfer" } };
      return undefined;
    });
    const p = new StripeConnectPayoutProvider("sk_test_fake", fetchImpl);
    const acct = await p.createConnectedAccount({ userId: "u9", country: "TR" });
    expect(acct).toEqual({
      accountRef: "acct_123",
      kycStatus: "NOT_STARTED",
      payoutsEnabled: false,
    });
    expect(calls[0].body.get("type")).toBe("express");
    expect(calls[0].idempotencyKey).toBe("connect-account:u9");
    expect(await p.getAccountStatus("acct_123")).toEqual({
      kycStatus: "VERIFIED",
      payoutsEnabled: true,
    });
    const out = await p.sendPayout({
      idempotencyKey: "host-payout:p1",
      amountMinor: 12_345n,
      currency: "TRY",
      destination: "acct_123",
    });
    expect(out.reference).toBe("tr_1");
    const tr = calls.find((c) => c.path === "/v1/transfers")!;
    expect(tr.body.get("amount")).toBe("12345");
    expect(tr.body.get("currency")).toBe("try");
    expect(tr.body.get("destination")).toBe("acct_123");
    expect(tr.idempotencyKey).toBe("host-payout:p1");
    await expect(
      p.sendPayout({ idempotencyKey: "k", amountMinor: 1n, currency: "TRY", destination: null })
    ).rejects.toMatchObject({ code: "no_destination" });
    await expect(p.getAccountStatus("acct_missing")).rejects.toBeInstanceOf(PayoutProviderError);
  });
});
