import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { SignJWT } from "jose";
import bcrypt from "bcryptjs";
import type { FakeRedis } from "../../helpers/fake-redis";

vi.mock("@/lib/redis", async () => {
  const { FakeRedis } = await import("../../helpers/fake-redis");
  return { redis: new FakeRedis() };
});
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id?: string; email?: string } }) =>
        where.id === "u-deleted" || where.email ? null : { id: where.id, role: "HOST" }
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

  it("erişim token'ı 15 dk ömürlü (varsayılan)", async () => {
    const session = await issueSession({ id: "u1", role: "USER" });
    const minutes = (session.accessExpiresAt.getTime() - Date.now()) / 60000;
    expect(minutes).toBeGreaterThan(14);
    expect(minutes).toBeLessThanOrEqual(15);
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
      })
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

  it("demo seed production'da DEMO_SEED=true olmadan çalışmaz", () => {
    expect(() => assertSeedAllowed({ NODE_ENV: "production" })).toThrow();
    expect(() => assertSeedAllowed({ NODE_ENV: "production", DEMO_SEED: "true" })).not.toThrow();
    expect(() => assertSeedAllowed({ NODE_ENV: "development" })).not.toThrow();
  });
});
