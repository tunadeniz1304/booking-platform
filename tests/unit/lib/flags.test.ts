import { describe, it, expect, vi, beforeEach } from "vitest";

const createMany = vi.fn();
const outboxCreate = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ experimentExposure: { createMany }, outboxMessage: { create: outboxCreate } }),
  },
}));

import { assignVariant, bucketOf, loadFlags, parseFlags, BUCKETS } from "@/lib/flags/config";
import { getRankingVariant, setFlagsForTests, RANKING_FLAG } from "@/lib/flags";
import { wilson } from "@/lib/flags/stats";

const flag = {
  enabled: true,
  defaultVariant: "ranking.weighted",
  variants: { "ranking.weighted": 50, "ranking.ltr": 50 },
};

describe("P1-3 OpenFeature + A/B", () => {
  beforeEach(async () => {
    createMany.mockReset().mockResolvedValue({ count: 1 });
    outboxCreate.mockReset().mockResolvedValue({});
    await setFlagsForTests(null);
  });

  it("config/flags.json şemaya uyar; hatalı ağırlık/varsayılan reddedilir", () => {
    expect(loadFlags()[RANKING_FLAG].variants).toHaveProperty("ranking.ltr");
    expect(() => parseFlags({ x: { ...flag, variants: { a: 60, b: 60 } } })).toThrow();
    expect(() => parseFlags({ x: { ...flag, defaultVariant: "yok" } })).toThrow();
  });

  it("kovalama deterministik, 0..BUCKETS aralığında ve kabaca dengeli", () => {
    expect(bucketOf(RANKING_FLAG, "user:abc")).toBe(bucketOf(RANKING_FLAG, "user:abc"));
    expect(bucketOf(RANKING_FLAG, "user:abc")).not.toBe(bucketOf("other-flag", "user:abc"));
    const counts: Record<string, number> = {};
    for (let i = 0; i < 4000; i++) {
      const b = bucketOf(RANKING_FLAG, `user:${i}`);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(BUCKETS);
      const v = assignVariant(flag, RANKING_FLAG, `user:${i}`);
      counts[v] = (counts[v] ?? 0) + 1;
    }
    expect(counts["ranking.ltr"] / 4000).toBeGreaterThan(0.45);
    expect(counts["ranking.ltr"] / 4000).toBeLessThan(0.55);
    expect(
      assignVariant({ ...flag, variants: { "ranking.weighted": 100, "ranking.ltr": 0 } }, "f", "s")
    ).toBe("ranking.weighted");
  });

  it("aynı kullanıcı her çağrıda aynı kola düşer; maruziyet + outbox yazılır", async () => {
    const subject = { key: "user:u-42", userId: "u-42" };
    const first = await getRankingVariant(subject);
    for (let i = 0; i < 5; i++)
      expect((await getRankingVariant(subject)).variant).toBe(first.variant);
    expect(first.inExperiment).toBe(true);
    expect(first.variant).toBe(assignVariant(flag, RANKING_FLAG, subject.key));
    expect(createMany).toHaveBeenCalledWith({
      data: [
        { flagKey: RANKING_FLAG, variant: first.variant, subjectId: "user:u-42", userId: "u-42" },
      ],
      skipDuplicates: true,
    });
    expect(outboxCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventType: "experiment.exposure" }),
      })
    );
  });

  it("maruziyet zaten varsa outbox'a tekrar yazılmaz; DB hatası aramayı düşürmez", async () => {
    createMany.mockResolvedValue({ count: 0 });
    await getRankingVariant({ key: "session:s1" });
    expect(outboxCreate).not.toHaveBeenCalled();
    createMany.mockRejectedValue(new Error("db down"));
    await expect(getRankingVariant({ key: "session:s2" })).resolves.toHaveProperty(
      "inExperiment",
      true
    );
  });

  it("bayrak kapalı veya özne yok → v2 (ağırlıklı), maruziyet yok", async () => {
    await setFlagsForTests({ [RANKING_FLAG]: { ...flag, enabled: false } });
    for (let i = 0; i < 20; i++) {
      expect(await getRankingVariant({ key: `user:${i}` })).toEqual({
        variant: "ranking.weighted",
        inExperiment: false,
      });
    }
    expect(await getRankingVariant(null)).toEqual({
      variant: "ranking.weighted",
      inExperiment: false,
    });
    expect(createMany).not.toHaveBeenCalled();
  });

  it("Wilson aralığı: bilinen değer, sınırlar ve n=0", () => {
    const ci = wilson(10, 100);
    expect(ci.low).toBeCloseTo(0.0552, 3);
    expect(ci.high).toBeCloseTo(0.1744, 3);
    expect(wilson(0, 20).low).toBe(0);
    expect(wilson(20, 20).high).toBe(1);
    expect(wilson(0, 0)).toEqual({ low: 0, high: 1 });
  });
});
