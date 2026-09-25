import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { SignJWT } from "jose";
import bcrypt from "bcryptjs";
import type { FakeRedis } from "../../helpers/fake-redis";

vi.mock("@/lib/redis", async () => {
  const { FakeRedis } = await import("../../helpers/fake-redis");
  return { redis: new FakeRedis() };
});
/** Test içi `User.tokenVersion` tablosu (bump senaryoları için). */
const tokenVersions = vi.hoisted(() => new Map<string, number>());

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id?: string; email?: string } }) =>
        where.id === "u-deleted" || where.email
          ? null
          : {
              id: where.id,
              role: "HOST",
              tokenVersion: tokenVersions.get(where.id ?? "") ?? 0,
              deletedAt: null,
            }
      ),
    },
  },
}));

import { redis } from "@/lib/redis";
import {
  getAuth,
  requireRole,
  signAccessToken,
  verifyAccessToken,
  verifyPasswordConstantTime,
} from "@/lib/auth";
import { getJwtSecret } from "@/lib/auth/tokens";
import { issueSession, revokeSession, rotateRefreshToken } from "@/lib/auth/session";
import * as logoutRoute from "@/app/api/auth/logout/route";
import { POST as login } from "@/app/api/auth/login/route";
import { httpsUrl } from "@/lib/security/url";
import { assertSeedAllowed } from "@/lib/config/seed-guard";
import { selectPaymentProvider } from "@/lib/payment";
import { isLoginCsrfViolation } from "@/lib/security/csrf";

const fake = redis as unknown as FakeRedis;

/** Ortam değişkenlerini geçici olarak değiştirir ve geri yükler. */
function withEnv(vars: Record<string, string>, fn: () => void): void {
  const env = process.env as Record<string, string | undefined>;
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, env[k]]));
  Object.assign(env, vars);
  try {
    fn();
  } finally {
    Object.assign(env, saved);
  }
}

function req(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost:3000/api/x", { headers });
}

beforeEach(() => {
  fake.store.clear();
  fake.failing = false;
});

