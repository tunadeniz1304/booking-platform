import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import type { FakeRedis } from "../../helpers/fake-redis";

vi.mock("@/lib/redis", async () => {
  const { FakeRedis } = await import("../../helpers/fake-redis");
  return { redis: new FakeRedis() };
});

import { redis } from "@/lib/redis";
import { proxy } from "@/proxy";
import { resetConfigForTests, getConfig } from "@/lib/config/app-config";
import { anonymousIdentities, clientKey, ipBucket, resolveClientIp } from "@/lib/security/ip";
import { checkRateLimit, isSensitiveCategory } from "@/lib/security/rate-limit";

const fake = redis as unknown as FakeRedis;
const h = (init: Record<string, string>) => new Headers(init);

function req(path: string, headers: Record<string, string>) {
  return new NextRequest(`http://localhost:3000${path}`, { method: "GET", headers });
}

beforeEach(() => {
  fake.store.clear();
  fake.failing = false;
  process.env.RATE_LIMIT_SEARCH_MAX = "3";
  process.env.RATE_LIMIT_ANON_SHARED_MULTIPLIER = "2";
  process.env.TRUSTED_PROXY_HOPS = "0";
  resetConfigForTests();
});

describe("regression: v4#4 anonim rate-limit / AI bütçesi atlatma", () => {
  it("UA değiştirmek paylaşılan anonim kotayı sıfırlamaz", async () => {
    const statuses: number[] = [];
    // Paylaşılan kova limiti 3 x 2 = 6; her istek farklı UA → ikincil kovalar hep taze.
    for (let i = 0; i < 8; i++) {
      const res = await proxy(req("/api/search", { "user-agent": `bot-${i}` }));
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 6).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(6)).toEqual([429, 429]);
  });

  it("aynı UA ikincil kovada daha erken sınırlanır (UA yalnızca ikincil sinyal)", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      statuses.push((await proxy(req("/api/search", { "user-agent": "same" }))).status);
    }
    expect(statuses).toEqual([200, 200, 200, 429]);
  });

  it("soket IP'si varsa anahtar odur; x-forwarded-for hops=0 iken yok sayılır", () => {
    const headers = h({ "x-forwarded-for": "6.6.6.6", "user-agent": "x" });
    expect(resolveClientIp(headers, 0, "198.51.100.4")).toBe("198.51.100.4");
    expect(clientKey(headers, { trustedProxyHops: 0, socketIp: "198.51.100.4" })).toBe(
      "ip:198.51.100.4"
    );
    expect(anonymousIdentities(headers, { trustedProxyHops: 0 })).toEqual({
      primary: "anon",
      secondary: expect.stringMatching(/^anon:[0-9a-f]{8}$/),
    });
  });

  it("x-forwarded-for yalnızca güvenilir hop'tan okunur", () => {
    const headers = h({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" });
    expect(clientKey(headers, { trustedProxyHops: 1, socketIp: "10.0.0.1" })).toBe(
      "ip:203.0.113.9"
    );
  });

  it("IPv6 adresleri /64 önekine toplulaştırılır", () => {
    expect(ipBucket("2001:db8:1:2:aaaa::1")).toBe("2001:db8:1:2::/64");
    expect(ipBucket("2001:db8:1:2:bbbb:cccc:dddd:eeee")).toBe("2001:db8:1:2::/64");
    expect(ipBucket("2001:DB8:0:0::5")).toBe("2001:db8:0:0::/64");
    expect(ipBucket("::ffff:192.0.2.7")).toBe("192.0.2.7");
    expect(ipBucket("203.0.113.1")).toBe("203.0.113.1");
    const a = clientKey(h({}), { trustedProxyHops: 0, socketIp: "2001:db8:1:2::10" });
    const b = clientKey(h({}), { trustedProxyHops: 0, socketIp: "2001:db8:1:2::ffff" });
    expect(a).toBe(b);
  });

  it("ai kategorisi Redis düşünce fail-closed", async () => {
    expect(isSensitiveCategory("ai")).toBe(true);
    fake.failing = true;
    const decision = await checkRateLimit(fake, {
      category: "ai",
      identity: "anon",
      config: getConfig(),
    });
    expect(decision.allowed).toBe(false);
    expect(decision.unavailable).toBe(true);
  });
});
