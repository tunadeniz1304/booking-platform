import { describe, it, expect } from "vitest";
import {
  scoreSignals,
  decide,
  deviceSignals,
  assessPayment,
  RULE_POINTS,
  FRAUD_DECISIONS,
  type FraudRedis,
} from "@/lib/risk/fraud";
import { binCountry } from "@/lib/risk/bin-table";
import { fingerprintOf, fnv1a } from "@/lib/risk/device-fingerprint";
import { getConfig } from "@/lib/config/app-config";
import { LICENSE_RE } from "@/lib/host/host-service";

const cfg = getConfig();
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

describe("P1-8 fraud v2 kural skoru (kural başına)", () => {
  it("temiz sinyal → allow, skor 0", () => {
    expect(scoreSignals(base, calm)).toEqual({ score: 0, decision: "allow", hits: [] });
  });
  it.each([
    ["velocity_user", {}, { user: cfg.FRAUD_VELOCITY_USER_MAX + 1, ip: 1, card: 1 }, {}],
    ["velocity_ip", {}, { user: 1, ip: cfg.FRAUD_VELOCITY_IP_MAX + 1, card: 1 }, {}],
    ["velocity_card", {}, { user: 1, ip: 1, card: cfg.FRAUD_VELOCITY_CARD_MAX + 1 }, {}],
    [
      "new_account_high_amount",
      {
        accountCreatedAt: new Date(now.getTime() - 3_600_000),
        amountMinor: cfg.FRAUD_HIGH_AMOUNT_MINOR,
      },
      calm,
      {},
    ],
    ["country_mismatch", { ipCountry: "RU", billingCountry: "TR" }, calm, {}],
    ["bin_ip_country_mismatch", { ipCountry: "TR", cardBin: "424242" }, calm, {}],
    ["failed_payments", { recentFailedPayments: 3 }, calm, {}],
    ["new_device", {}, calm, { newDevice: true, accountsOnDevice: 1 }],
    [
      "device_shared",
      {},
      calm,
      { newDevice: false, accountsOnDevice: cfg.FRAUD_DEVICE_MAX_ACCOUNTS + 1 },
    ],
  ] as const)("%s puan ekler ve sebep koduyla açıklanır", (rule, over, vel, dev) => {
    const device = { newDevice: false, accountsOnDevice: 0, ...dev };
    const r = scoreSignals({ ...base, ...over }, vel, device);
    const points = RULE_POINTS[rule];
    expect(r.hits).toEqual([expect.objectContaining({ rule, points })]);
    expect(r.hits[0].detail.length).toBeGreaterThan(0);
    expect(r.score).toBe(points);
  });

  it("BIN ülkesi IP ile aynıysa ya da BIN bilinmiyorsa puan yok", () => {
    expect(scoreSignals({ ...base, ipCountry: "TR", cardBin: "454360" }, calm).hits).toEqual([]);
    expect(scoreSignals({ ...base, ipCountry: "TR", cardBin: "123456" }, calm).hits).toEqual([]);
    expect(scoreSignals({ ...base, cardBin: "424242" }, calm).hits).toEqual([]);
  });

  it("skor 100 ile sınırlanır → deny", () => {
    const r = scoreSignals(
      {
        ...base,
        recentFailedPayments: 5,
        ipCountry: "RU",
        billingCountry: "TR",
        cardBin: "454360",
        accountCreatedAt: now,
        amountMinor: cfg.FRAUD_HIGH_AMOUNT_MINOR,
      },
      { user: 99, ip: 99, card: 99 },
      { newDevice: true, accountsOnDevice: 99 }
    );
    expect(r.score).toBe(100);
    expect(r.decision).toBe("deny");
  });
});

describe("P1-8 karar eşikleri (her dal)", () => {
  const t = {
    FRAUD_CHALLENGE_THRESHOLD: 30,
    FRAUD_STEP_UP_THRESHOLD: 45,
    FRAUD_REVIEW_THRESHOLD: 60,
    FRAUD_BLOCK_THRESHOLD: 80,
  };
  it.each([
    [0, "allow"],
    [29, "allow"],
    [30, "challenge_3ds"],
    [44, "challenge_3ds"],
    [45, "step_up_passkey"],
    [59, "step_up_passkey"],
    [60, "review"],
    [79, "review"],
    [80, "deny"],
    [100, "deny"],
  ] as const)("skor %i → %s", (score, decision) => {
    expect(decide(score, t)).toBe(decision);
  });
  it("tüm kararlar kapsanır ve config eşikleri sıralıdır", () => {
    expect(FRAUD_DECISIONS).toEqual([
      "allow",
      "challenge_3ds",
      "step_up_passkey",
      "review",
      "deny",
    ]);
    expect(cfg.FRAUD_CHALLENGE_THRESHOLD).toBeLessThan(cfg.FRAUD_STEP_UP_THRESHOLD);
    expect(cfg.FRAUD_STEP_UP_THRESHOLD).toBeLessThan(cfg.FRAUD_REVIEW_THRESHOLD);
    expect(cfg.FRAUD_REVIEW_THRESHOLD).toBeLessThan(cfg.FRAUD_BLOCK_THRESHOLD);
  });
  it("varsayılanlarla gerçek kombinasyonlar: country+bin → step-up, +failed → review", () => {
    const stepUp = scoreSignals(
      { ...base, ipCountry: "RU", billingCountry: "TR", cardBin: "454360" },
      calm,
      { newDevice: true, accountsOnDevice: 1 }
    );
    expect(stepUp.score).toBe(50);
    expect(stepUp.decision).toBe("step_up_passkey");
    const challenge = scoreSignals(
      { ...base, recentFailedPayments: 3, cardBin: "424242", ipCountry: "US" },
      calm,
      {
        newDevice: true,
        accountsOnDevice: 1,
      }
    );
    expect(challenge.decision).toBe("challenge_3ds");
    const review = scoreSignals(
      {
        ...base,
        recentFailedPayments: 3,
        ipCountry: "RU",
        billingCountry: "TR",
        cardBin: "454360",
      },
      calm
    );
    expect(review.decision).toBe("review");
  });
});

