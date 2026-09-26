import { describe, expect, it } from "vitest";
import { parseAppConfig } from "@/lib/config/app-config";
import { includesWeekendNight, scorePartyRisk, type PartyRiskReason } from "@/lib/trust/party-risk";

const cfg = parseAppConfig({});
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
// 2026-10-05 pazartesi; 2026-10-09 cuma; 2026-10-10 cumartesi.
const BOOKED = new Date("2026-10-01T10:00:00.000Z");
const OLD_ACCOUNT = new Date("2025-01-01T00:00:00.000Z");
const NEW_ACCOUNT = new Date("2026-09-25T00:00:00.000Z");

type Row = [
  string,
  { acc: Date; ci: string; co: string; g: number },
  number,
  PartyRiskReason[],
  boolean,
];

// P1-6 parti riski tablo testi: varsayılan ağırlıklar young 20, single 20, group 30, near 20, weekend 10; eşik 60.
const TABLE: Row[] = [
  [
    "eski hesap, hafta içi 3 gece, 2 kişi",
    { acc: OLD_ACCOUNT, ci: "2026-10-05", co: "2026-10-08", g: 2 },
    0,
    [],
    false,
  ],
  [
    "genç hesap tek başına",
    { acc: NEW_ACCOUNT, ci: "2026-10-05", co: "2026-10-08", g: 2 },
    20,
    ["YOUNG_ACCOUNT"],
    false,
  ],
  [
    "tek gece hafta içi",
    { acc: OLD_ACCOUNT, ci: "2026-10-06", co: "2026-10-07", g: 2 },
    20,
    ["SINGLE_NIGHT"],
    false,
  ],
  [
    "büyük grup (6)",
    { acc: OLD_ACCOUNT, ci: "2026-10-05", co: "2026-10-08", g: 6 },
    30,
    ["LARGE_GROUP"],
    false,
  ],
  [
    "5 kişi büyük grup değil",
    { acc: OLD_ACCOUNT, ci: "2026-10-05", co: "2026-10-08", g: 5 },
    0,
    [],
    false,
  ],
  [
    "yakın tarih (ertesi gün)",
    { acc: OLD_ACCOUNT, ci: "2026-10-02", co: "2026-10-03", g: 2 },
    50,
    ["NEAR_DATE", "SINGLE_NIGHT", "WEEKEND"],
    false,
  ],
  [
    "2 gün sonrası yakın değil",
    { acc: OLD_ACCOUNT, ci: "2026-10-03", co: "2026-10-05", g: 2 },
    10,
    ["WEEKEND"],
    false,
  ],
  [
    "cuma tek gece + büyük grup + genç hesap",
    { acc: NEW_ACCOUNT, ci: "2026-10-09", co: "2026-10-10", g: 8 },
    80,
    ["LARGE_GROUP", "SINGLE_NIGHT", "YOUNG_ACCOUNT", "WEEKEND"],
    true,
  ],
  [
    "tam eşik (60): genç + tek gece + yakın",
    { acc: NEW_ACCOUNT, ci: "2026-10-01", co: "2026-10-02", g: 2 },
    60,
    ["NEAR_DATE", "SINGLE_NIGHT", "YOUNG_ACCOUNT"],
    true,
  ],
  [
    "hepsi → 100",
    { acc: NEW_ACCOUNT, ci: "2026-10-02", co: "2026-10-03", g: 10 },
    100,
    ["LARGE_GROUP", "NEAR_DATE", "SINGLE_NIGHT", "YOUNG_ACCOUNT", "WEEKEND"],
    true,
  ],
];

describe("P1-6 parti riski skoru (tablo)", () => {
  it.each(TABLE)("%s", (_name, i, score, reasons, flagged) => {
    const r = scorePartyRisk(
      {
        accountCreatedAt: i.acc,
        bookedAt: BOOKED,
        checkIn: d(i.ci),
        checkOut: d(i.co),
        guestCount: i.g,
      },
      cfg
    );
    expect(r.score).toBe(score);
    expect(r.reasons).toEqual(reasons);
    expect(r.flagged).toBe(flagged);
    // Açıklanabilirlik: skor = katkıların toplamı (100 ile sınırlı).
    expect(
      Math.min(
        100,
        r.contributions.reduce((s, c) => s + c.weight, 0)
      )
    ).toBe(score);
  });

  it("ağırlıklar ve eşikler config'ten (0 ağırlık gerekçe üretmez)", () => {
    const custom = parseAppConfig({
      PARTY_RISK_WEIGHT_WEEKEND: "0",
      PARTY_RISK_LARGE_GROUP_MIN: "4",
      PARTY_RISK_THRESHOLD: "30",
    });
    const r = scorePartyRisk(
      {
        accountCreatedAt: OLD_ACCOUNT,
        bookedAt: BOOKED,
        checkIn: d("2026-10-09"),
        checkOut: d("2026-10-11"),
        guestCount: 4,
      },
      custom
    );
    expect(r.reasons).toEqual(["LARGE_GROUP"]);
    expect(r.flagged).toBe(true);
  });

  it("hafta sonu gecesi: cuma/cumartesi gecesi; pazar gecesi sayılmaz", () => {
    expect(includesWeekendNight(d("2026-10-09"), d("2026-10-10"))).toBe(true);
    expect(includesWeekendNight(d("2026-10-10"), d("2026-10-11"))).toBe(true);
    expect(includesWeekendNight(d("2026-10-11"), d("2026-10-12"))).toBe(false);
    expect(includesWeekendNight(d("2026-10-05"), d("2026-10-09"))).toBe(false);
  });
});
