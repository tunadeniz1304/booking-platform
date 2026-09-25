import { afterEach, describe, expect, it, vi } from "vitest";
import { resetConfigForTests } from "@/lib/config/app-config";
import {
  classifyPrice,
  conformalQuantile,
  omnibusReferencePrice,
  predictionInterval,
  recordObservation,
  relativeScore,
} from "@/lib/pricing/insight";

/** Deterministik PRNG (mulberry32) — testler her çalışmada aynı veriyi üretir. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller ile standart normal örnek. */
function gaussian(rand: () => number): number {
  const u = 1 - rand();
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const SEED = 20260925;
const NOISE_SD = 0.12;

/** Sentetik oda-gecesi: ŷ = taban fiyat, y = ŷ · (1 + ε) (minor unit, tamsayı). */
function sample(rand: () => number): { predicted: number; actual: number } {
  const predicted = 50_000 + Math.floor(rand() * 150_000);
  const actual = Math.max(1, Math.round(predicted * (1 + NOISE_SD * gaussian(rand))));
  return { predicted, actual };
}

afterEach(() => {
  resetConfigForTests();
});

describe("split conformal fiyat aralığı", () => {
  it("sentetik veride α=0.1 için ampirik kapsama %88–%92 (sabit tohum)", () => {
    const rand = mulberry32(SEED);
    const calibration = Array.from({ length: 2000 }, () => sample(rand));
    const q = conformalQuantile(
      calibration.map((c) => relativeScore(c.actual, c.predicted)),
      0.1
    );
    const TEST_SIZE = 10_000;
    let covered = 0;
    for (let i = 0; i < TEST_SIZE; i++) {
      const { predicted, actual } = sample(rand);
      if (classifyPrice(actual, predictionInterval(predicted, q)) === "typical") covered++;
    }
    const coverage = covered / TEST_SIZE;
    expect(coverage).toBeGreaterThanOrEqual(0.88);
    expect(coverage).toBeLessThanOrEqual(0.92);
  });

  it("kalibrasyon yetersiz → sonsuz eşik ve sınırsız aralık", () => {
    expect(conformalQuantile([0.1, 0.2], 0.1)).toBe(Number.POSITIVE_INFINITY);
    expect(conformalQuantile([], 0.1)).toBe(Number.POSITIVE_INFINITY);
    const interval = predictionInterval(10_000, Number.POSITIVE_INFINITY);
    expect(classifyPrice(1, interval)).toBe("typical");
  });

  it("⌈(n+1)(1−α)⌉. en küçük skor seçilir; geçersiz α reddedilir", () => {
    const scores = Array.from({ length: 19 }, (_, i) => (i + 1) / 100);
    // n=19, α=0.1 → sıra ⌈20·0.9⌉ = 18
    expect(conformalQuantile(scores, 0.1)).toBeCloseTo(0.18, 10);
    expect(() => conformalQuantile(scores, 0)).toThrow(/alpha/);
    expect(() => conformalQuantile(scores, 1)).toThrow(/alpha/);
    expect(() => relativeScore(1, 0)).toThrow();
  });

  it("aralık dışa yuvarlanır ve etiketler sınırlara göre verilir", () => {
    const interval = predictionInterval(10_001, 0.1);
    expect(interval).toEqual({ low: 9_000, high: 11_002 });
    expect(classifyPrice(8_999, interval)).toBe("low");
    expect(classifyPrice(9_000, interval)).toBe("typical");
    expect(classifyPrice(11_002, interval)).toBe("typical");
    expect(classifyPrice(11_003, interval)).toBe("high");
  });
});

describe("Omnibus referans fiyatı", () => {
  const obs = [
    { on: "2026-08-20", total: 5_000 }, // pencere dışı (>30 gün)
    { on: "2026-09-01", total: 9_000 },
    { on: "2026-09-10", total: 8_000 },
    { on: "2026-09-25", total: 7_000 }, // bugün — hariç
  ];

  it("önceki N günün en düşüğü; bugün ve pencere dışı hariç", () => {
    expect(omnibusReferencePrice(obs, "2026-09-25", 30)).toBe(8_000);
    expect(omnibusReferencePrice(obs, "2026-09-25", 10)).toBeNull();
    expect(omnibusReferencePrice([], "2026-09-25", 30)).toBeNull();
  });

  it("aynı gün gözlemi üzerine yazılır, eskiler budanır (idempotent)", () => {
    const once = recordObservation(obs, { on: "2026-09-25", total: 6_500 }, 30);
    const twice = recordObservation(once, { on: "2026-09-25", total: 6_500 }, 30);
    expect(twice).toEqual(once);
    expect(once.map((o) => o.on)).toEqual(["2026-09-01", "2026-09-10", "2026-09-25"]);
    expect(once.at(-1)?.total).toBe(6_500);
  });
});

describe("price-alerts işi", () => {
  it("PRICE_ALERT_CRON deseniyle UTC'de idempotent scheduler kaydeder", async () => {
    const { schedulePriceAlerts, PRICE_ALERT_JOB } = await import("@/worker/jobs/price-alerts");
    const upsertJobScheduler = vi.fn().mockResolvedValue(undefined);
    await schedulePriceAlerts({ upsertJobScheduler } as never);
    expect(upsertJobScheduler).toHaveBeenCalledWith(
      PRICE_ALERT_JOB,
      { pattern: "15 6 * * *", tz: "UTC" },
      expect.objectContaining({ name: PRICE_ALERT_JOB })
    );
  });
});
