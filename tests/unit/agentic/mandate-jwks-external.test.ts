import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/redis", async () => {
  const { FakeRedis } = await import("../../helpers/fake-redis");
  return { redis: new FakeRedis() };
});
vi.mock("@/lib/admin/audit", () => ({ audit: vi.fn(async () => undefined) }));

import { SignJWT, createLocalJWKSet, jwtVerify, type JSONWebKeySet } from "jose";
import { MANDATE_TYP, signMandate, verifyMandateToken } from "@/lib/agentic/mandate";
import { resetConfigForTests } from "@/lib/config/app-config";
import { GET as jwksRoute } from "@/app/.well-known/jwks.json/route";

const NOW = new Date("2026-10-01T10:00:00.000Z");

afterEach(() => {
  vi.unstubAllEnvs();
  resetConfigForTests();
});

describe("regression: v5#10 mandate üçüncü tarafça yalnız JWKS ile doğrulanır", () => {
  it("harici doğrulayıcı platform kodu olmadan yalnız /.well-known/jwks.json ile doğrular", async () => {
    const { mandate } = await signMandate("u1", { maxAmountMinor: 1000, currency: "TRY" }, NOW);
    // Üçüncü taraf: yalnız yayımlanan JWKS (JSON) + standart JOSE kütüphanesi.
    const jwks = (await jwksRoute().json()) as JSONWebKeySet;
    const { payload, protectedHeader } = await jwtVerify(mandate, createLocalJWKSet(jwks), {
      algorithms: ["ES256"],
      currentDate: NOW,
    });
    expect(protectedHeader).toMatchObject({ alg: "ES256", typ: MANDATE_TYP });
    expect(protectedHeader.kid).toBeTruthy();
    expect(payload.sub).toBe("u1");
  });

  it("HS256 (simetrik) mandate hem platformda hem JWKS doğrulayıcısında reddedilir", async () => {
    const iat = Math.floor(NOW.getTime() / 1000);
    const hs = await new SignJWT({ maxAmountMinor: 1, currency: "TRY", nonce: "n".repeat(16) })
      .setProtectedHeader({ alg: "HS256", typ: MANDATE_TYP })
      .setSubject("u1")
      .setAudience("booking-platform:agentic-checkout")
      .setIssuer("booking-platform")
      .setIssuedAt(iat)
      .setExpirationTime(iat + 600)
      .sign(new TextEncoder().encode("s".repeat(48)));
    await expect(verifyMandateToken(hs, NOW)).rejects.toMatchObject({
      status: 403,
      code: "MANDATE_INVALID",
    });
    const jwks = (await jwksRoute().json()) as JSONWebKeySet;
    await expect(jwtVerify(hs, createLocalJWKSet(jwks), { currentDate: NOW })).rejects.toThrow();
  });

  it("üretimde (demo kapalı) özel anahtar yoksa imzalama ve JWKS 503 (fail-closed)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEMO_MODE", "false");
    vi.stubEnv("AGENT_MANDATE_PRIVATE_KEY", "");
    await expect(
      signMandate("u1", { maxAmountMinor: 1, currency: "TRY" }, NOW)
    ).rejects.toMatchObject({ status: 503, code: "MANDATE_KEYS_UNAVAILABLE" });
    expect(jwksRoute().status).toBe(503);
  });
});
