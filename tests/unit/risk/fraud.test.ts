import { describe, it, expect } from "vitest";
import { scoreSignals, HIGH_AMOUNT_MINOR } from "@/lib/risk/fraud";
import { LICENSE_RE } from "@/lib/host/host-service";

const now = new Date("2026-09-24T12:00:00Z");
const base = {
  userId: "u",
  ip: "1.1.1.1",
  cardToken: "tok_mock_ok_4242",
  amountMinor: 100_000,
  accountCreatedAt: new Date("2025-01-01T00:00:00Z"),
  recentFailedPayments: 0,
  now,
};
const calm = { user: 1, ip: 1, card: 1 };

describe("P1-10 fraud kural skoru (kural başına)", () => {
  it("temiz sinyal → allow, skor 0", () => {
    expect(scoreSignals(base, calm)).toEqual({ score: 0, decision: "allow", hits: [] });
  });
  it.each([
    ["velocity_user", {}, { user: 4, ip: 1, card: 1 }, 25],
    ["velocity_ip", {}, { user: 1, ip: 11, card: 1 }, 20],
    ["velocity_card", {}, { user: 1, ip: 1, card: 6 }, 20],
    [
      "new_account_high_amount",
      { accountCreatedAt: new Date(now.getTime() - 3_600_000), amountMinor: HIGH_AMOUNT_MINOR },
      calm,
      30,
    ],
    ["country_mismatch", { ipCountry: "RU", billingCountry: "TR" }, calm, 20],
    ["failed_payments", { recentFailedPayments: 3 }, calm, 25],
  ] as const)("%s puan ekler ve açıklanır", (rule, over, vel, points) => {
    const r = scoreSignals({ ...base, ...over }, vel);
    expect(r.hits).toEqual([expect.objectContaining({ rule, points })]);
    expect(r.score).toBe(points);
  });
  it("eşikler: ≥40 review (3DS), ≥80 block", () => {
    const review = scoreSignals(
      { ...base, recentFailedPayments: 3, ipCountry: "RU", billingCountry: "TR" },
      calm
    );
    expect(review.decision).toBe("review");
    const block = scoreSignals(
      {
        ...base,
        recentFailedPayments: 5,
        ipCountry: "RU",
        billingCountry: "TR",
        accountCreatedAt: now,
        amountMinor: HIGH_AMOUNT_MINOR,
      },
      { user: 9, ip: 20, card: 9 }
    );
    expect(block.decision).toBe("block");
    expect(block.score).toBe(100);
  });
});

describe("P1-7 belge numarası formatı", () => {
  it.each([
    ["34-12345", true],
    ["07-001", true],
    ["34-0001-2025", true],
    ["99-123", false],
    ["ABC", false],
    ["3412345", false],
  ])("%s → %s", (v, ok) => expect(LICENSE_RE.test(v)).toBe(ok));
});
