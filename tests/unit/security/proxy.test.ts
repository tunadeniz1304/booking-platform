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
    // IP bilinmiyor → sahte XFF'ler aynı parmak izi kovasında toplanır (v3#3).
    expect([...fake.store.keys()].every((k) => k.includes(":anon:"))).toBe(true);
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

describe("regression: v3#3 anonimler tek global kovaya düşmez", () => {
  it("farklı istemciler (UA/dil) ayrı kovalar alır; biri kilitlenince diğeri etkilenmez", async () => {
    const attacker = { "user-agent": "curl/8.0", "accept-language": "en" };
    for (let i = 0; i < 5; i++) {
      await proxy(req("/api/auth/login", { method: "POST", headers: attacker }));
    }
    const blocked = await proxy(req("/api/auth/login", { method: "POST", headers: attacker }));
    expect(blocked.status).toBe(429);
    const victim = await proxy(
      req("/api/auth/login", {
        method: "POST",
        headers: { "user-agent": "Mozilla/5.0 Firefox", "accept-language": "tr-TR" },
      })
    );
    expect(victim.status).not.toBe(429);
    expect([...fake.store.keys()].some((k) => k.includes("unknown"))).toBe(false);
  });

  it("TRUST_REAL_IP_HEADER=true iken x-real-ip anahtar olur", async () => {
    process.env.TRUST_REAL_IP_HEADER = "true";
    resetConfigForTests();
    await proxy(req("/api/search", { headers: { "x-real-ip": "203.0.113.7" } }));
    expect([...fake.store.keys()].some((k) => k.includes("ip:203.0.113.7"))).toBe(true);
    delete process.env.TRUST_REAL_IP_HEADER;
    resetConfigForTests();
  });
});

describe("proxy yetki ve CSRF", () => {
  it("korumalı uç token'sız 401", async () => {
    const res = await proxy(req("/api/bookings", { method: "POST" }));
    expect(res.status).toBe(401);
  });

  it("/api/mcp token'sız: JSON-RPC -32001 gövdesi + WWW-Authenticate (demo senaryosu 5)", async () => {
    const res = await proxy(req("/api/mcp", { method: "POST" }));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe('Bearer realm="booking-mcp"');
    const body = (await res.json()) as { jsonrpc: string; error: { code: number } };
    expect(body.jsonrpc).toBe("2.0");
    expect(body.error.code).toBe(-32001);
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

  it("hedef origin Host başlığından türetilir (0.0.0.0'da dinleyen standalone sunucu)", async () => {
    const { token } = await signAccessToken("u5", "USER", 900);
    const res = await proxy(
      new NextRequest("http://0.0.0.0:3000/api/bookings", {
        method: "POST",
        headers: {
          cookie: `token=${token}`,
          origin: "http://localhost:3000",
          host: "localhost:3000",
        },
      })
    );
    expect(res.status).toBe(200);
    const evil = await proxy(
      new NextRequest("http://0.0.0.0:3000/api/bookings", {
        method: "POST",
        headers: {
          cookie: `token=${token}`,
          origin: "https://evil.example",
          host: "localhost:3000",
        },
      })
    );
    expect(evil.status).toBe(403);
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

  it("Stripe alan adları CSP'ye yalnızca PAYMENT_PROVIDER=stripe iken eklenir", async () => {
    vi.stubEnv("PAYMENT_PROVIDER", "mock");
    const mock = (await proxy(req("/search"))).headers.get("content-security-policy") ?? "";
    expect(mock).not.toContain("stripe.com");
    expect(mock).not.toContain("frame-src");

    vi.stubEnv("PAYMENT_PROVIDER", "stripe");
    const csp = (await proxy(req("/search"))).headers.get("content-security-policy") ?? "";
    vi.unstubAllEnvs();
    expect(csp).toMatch(/script-src [^;]*https:\/\/js\.stripe\.com/);
    expect(csp).toMatch(/connect-src [^;]*https:\/\/api\.stripe\.com/);
    expect(csp).toContain("frame-src https://js.stripe.com https://hooks.stripe.com");
    expect(csp).toContain("frame-ancestors 'none'");
  });
});