/** Bellek içi Redis ikizi (yalnızca fraud'un kullandığı komutlar). */
function fakeRedis(fail = false): FraudRedis & { sets: Map<string, Set<string>> } {
  const counters = new Map<string, number>();
  const sets = new Map<string, Set<string>>();
  const guard = () => {
    if (fail) throw new Error("redis down");
  };
  return {
    sets,
    async incrWithTtl(key: string) {
      guard();
      const v = (counters.get(key) ?? 0) + 1;
      counters.set(key, v);
      return v;
    },
    async sadd(key: string, member: string) {
      guard();
      const s = sets.get(key) ?? new Set<string>();
      const had = s.has(member);
      s.add(member);
      sets.set(key, s);
      return had ? 0 : 1;
    },
    async scard(key: string) {
      guard();
      return sets.get(key)?.size ?? 0;
    },
    async expire() {
      guard();
      return 1;
    },
  } as unknown as FraudRedis & { sets: Map<string, Set<string>> };
}

describe("P1-8 cihaz sinyalleri", () => {
  it("ilk cihaz yeni sayılmaz; ikinci farklı cihaz new_device", async () => {
    const r = fakeRedis();
    expect(await deviceSignals(r, "u1", "dev-a")).toEqual({
      newDevice: false,
      accountsOnDevice: 1,
    });
    expect(await deviceSignals(r, "u1", "dev-a")).toEqual({
      newDevice: false,
      accountsOnDevice: 1,
    });
    expect((await deviceSignals(r, "u1", "dev-b")).newDevice).toBe(true);
  });
  it("aynı cihazda çok hesap sayılır", async () => {
    const r = fakeRedis();
    for (const u of ["a", "b", "c", "d"]) await deviceSignals(r, u, "shared");
    expect((await deviceSignals(r, "e", "shared")).accountsOnDevice).toBe(5);
  });
  it("cihaz izi yoksa ya da Redis düşükse fail-open", async () => {
    expect(await deviceSignals(fakeRedis(), "u", null)).toEqual({
      newDevice: false,
      accountsOnDevice: 0,
    });
    expect(await deviceSignals(fakeRedis(true), "u", "d")).toEqual({
      newDevice: false,
      accountsOnDevice: 0,
    });
  });
  it("assessPayment: 'unknown' istemci kovası sayılmaz, Redis hatası puan eklemez", async () => {
    const r = fakeRedis();
    let last;
    for (let i = 0; i < cfg.FRAUD_VELOCITY_IP_MAX + 2; i++) {
      last = await assessPayment(r, {
        ...base,
        userId: `u${i}`,
        cardToken: `c${i}`,
        ip: "unknown",
      });
    }
    expect(last?.hits).toEqual([]);
    expect((await assessPayment(fakeRedis(true), { ...base, deviceId: "x" })).decision).toBe(
      "allow"
    );
  });
  it("assessPayment: hız aşımı velocity_user üretir", async () => {
    const r = fakeRedis();
    let last;
    for (let i = 0; i <= cfg.FRAUD_VELOCITY_USER_MAX; i++) {
      last = await assessPayment(r, { ...base, cardToken: `c${i}`, ip: `10.0.0.${i}` });
    }
    expect(last?.hits.map((h) => h.rule)).toEqual(["velocity_user"]);
  });
});

describe("P1-8 mock BIN tablosu", () => {
  it.each([
    ["424242", "US"],
    ["4543601234", "TR"],
    ["979200", "TR"],
    ["497010", "FR"],
    ["123456", null],
    ["42", null],
  ])("%s → %s", (bin, country) => expect(binCountry(bin)).toBe(country));
});

describe("P1-8 cihaz izi hash'i", () => {
  const traits = {
    screen: "1920x1080x24",
    timeZone: "Europe/Istanbul",
    languages: "tr-TR,en",
    platform: "Win32",
  };
  it("deterministik, 16 hex ve sinyale duyarlı", () => {
    const a = fingerprintOf(traits);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(fingerprintOf({ ...traits })).toBe(a);
    expect(fingerprintOf({ ...traits, timeZone: "Europe/Paris" })).not.toBe(a);
  });
  it("FNV-1a bilinen vektör", () => {
    expect(fnv1a("")).toBe(0x811c9dc5);
    expect(fnv1a("a")).toBe(0xe40c292c);
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