describe("regression: #16 kimlik doğrulama", () => {
  it("jose ile imzalanan erişim token'ı doğrulanır; rol ve jti taşır", async () => {
    const { token, jti } = await signAccessToken("u1", "HOST", 900);
    const claims = await verifyAccessToken(token);
    expect(claims).toMatchObject({ userId: "u1", role: "HOST", jti });
  });

  it("süresi dolmuş, yanlış tipte veya başka sırla imzalı token reddedilir", async () => {
    const past = Math.floor(Date.now() / 1000) - 10;
    const expired = await new SignJWT({ role: "USER", typ: "access" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("u1")
      .setJti("j")
      .setIssuer("booking-platform")
      .setAudience("booking-platform:api")
      .setExpirationTime(past)
      .sign(getJwtSecret());
    expect(await verifyAccessToken(expired)).toBeNull();

    const wrongType = await new SignJWT({ role: "USER", typ: "refresh" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("u1")
      .setJti("j")
      .setIssuer("booking-platform")
      .setAudience("booking-platform:api")
      .setExpirationTime("5m")
      .sign(getJwtSecret());
    expect(await verifyAccessToken(wrongType)).toBeNull();

    const foreign = await new SignJWT({ role: "ADMIN", typ: "access" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("u1")
      .setJti("j")
      .setIssuer("booking-platform")
      .setAudience("booking-platform:api")
      .setExpirationTime("5m")
      .sign(new TextEncoder().encode("x".repeat(48)));
    expect(await verifyAccessToken(foreign)).toBeNull();
  });

  it("regression: v3#14 erişim token'ı 5 dk ömürlü (varsayılan, kısaltıldı)", async () => {
    const session = await issueSession({ id: "u1", role: "USER" });
    const minutes = (session.accessExpiresAt.getTime() - Date.now()) / 60000;
    expect(minutes).toBeGreaterThan(4);
    expect(minutes).toBeLessThanOrEqual(5);
  });

  it("logout sonrası erişim token'ı iptal listesinde (getAuth null)", async () => {
    const { token } = await signAccessToken("u1", "USER", 900);
    const claims = await getAuth(req({ authorization: `Bearer ${token}` }));
    expect(claims).not.toBeNull();
    await revokeSession({ access: { jti: claims!.jti, exp: claims!.exp } });
    expect(await getAuth(req({ authorization: `Bearer ${token}` }))).toBeNull();
  });

  it("yenileme token'ı döner (rotation); eski token tekrar kullanılırsa aile iptal edilir", async () => {
    const first = await issueSession({ id: "u1", role: "USER" });
    const second = await rotateRefreshToken(first.refreshToken);
    expect(second.refreshToken).not.toBe(first.refreshToken);
    // Rol veritabanından tazelenir (mock: HOST)
    expect(second.user.role).toBe("HOST");

    // Çalınmış eski token tekrar gelir → reddedilir ve aile iptal olur
    await expect(rotateRefreshToken(first.refreshToken)).rejects.toMatchObject({ status: 401 });
    await expect(rotateRefreshToken(second.refreshToken)).rejects.toMatchObject({ status: 401 });
  });

  it("logout yenileme ailesini iptal eder", async () => {
    const s = await issueSession({ id: "u1", role: "USER" });
    await revokeSession({ refreshToken: s.refreshToken });
    await expect(rotateRefreshToken(s.refreshToken)).rejects.toMatchObject({ status: 401 });
  });

  it("logout yalnızca POST (GET export edilmez → 405)", () => {
    expect("POST" in logoutRoute).toBe(true);
    expect("GET" in logoutRoute).toBe(false);
  });

  it("sabit zamanlı giriş: kullanıcı yoksa da bcrypt karşılaştırması yapılır", async () => {
    const spy = vi.spyOn(bcrypt, "compare");
    expect(await verifyPasswordConstantTime("x", null)).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("login: bilinmeyen e-posta ve yanlış parola aynı 401 mesajı", async () => {
    const res = await login(
      new NextRequest("http://localhost:3000/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: "yok@booking.test", password: "x" }),
      }),
      undefined
    );
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("E-posta veya parola hatalı");
  });

  it("requireRole: yok → 401, yanlış rol → 403", async () => {
    await expect(requireRole(req(), ["ADMIN"])).rejects.toMatchObject({ status: 401 });
    const { token } = await signAccessToken("u1", "USER", 900);
    await expect(
      requireRole(req({ authorization: `Bearer ${token}` }), ["HOST", "ADMIN"])
    ).rejects.toMatchObject({ status: 403 });
  });

  it("production'da zayıf JWT_SECRET kabul edilmez", () => {
    withEnv({ NODE_ENV: "production", JWT_SECRET: "change-me" }, () => {
      expect(() => getJwtSecret()).toThrow();
    });
  });

  it("görsel URL'lerinde yalnızca https kabul edilir", () => {
    expect(httpsUrl.safeParse("https://images.unsplash.com/a.jpg").success).toBe(true);
    expect(httpsUrl.safeParse("javascript:alert(1)").success).toBe(false);
    expect(httpsUrl.safeParse("http://x.io/a.jpg").success).toBe(false);
    expect(httpsUrl.safeParse("data:image/png;base64,AAAA").success).toBe(false);
  });
});

describe("regression: v3#11 demo/prod ayrımı", () => {
  it("DEMO_MODE=false iken demo seed reddedilir; production'da açık true gerekir", () => {
    expect(() => assertSeedAllowed({ NODE_ENV: "production" })).toThrow();
    expect(() => assertSeedAllowed({ NODE_ENV: "production", DEMO_MODE: "true" })).not.toThrow();
    expect(() => assertSeedAllowed({ NODE_ENV: "development", DEMO_MODE: "false" })).toThrow();
    expect(() => assertSeedAllowed({ NODE_ENV: "development" })).not.toThrow();
    // Eski bayrak artık seed açmaz.
    expect(() => assertSeedAllowed({ NODE_ENV: "production", DEMO_SEED: "true" })).toThrow();
  });

  it("MockPsp demo dışı ortamda yalnızca açık PAYMENT_PROVIDER=mock ile", () => {
    const prod = { NODE_ENV: "production", DEMO_MODE: "false" };
    expect(() => selectPaymentProvider(prod)).toThrow();
    expect(selectPaymentProvider({ ...prod, PAYMENT_PROVIDER: "mock" })).toBe("mock");
    expect(selectPaymentProvider({ NODE_ENV: "production", DEMO_MODE: "true" })).toBe("mock");
    // stripe seçilip anahtar yoksa sessizce mock'a düşülmez.
    expect(() => selectPaymentProvider({ PAYMENT_PROVIDER: "stripe" })).toThrow();
  });
});

describe("regression: v3#5 tüm oturumların iptali (tokenVersion)", () => {
  it("sürüm artınca eski erişim token'ı reddedilir, yenisi kabul edilir", async () => {
    const { token } = await signAccessToken("u-tv", "USER", 300, 0);
    expect(await getAuth(req({ authorization: `Bearer ${token}` }))).not.toBeNull();
    await fake.set("auth:tv:u-tv", "1");
    expect(await getAuth(req({ authorization: `Bearer ${token}` }))).toBeNull();
    const fresh = await signAccessToken("u-tv", "USER", 300, 1);
    expect(await getAuth(req({ authorization: `Bearer ${fresh.token}` }))).not.toBeNull();
  });

  it("sürüm artınca DİĞER cihazların yenileme token'ı da reddedilir", async () => {
    tokenVersions.set("u-dev", 0);
    const other = await issueSession({ id: "u-dev", role: "USER", tokenVersion: 0 });
    tokenVersions.set("u-dev", 1); // ör. hesap silme / rol değişimi / şifre sıfırlama
    await expect(rotateRefreshToken(other.refreshToken)).rejects.toMatchObject({ status: 401 });
    tokenVersions.delete("u-dev");
  });
});

describe("regression: v3#14 auth sertleştirme", () => {
  it("denylist Redis yokken fail-closed (token reddedilir)", async () => {
    const { token } = await signAccessToken("u-fc", "USER", 300);
    fake.failing = true;
    expect(await getAuth(req({ authorization: `Bearer ${token}` }))).toBeNull();
    fake.failing = false;
  });

  it("login CSRF: çerez yokken de başka origin'den giriş reddedilir", () => {
    const base = {
      method: "POST",
      selfOrigin: "http://localhost:3000",
      hasBearer: false,
      allowedOrigins: [],
    };
    const h = (init: Record<string, string>) => new Headers(init);
    expect(isLoginCsrfViolation({ ...base, headers: h({ origin: "https://evil.example" }) })).toBe(
      true
    );
    expect(isLoginCsrfViolation({ ...base, headers: h({ "sec-fetch-site": "cross-site" }) })).toBe(
      true
    );
    expect(isLoginCsrfViolation({ ...base, headers: h({ origin: "null" }) })).toBe(true);
    expect(isLoginCsrfViolation({ ...base, headers: h({ origin: "http://localhost:3000" }) })).toBe(
      false
    );
    // Tarayıcı dışı istemci (Origin yok) geçer.
    expect(isLoginCsrfViolation({ ...base, headers: h({}) })).toBe(false);
  });
});
