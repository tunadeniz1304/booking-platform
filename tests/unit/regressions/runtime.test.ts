import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FakeRedis } from "../../helpers/fake-redis";

const workerCtor = vi.fn();
vi.mock("bullmq", () => ({
  Queue: vi.fn(function Queue(this: { add: unknown }) {
    this.add = vi.fn(async () => ({ id: "1" }));
  }),
  Worker: vi.fn(function Worker() {
    workerCtor();
  }),
}));
vi.mock("@/lib/redis", async () => {
  const { FakeRedis } = await import("../../helpers/fake-redis");
  return { redis: new FakeRedis() };
});

import { redis } from "@/lib/redis";
import {
  getQueryStats,
  installQueryStats,
  isQueryStatsEnabled,
  recordQuery,
  resetQueryStatsForTests,
} from "@/lib/observability/stats";

const fake = redis as unknown as FakeRedis;

describe("regression: #10 kuyruk modülü import anında Worker başlatmaz", () => {
  it("@/lib/queue import edilince Worker oluşturulmaz", async () => {
    await import("@/lib/queue");
    expect(workerCtor).not.toHaveBeenCalled();
  });
});

describe("regression: #18 arama önbelleği KEYS kullanmaz", () => {
  beforeEach(() => {
    fake.calls = [];
    fake.store.clear();
  });

  it("geçersiz kılma sürüm sayacını artırır (O(1)), KEYS çağrılmaz", async () => {
    const { invalidatePropertySearchCache } = await import("@/lib/search");
    await invalidatePropertySearchCache("p1");
    await invalidatePropertySearchCache("p1");
    expect(fake.store.get("search:version")).toBe("2");
    expect(fake.calls).not.toContain("keys");
  });
});

describe("regression: #19 sorgu profil'leyicisi", () => {
  beforeEach(() => resetQueryStatsForTests());

  it("varsayılan KAPALI; yalnızca ENABLE_QUERY_STATS=true açar", () => {
    expect(isQueryStatsEnabled({})).toBe(false);
    expect(isQueryStatsEnabled({ ENABLE_QUERY_STATS: "1" })).toBe(false);
    expect(isQueryStatsEnabled({ ENABLE_QUERY_STATS: "true" })).toBe(true);
  });

  it("aynı istemciye iki kez kurulsa da dinleyici tek (çift sayım yok)", () => {
    const listeners: Array<(e: { query: string; duration: number }) => void> = [];
    const client = {
      $on: (_: "query", cb: (e: { query: string; duration: number }) => void) => listeners.push(cb),
    };
    expect(installQueryStats(client)).toBe(true);
    expect(installQueryStats(client)).toBe(false);
    expect(listeners).toHaveLength(1);
    listeners[0]({ query: 'SELECT * FROM "public"."Booking"', duration: 150 });
    const stats = getQueryStats();
    expect(stats.totalQueries).toBe(1);
    expect(stats.slowQueries).toBe(1);
    expect(stats.queriesByModel).toEqual({ Booking: 1 });
  });

  it("model adı sorgudan çıkarılır", () => {
    recordQuery({ query: 'SELECT 1 FROM "Room" WHERE', duration: 1 });
    expect(getQueryStats().queriesByModel.Room).toBe(1);
  });
});
