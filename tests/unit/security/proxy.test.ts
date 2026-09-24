import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import type { FakeRedis } from "../../helpers/fake-redis";

vi.mock("@/lib/redis", async () => {
  const { FakeRedis } = await import("../../helpers/fake-redis");
  return { redis: new FakeRedis() };
});

import { redis } from "@/lib/redis";
import { proxy } from "@/proxy";
import { signAccessToken } from "@/lib/auth/tokens";
import { resetConfigForTests } from "@/lib/config/app-config";

const fake = redis as unknown as FakeRedis;

function req(path: string, init: { method?: string; headers?: Record<string, string> } = {}) {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: init.method ?? "GET",
    headers: init.headers,
  });
}

/** NextResponse.next({ request: { headers } }) ile aşağı akışa geçen başlık. */
function forwarded(res: Response, name: string): string | null {
  return res.headers.get(`x-middleware-request-${name}`);
}

beforeEach(() => {
  fake.store.clear();
  fake.failing = false;
  process.env.RATE_LIMIT_SEARCH_MAX = "3";
  process.env.RATE_LIMIT_AUTH_MAX = "2";
  process.env.TRUSTED_PROXY_HOPS = "0";
  resetConfigForTests();
});

describe("regression: #6 kimlik başlığı sahteciliği", () => {
  it("public uçta istemcinin x-user-id / x-user-role başlıkları silinir", async () => {
    const res = await proxy(
      req("/api/search", { headers: { "x-user-id": "victim", "x-user-role": "ADMIN" } })
    );
    expect(res.status).toBe(200);
    expect(forwarded(res, "x-user-id")).toBeNull();
    expect(forwarded(res, "x-user-role")).toBeNull();
  });

  it("doğrulanmış token varsa başlıklar YALNIZCA token'dan yazılır", async () => {
    const { token } = await signAccessToken("real-user", "USER", 900);
    const res = await proxy(
      req("/api/search", {
        headers: {
          authorization: `Bearer ${token}`,
          "x-user-id": "victim",
          "x-user-role": "ADMIN",
        },
      })
    );
    expect(forwarded(res, "x-user-id")).toBe("real-user");
    expect(forwarded(res, "x-user-role")).toBe("USER");
  });
});

describe("regression: #5 rate-limit atlatma", () => {
  it("istemci x-user-id değiştirerek yeni kota alamaz", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await proxy(req("/api/search", { headers: { "x-user-id": `fake-${i}` } }));
      statuses.push(res.status);
    }
    expect(statuses).toEqual([200, 200, 200, 429, 429]);
  });

  it("TRUSTED_PROXY_HOPS=0 iken sahte X-Forwarded-For yeni kota vermez", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await proxy(
        req("/api/search", { headers: { "x-forwarded-for": `10.0.0.${i}` } })
      );
      statuses.push(res.status);
    }
    expect(statuses.at(-1)).toBe(429);
    expect([...fake.store.keys()].every((k) => k.includes("ip:unknown"))).toBe(true);
  });

  it("doğrulanmış kullanıcı kendi kotasını alır (anahtar = JWT sub)", async () => {
    const { token } = await signAccessToken("u1", "USER", 900);
    await proxy(req("/api/search", { headers: { authorization: `Bearer ${token}` } }));
    expect([...fake.store.keys()].some((k) => k.startsWith("rl:search:u:u1:"))).toBe(true);
  });

  it("Redis hatasında hassas uç (auth) fail-closed 503, arama fail-open", async () => {
    fake.failing = true;
    const auth = await proxy(req("/api/auth/login", { method: "POST" }));
    expect(auth.status).toBe(503);
    const search = await proxy(req("/api/search"));
    expect(search.status).toBe(200);
  });
});

describe("proxy yetki ve CSRF", () => {
  it("korumalı uç token'sız 401", async () => {
    const res = await proxy(req("/api/bookings", { method: "POST" }));
    expect(res.status).toBe(401);
  });

  it("çerezli POST farklı Origin'den gelirse 403 (CSRF)", async () => {
    const { token } = await signAccessToken("u2", "USER", 900);
    const res = await proxy(
      req("/api/bookings", {
        method: "POST",
        headers: { cookie: `token=${token}`, origin: "https://evil.example" },
      })
    );
    expect(res.status).toBe(403);
  });

  it("çerezli POST aynı Origin'den geçer; Bearer istemci Origin'siz geçer", async () => {
    const { token } = await signAccessToken("u3", "USER", 900);
    const same = await proxy(
      req("/api/bookings", {
        method: "POST",
        headers: { cookie: `token=${token}`, origin: "http://localhost:3000" },
      })
    );
    expect(same.status).toBe(200);
    const bearer = await proxy(
      req("/api/bookings", { method: "POST", headers: { authorization: `Bearer ${token}` } })
    );
    expect(bearer.status).toBe(200);
  });

  it("regression: #16 logout çerezli GET/cross-site POST ile tetiklenemez", async () => {
    const { token } = await signAccessToken("u4", "USER", 900);
    const res = await proxy(
      req("/api/auth/logout", {
        method: "POST",
        headers: {
          cookie: `token=${token}`,
          "sec-fetch-site": "cross-site",
          origin: "https://x.io",
        },
      })
    );
    expect(res.status).toBe(403);
  });

  it("sayfalara istek başına nonce'lu CSP eklenir", async () => {
    const a = await proxy(req("/search"));
    const b = await proxy(req("/search"));
    const cspA = a.headers.get("content-security-policy") ?? "";
    expect(cspA).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    expect(cspA).toContain("frame-ancestors 'none'");
    expect(cspA).not.toBe(b.headers.get("content-security-policy"));
  });
});
