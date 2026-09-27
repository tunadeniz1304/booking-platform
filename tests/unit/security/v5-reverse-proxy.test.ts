import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import type { FakeRedis } from "../../helpers/fake-redis";

vi.mock("@/lib/redis", async () => {
  const { FakeRedis } = await import("../../helpers/fake-redis");
  return { redis: new FakeRedis() };
});
vi.mock("@/lib/observability/readiness", () => ({
  checkReadiness: vi.fn(async () => ({
    ready: true,
    checks: { database: { ok: true, latencyMs: 1 }, redis: { ok: true, latencyMs: 1 } },
  })),
}));

import { redis } from "@/lib/redis";
import { proxy } from "@/proxy";
import { resetConfigForTests } from "@/lib/config/app-config";
import { GET as readyRoute } from "@/app/api/ready/route";
import { AUTH_DEGRADED_HEADER, enforceDegradedAuth } from "@/lib/security/auth-degraded";
import { directExposureProblem, logDirectExposureStartup } from "@/lib/security/exposure";
import { logger } from "@/lib/observability/logger";

const fake = redis as unknown as FakeRedis;

function req(path: string, init: { method?: string; headers?: Record<string, string> } = {}) {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: init.method ?? "GET",
    headers: init.headers,
  });
}

const forwarded = (res: Response, name: string) => res.headers.get(`x-middleware-request-${name}`);

beforeEach(() => {
  fake.store.clear();
  fake.failing = false;
  vi.stubEnv("RATE_LIMIT_SEARCH_MAX", "1");
  vi.stubEnv("RATE_LIMIT_AUTH_MAX", "2");
  vi.stubEnv("RATE_LIMIT_ANON_SHARED_MULTIPLIER", "1");
  resetConfigForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  resetConfigForTests();
});

describe("regression: v5#6 ters vekil ve istemci IP'si", () => {
  it("hops=1 + X-Forwarded-For: iki istemci ayrı kovada", async () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
    resetConfigForTests();
    const a = { "x-forwarded-for": "198.51.100.10" };
    const b = { "x-forwarded-for": "198.51.100.20" };
    expect((await proxy(req("/api/search", { headers: a }))).status).toBe(200);
    expect((await proxy(req("/api/search", { headers: a }))).status).toBe(429);
    expect((await proxy(req("/api/search", { headers: b }))).status).toBe(200);
  });

  it("üretimde hops=0 ve ALLOW_DIRECT_EXPOSURE yoksa /api/ready 503; izinle 200", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEMO_MODE", "false");
    vi.stubEnv("TRUSTED_PROXY_HOPS", "0");
    resetConfigForTests();
    expect(directExposureProblem()).toBeTruthy();
    const res = await readyRoute();
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ready: false, code: "DIRECT_EXPOSURE_UNSAFE" });

    const error = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    expect(logDirectExposureStartup()).toBe(true);
    expect(error).toHaveBeenCalledTimes(1);

    vi.stubEnv("ALLOW_DIRECT_EXPOSURE", "true");
    resetConfigForTests();
    expect(directExposureProblem()).toBeNull();
    expect((await readyRoute()).status).toBe(200);

    // Önde ters vekil (hops=1) ya da demo modu → sorun yok.
    vi.stubEnv("ALLOW_DIRECT_EXPOSURE", "");
    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
    resetConfigForTests();
    expect(directExposureProblem()).toBeNull();
    vi.stubEnv("TRUSTED_PROXY_HOPS", "0");
    vi.stubEnv("DEMO_MODE", "true");
    resetConfigForTests();
    expect(directExposureProblem()).toBeNull();
  });

  it("auth: paylaşılan kova tükenince yeni istemci 429 değil, yavaşlatılmış yola düşer", async () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "0");
    resetConfigForTests();
    const attacker = { "user-agent": "flood/1", "accept-language": "en" };
    for (let i = 0; i < 2; i++) {
      await proxy(req("/api/auth/login", { method: "POST", headers: attacker }));
    }
    // Saldırgan kendi (parmak izi) kovasında hâlâ 429 alır.
    expect(
      (await proxy(req("/api/auth/login", { method: "POST", headers: attacker }))).status
    ).toBe(429);
    // Kurban: paylaşılan kova dolu ama kendi kovası boş → geçer, route'a işaret iner.
    const victim = await proxy(
      req("/api/auth/login", {
        method: "POST",
        headers: { "user-agent": "Mozilla/5.0", "accept-language": "tr-TR" },
      })
    );
    expect(victim.status).toBe(200);
    expect(forwarded(victim, AUTH_DEGRADED_HEADER)).toBe("1");
  });

  it("istemcinin gönderdiği bozulma işareti silinir", async () => {
    const res = await proxy(
      req("/api/auth/login", { method: "POST", headers: { [AUTH_DEGRADED_HEADER]: "1" } })
    );
    expect(forwarded(res, AUTH_DEGRADED_HEADER)).toBeNull();
  });

  it("yavaşlatılmış yol: e-posta anahtarlı ikincil kova + PoW", async () => {
    const headers = new Headers({ [AUTH_DEGRADED_HEADER]: "1" });
    await expect(
      enforceDegradedAuth({ headers }, { email: "a@t.test", pow: null })
    ).rejects.toMatchObject({ status: 429, code: "POW_REQUIRED" });
    await expect(
      enforceDegradedAuth({ headers }, { email: "a@t.test", pow: null })
    ).rejects.toMatchObject({ status: 429, code: "POW_REQUIRED" });
    // Kova (RATE_LIMIT_AUTH_MAX=2) aşıldı → PoW'dan önce e-posta sınırı.
    await expect(
      enforceDegradedAuth({ headers }, { email: "A@t.test", pow: null })
    ).rejects.toMatchObject({ status: 429, code: "RATE_LIMITED" });
    // Başka e-posta etkilenmez; işaret yoksa hiçbir şey yapılmaz.
    await expect(
      enforceDegradedAuth({ headers }, { email: "b@t.test", pow: null })
    ).rejects.toMatchObject({ code: "POW_REQUIRED" });
    await expect(
      enforceDegradedAuth({ headers: new Headers() }, { email: "a@t.test", pow: null })
    ).resolves.toBeUndefined();
  });
});

describe("regression: v5#6 compose: uygulama yalnız Caddy arkasında", () => {
  const read = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");
  it("app host'a port açmaz, Caddy yayımlar, TRUSTED_PROXY_HOPS=1; Caddy XFF'yi soketten yazar", () => {
    const compose = read("docker-compose.yml");
    const appBlock = compose.slice(compose.indexOf("\n  app:"), compose.indexOf("\n  caddy:"));
    expect(appBlock).not.toMatch(/ports:/);
    const caddyBlock = compose.slice(compose.indexOf("\n  caddy:"), compose.indexOf("\n  worker:"));
    expect(caddyBlock).toMatch(/ports:/);
    expect(caddyBlock).toMatch(/docker\/Caddyfile/);
    const common = compose.slice(compose.indexOf("x-common-env"), compose.indexOf("x-app-env"));
    expect(common).toMatch(/TRUSTED_PROXY_HOPS: "1"/);
    const caddyfile = read("docker/Caddyfile");
    expect(caddyfile).toMatch(/reverse_proxy app:3000/);
    expect(caddyfile).toMatch(/header_up X-Forwarded-For \{remote_host\}/);
  });
});
