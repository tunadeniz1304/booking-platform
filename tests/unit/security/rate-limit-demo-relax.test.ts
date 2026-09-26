import { describe, expect, it } from "vitest";
import { parseAppConfig } from "@/lib/config/app-config";
import { checkRateLimit, rateLimitRelaxFactor } from "@/lib/security/rate-limit";
import { FakeRedis } from "../../helpers/fake-redis";

describe("rate-limit demo/E2E gevşetme çarpanı", () => {
  it("varsayılan 1: üretim limitleri değişmez", () => {
    const config = parseAppConfig({});
    expect(config.RATE_LIMIT_DEMO_RELAX_MULTIPLIER).toBe(1);
    expect(rateLimitRelaxFactor(config, { NODE_ENV: "production" })).toBe(1);
    expect(rateLimitRelaxFactor(config, { DEMO_MODE: "true" })).toBe(1);
  });

  it("yalnızca demo modunda uygulanır; üretimde env verilse bile yok sayılır", () => {
    const config = parseAppConfig({ RATE_LIMIT_DEMO_RELAX_MULTIPLIER: "20" });
    expect(rateLimitRelaxFactor(config, { DEMO_MODE: "true", NODE_ENV: "production" })).toBe(20);
    expect(rateLimitRelaxFactor(config, { NODE_ENV: "production" })).toBe(1);
    expect(rateLimitRelaxFactor(config, { DEMO_MODE: "false", NODE_ENV: "development" })).toBe(1);
  });

  it("geçersiz değer (0, 1000 üstü) varsayılana düşer ve invalidKeys'e yazılır", () => {
    for (const raw of ["0", "5000", "abc"]) {
      const config = parseAppConfig({ RATE_LIMIT_DEMO_RELAX_MULTIPLIER: raw });
      expect(config.RATE_LIMIT_DEMO_RELAX_MULTIPLIER).toBe(1);
      expect(config.invalidKeys).toContain("RATE_LIMIT_DEMO_RELAX_MULTIPLIER");
    }
  });

  it("checkRateLimit: demo modunda limit çarpanla büyür", async () => {
    const prevDemo = process.env.DEMO_MODE;
    process.env.DEMO_MODE = "true";
    try {
      const config = parseAppConfig({
        RATE_LIMIT_DEMO_RELAX_MULTIPLIER: "3",
        RATE_LIMIT_AUTH_MAX: "2",
      });
      const decision = await checkRateLimit(new FakeRedis(), {
        category: "auth",
        identity: "ip:1",
        config,
      });
      expect(decision.limit).toBe(6);
    } finally {
      if (prevDemo === undefined) delete process.env.DEMO_MODE;
      else process.env.DEMO_MODE = prevDemo;
    }
  });
});

describe("LOCK_WAIT_BUDGET_MS", () => {
  it("varsayılan 7500 ms (eski sabit 200 × ~37 ms), sınır dışı değer reddedilir", () => {
    expect(parseAppConfig({}).LOCK_WAIT_BUDGET_MS).toBe(7_500);
    expect(parseAppConfig({ LOCK_WAIT_BUDGET_MS: "2000" }).LOCK_WAIT_BUDGET_MS).toBe(2_000);
    const bad = parseAppConfig({ LOCK_WAIT_BUDGET_MS: "10" });
    expect(bad.LOCK_WAIT_BUDGET_MS).toBe(7_500);
    expect(bad.invalidKeys).toContain("LOCK_WAIT_BUDGET_MS");
  });
});
