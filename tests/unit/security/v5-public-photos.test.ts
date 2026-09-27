import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { FakeRedis } from "../../helpers/fake-redis";

vi.mock("@/lib/redis", async () => {
  const { FakeRedis } = await import("../../helpers/fake-redis");
  return { redis: new FakeRedis() };
});

import { redis } from "@/lib/redis";
import { proxy } from "@/proxy";
import { resetConfigForTests } from "@/lib/config/app-config";
import { isPublicApi } from "@/lib/security/public-routes";
import { categorize } from "@/lib/security/rate-limit";

beforeEach(() => {
  (redis as unknown as FakeRedis).store.clear();
  resetConfigForTests();
});

const anon = (path: string, method = "GET") =>
  proxy(new NextRequest(`http://localhost:3000${path}`, { method }));

describe("regression: v5#7 anonim ziyaretçi ilan fotoğrafını ve herkese açık içgörüleri görür", () => {
  it("GET /api/photos/<id> oturumsuz geçer; yazma metotları public değil", async () => {
    expect((await anon("/api/photos/ph_1")).status).not.toBe(401);
    expect(isPublicApi("/api/photos/ph_1", "GET")).toBe(true);
    expect(isPublicApi("/api/photos/ph_1", "DELETE")).toBe(false);
    expect(isPublicApi("/api/photos/ph_1", "POST")).toBe(false);
  });

  it("fiyat içgörüsü ve karşılaştırma yalnız GET ile public; uygun kovada", async () => {
    expect((await anon("/api/price-insight?roomId=r")).status).not.toBe(401);
    expect((await anon("/api/compare?ids=a,b")).status).not.toBe(401);
    expect(isPublicApi("/api/price-insight", "POST")).toBe(false);
    expect(isPublicApi("/api/compare", "POST")).toBe(false);
    expect(categorize("/api/photos/ph_1")).toBe("search");
    expect(categorize("/api/price-insight")).toBe("search");
    // LLM yorumu üretir → maliyetli `ai` kovası (anonim AI bütçesi route içinde).
    expect(categorize("/api/compare")).toBe("ai");
  });
});
