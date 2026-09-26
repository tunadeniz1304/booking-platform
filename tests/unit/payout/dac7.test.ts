import { describe, expect, it } from "vitest";
import {
  assertYear,
  buildDac7Report,
  DAC7_CSV_HEADER,
  toDac7Csv,
  type Dac7Activity,
} from "@/lib/payout/dac7";

const at = (iso: string) => new Date(iso);
const base = { propertyId: "prop_a", activity: true } as const;

/** Sabit girdi: iki ev sahibi, iki para birimi, çeyreklere yayılmış işlemler + bir iade. */
const ACTIVITIES: Dac7Activity[] = [
  {
    ...base,
    hostId: "host_b",
    bookingId: "bk1",
    currency: "TRY",
    occurredAt: at("2026-02-10T12:00:00Z"),
    considerationMinor: 100_000n,
    feeMinor: 15_000n,
    nights: 2,
  },
  {
    ...base,
    hostId: "host_b",
    bookingId: "bk2",
    propertyId: "prop_b",
    currency: "TRY",
    occurredAt: at("2026-05-01T09:00:00Z"),
    considerationMinor: 250_050n,
    feeMinor: 37_508n,
    nights: 5,
  },
  {
    hostId: "host_b",
    bookingId: "bk2",
    propertyId: "prop_b",
    currency: "TRY",
    occurredAt: at("2026-05-20T09:00:00Z"),
    considerationMinor: -50_000n,
    feeMinor: -7_500n,
    activity: false,
    nights: 0,
  },
  {
    ...base,
    hostId: "host_a",
    bookingId: "bk3",
    currency: "EUR",
    occurredAt: at("2026-11-30T23:59:59Z"),
    considerationMinor: 9_999n,
    feeMinor: 1_500n,
    nights: 1,
  },
  // Başka yıl → rapora girmez.
  {
    ...base,
    hostId: "host_a",
    bookingId: "bk4",
    currency: "EUR",
    occurredAt: at("2027-01-01T00:00:00Z"),
    considerationMinor: 1n,
    feeMinor: 0n,
    nights: 1,
  },
];

const SELLERS = new Map([
  ["host_a", { name: "Ayşe Yılmaz" }],
  ["host_b", { name: '=HYPERLINK("x")' }],
]);
const TS = at("2027-01-15T08:00:00Z");

describe("P1-4 DAC7 export", () => {
  it("JSON raporu (snapshot)", () => {
    expect(buildDac7Report(2026, ACTIVITIES, SELLERS, { timestamp: TS })).toMatchSnapshot();
  });

  it("CSV (snapshot) — başlık, CSV enjeksiyonu kaçışı", () => {
    const csv = toDac7Csv(buildDac7Report(2026, ACTIVITIES, SELLERS, { timestamp: TS }));
    expect(csv.split("\n")[0]).toBe(DAC7_CSV_HEADER.join(","));
    expect(csv).toMatchSnapshot();
    expect(csv).not.toMatch(/,=HYPERLINK/);
  });

  it("takma adlı çıktı ad ve kullanıcı kimliği içermez", () => {
    const r = buildDac7Report(2026, ACTIVITIES, SELLERS, { timestamp: TS, pseudonymize: true });
    const text = JSON.stringify(r);
    expect(text).not.toContain("host_a");
    expect(text).not.toContain("Ayşe");
    expect(r.reportableSellers.every((s) => /^seller_[0-9a-f]{16}$/.test(s.sellerRef))).toBe(true);
    expect(r.reportableSellers.every((s) => s.identity.name === null)).toBe(true);
  });

  it("yıl doğrulaması", () => {
    expect(assertYear("2026")).toBe(2026);
    expect(() => assertYear("26")).toThrow();
    expect(() => assertYear(2026.5)).toThrow();
  });
});
