import { afterEach, describe, expect, it, vi } from "vitest";
import fc from "fast-check";

vi.mock("@/lib/redis", async () => {
  const { FakeRedis } = await import("../../helpers/fake-redis");
  return { redis: new FakeRedis() };
});
vi.mock("@/lib/admin/audit", () => ({ audit: vi.fn(async () => undefined) }));

import { SignJWT, decodeProtectedHeader } from "jose";
import {
  assertWithinMandate,
  authorizeMandate,
  MANDATE_TYP,
  MandateError,
  memoryNonceStore,
  memoryRevocationStore,
  redisNonceStore,
  redisRevocationStore,
  signMandate,
  verifyMandateToken,
  issueMandate,
  type MandateCharge,
} from "@/lib/agentic/mandate";
import { mandateKeyRing } from "@/lib/agentic/mandate-keys";
import { signAccessToken } from "@/lib/auth/tokens";
import { resetConfigForTests } from "@/lib/config/app-config";
import { audit } from "@/lib/admin/audit";

const NOW = new Date("2026-10-01T10:00:00.000Z");
/** Birim testlerde DB'ye düşülmesin: iptal deposu bellekte. */
const revocations = memoryRevocationStore();
const charge = (over: Partial<MandateCharge> = {}): MandateCharge => ({
  userId: "u1",
  checkoutSessionId: "cs1",
  amountMinor: 150_000,
  currency: "TRY",
  propertyId: "p1",
  ...over,
});

async function sign(over: Parameters<typeof signMandate>[1] | object = {}, userId = "u1") {
  return signMandate(userId, { maxAmountMinor: 200_000, currency: "try", ...over }, NOW);
}

afterEach(() => {
  vi.unstubAllEnvs();
  resetConfigForTests();
});

describe("AP2 intent mandate (P1-11)", () => {
  it("imzalar: JWS başlığı typ + ES256 + kid; claim'ler sub/aud/limit/para birimi/süre/nonce", async () => {
    const { mandate, claims } = await sign({ propertyIds: ["p1", "p1", "p2"] });
    expect(decodeProtectedHeader(mandate)).toEqual({
      alg: "ES256",
      typ: MANDATE_TYP,
      kid: mandateKeyRing().active.kid,
    });
    expect(claims).toMatchObject({
      sub: "u1",
      aud: "booking-platform:agentic-checkout",
      maxAmountMinor: 200_000,
      currency: "TRY",
      expiresAt: "2026-10-01T11:00:00.000Z",
      propertyId: ["p1", "p2"],
    });
    const verified = await verifyMandateToken(mandate, NOW);
    expect(verified).toEqual(claims);
  });

  it("imza: kurcalanmış gövde, başka anahtar, alg/typ farkı ve access token reddedilir", async () => {
    const { mandate } = await sign();
    const [h, p, sig] = mandate.split(".");
    const forged = JSON.parse(Buffer.from(p, "base64url").toString());
    forged.maxAmountMinor = 99_999_999;
    const tampered = `${h}.${Buffer.from(JSON.stringify(forged)).toString("base64url")}.${sig}`;
    await expect(verifyMandateToken(tampered, NOW)).rejects.toMatchObject({
      status: 403,
      code: "MANDATE_INVALID",
    });

    vi.stubEnv("AGENT_MANDATE_SIGNING_KEY", "k".repeat(40));
    await expect(verifyMandateToken(mandate, NOW)).rejects.toMatchObject({
      code: "MANDATE_INVALID",
    });
    const withKey = await sign();
    await expect(verifyMandateToken(withKey.mandate, NOW)).resolves.toMatchObject({ sub: "u1" });
    vi.unstubAllEnvs();

    // Erişim token'ı (JWT sırrı) mandate yerine geçemez: typ/aud/anahtar farklı.
    const { token } = await signAccessToken("u1", "USER", 900);
    await expect(verifyMandateToken(token)).rejects.toMatchObject({ code: "MANDATE_INVALID" });

    // Doğru anahtar ama typ başlığı yok → ret.
    const { active } = mandateKeyRing();
    const noTyp = await new SignJWT({ maxAmountMinor: 1, currency: "TRY", nonce: "n".repeat(16) })
      .setProtectedHeader({ alg: "ES256", kid: active.kid })
      .setSubject("u1")
      .setAudience("booking-platform:agentic-checkout")
      .setIssuer("booking-platform")
      .setExpirationTime("1h")
      .sign(active.privateKey);
    await expect(verifyMandateToken(noTyp)).rejects.toMatchObject({ code: "MANDATE_INVALID" });
    await expect(verifyMandateToken("a.b.c")).rejects.toBeInstanceOf(MandateError);
  });

  it("süre: exp geçince MANDATE_EXPIRED; farklı aud yapılandırmasında geçersiz", async () => {
    const { mandate } = await sign({ expiresInMinutes: 5 });
    await expect(
      verifyMandateToken(mandate, new Date(NOW.getTime() + 4 * 60_000))
    ).resolves.toBeTruthy();
    await expect(
      verifyMandateToken(mandate, new Date(NOW.getTime() + 5 * 60_000 + 1000))
    ).rejects.toMatchObject({ status: 403, code: "MANDATE_EXPIRED" });

    vi.stubEnv("AGENT_MANDATE_AUDIENCE", "baska-merchant");
    resetConfigForTests();
    await expect(verifyMandateToken(mandate, NOW)).rejects.toMatchObject({
      code: "MANDATE_INVALID",
    });
  });

  it("azami TTL aşılırsa imzalanmaz (400); geçersiz para birimi 400", async () => {
    await expect(sign({ expiresInMinutes: 10_081 })).rejects.toMatchObject({ status: 400 });
    await expect(sign({ currency: "TL" })).rejects.toThrow();
  });

  it("kapsam: sub, para birimi, ilan kısıtı ve tutar (402 + step-up)", async () => {
    const { claims } = await sign({ propertyIds: ["p1"] });
    expect(() => assertWithinMandate(claims, charge())).not.toThrow();
    expect(() => assertWithinMandate(claims, charge({ amountMinor: 200_000 }))).not.toThrow();
    expect(() => assertWithinMandate(claims, charge({ userId: "u2" }))).toThrow(
      expect.objectContaining({ code: "MANDATE_SUBJECT_MISMATCH", status: 403 })
    );
    expect(() => assertWithinMandate(claims, charge({ currency: "EUR" }))).toThrow(
      expect.objectContaining({ code: "MANDATE_CURRENCY_MISMATCH" })
    );
    expect(() => assertWithinMandate(claims, charge({ propertyId: "p9" }))).toThrow(
      expect.objectContaining({ code: "MANDATE_PROPERTY_MISMATCH", status: 403 })
    );
    try {
      assertWithinMandate(claims, charge({ amountMinor: 200_001 }));
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({
        status: 402,
        code: "MANDATE_AMOUNT_EXCEEDED",
        details: {
          amountMinor: 200_001,
          maxAmountMinor: 200_000,
          stepUp: { type: "new_mandate", endpoint: "/api/account/agent-mandates" },
        },
      });
    }
    const open = (await sign()).claims;
    expect(() => assertWithinMandate(open, charge({ propertyId: "herhangi" }))).not.toThrow();
  });

  it("property: tutar ≤ limit ⇔ kabul (sınırda dahil)", async () => {
    const { claims } = await sign();
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10_000_000 }), (amountMinor) => {
        let accepted = true;
        try {
          assertWithinMandate(claims, charge({ amountMinor }));
        } catch {
          accepted = false;
        }
        return accepted === amountMinor <= claims.maxAmountMinor;
      }),
      { numRuns: 300 }
    );
  });

  it("nonce tek kullanımlık: aynı oturumun yeniden denemesi serbest, başka oturum 409", async () => {
    const nonces = memoryNonceStore();
    const record = vi.fn(async () => undefined);
    const { mandate } = await sign();
    await expect(
      authorizeMandate(mandate, charge(), { nonces, now: NOW, record, revocations })
    ).resolves.toMatchObject({ sub: "u1" });
    await expect(
      authorizeMandate(mandate, charge(), { nonces, now: NOW, record, revocations })
    ).resolves.toBeTruthy();
    await expect(
      authorizeMandate(mandate, charge({ checkoutSessionId: "cs2" }), {
        nonces,
        now: NOW,
        record,
        revocations,
      })
    ).rejects.toMatchObject({ status: 409, code: "MANDATE_REPLAYED" });
    expect(record).toHaveBeenCalledWith(
      "agent_mandate.rejected",
      expect.objectContaining({ checkoutSessionId: "cs2" }),
      expect.objectContaining({ reason: "MANDATE_REPLAYED" })
    );
  });

  it("Redis nonce deposu: SET NX ile ilk oturuma bağlanır", async () => {
    const { mandate, claims } = await sign();
    const record = vi.fn(async () => undefined);
    const deps = { nonces: redisNonceStore, now: NOW, record, revocations };
    await authorizeMandate(mandate, charge({ checkoutSessionId: "r-1" }), deps);
    await authorizeMandate(mandate, charge({ checkoutSessionId: "r-1" }), deps);
    await expect(
      authorizeMandate(mandate, charge({ checkoutSessionId: "r-2" }), deps)
    ).rejects.toMatchObject({ code: "MANDATE_REPLAYED" });
    expect(await redisNonceStore.bind(claims.nonce, "r-3", 60)).toEqual({ boundTo: "r-1" });
  });

  it("mandate yoksa MANDATE_REQUIRED (403, denetlenir); AGENT_MANDATE_REQUIRED=false iken geçer", async () => {
    const record = vi.fn(async () => undefined);
    await expect(
      authorizeMandate(undefined, charge(), { record, revocations })
    ).rejects.toMatchObject({
      status: 403,
      code: "MANDATE_REQUIRED",
    });
    await expect(authorizeMandate("  ", charge(), { record, revocations })).rejects.toMatchObject({
      code: "MANDATE_REQUIRED",
    });
    expect(record).toHaveBeenCalledWith(
      "agent_mandate.rejected",
      expect.anything(),
      expect.objectContaining({ reason: "MANDATE_REQUIRED" })
    );
    vi.stubEnv("AGENT_MANDATE_REQUIRED", "false");
    resetConfigForTests();
    await expect(authorizeMandate(null, charge(), { record, revocations })).resolves.toBeNull();
    // Verilmişse yine doğrulanır.
    await expect(
      authorizeMandate("x.y.z", charge(), { record, revocations })
    ).rejects.toMatchObject({
      code: "MANDATE_INVALID",
    });
  });

  it("süresi dolmuş / aşan tutar authorizeMandate'te reddedilir ve nonce bağlanmaz", async () => {
    const nonces = memoryNonceStore();
    const record = vi.fn(async () => undefined);
    const { mandate } = await sign({ expiresInMinutes: 1 });
    const later = new Date(NOW.getTime() + 2 * 60_000);
    await expect(
      authorizeMandate(mandate, charge(), { nonces, now: later, record, revocations })
    ).rejects.toMatchObject({ code: "MANDATE_EXPIRED" });
    await expect(
      authorizeMandate(mandate, charge({ amountMinor: 999_999 }), {
        nonces,
        now: NOW,
        record,
        revocations,
      })
    ).rejects.toMatchObject({ status: 402 });
    // Reddedilen denemeler nonce'u tüketmez: başka oturum hâlâ kullanabilir.
    await expect(
      authorizeMandate(mandate, charge({ checkoutSessionId: "cs9" }), {
        nonces,
        now: NOW,
        record,
        revocations,
      })
    ).resolves.toBeTruthy();
  });

  it("iptal edilen mandate (nonce/jti) MANDATE_REVOKED ile reddedilir ve nonce bağlanmaz", async () => {
    const nonces = memoryNonceStore();
    const record = vi.fn(async () => undefined);
    const store = memoryRevocationStore();
    const { mandate, claims } = await sign();
    store.revoke(claims.nonce);
    await expect(
      authorizeMandate(mandate, charge(), { nonces, now: NOW, record, revocations: store })
    ).rejects.toMatchObject({ status: 403, code: "MANDATE_REVOKED" });
    expect(record).toHaveBeenCalledWith(
      "agent_mandate.rejected",
      expect.anything(),
      expect.objectContaining({ reason: "MANDATE_REVOKED" })
    );
    expect(await nonces.bind(claims.nonce, "other", 60)).toEqual({ boundTo: "other" });
  });

  it("Redis iptal işareti varsa DB'ye gitmeden iptal sayılır", async () => {
    const { redis } = await import("@/lib/redis");
    await redis.set("agent-mandate:revoked:nonce-redis-1", "1", { ex: 60 });
    await expect(redisRevocationStore.isRevoked("nonce-redis-1")).resolves.toBe(true);
  });

  it("issueMandate denetim kaydı yazar (nonce = varlık kimliği)", async () => {
    const { claims } = await issueMandate("u1", { maxAmountMinor: 5000, currency: "EUR" }, NOW);
    expect(audit).toHaveBeenCalledWith(
      "u1",
      "agent_mandate.issued",
      "AgentMandate",
      claims.nonce,
      expect.objectContaining({ maxAmountMinor: 5000, currency: "EUR" })
    );
  });
});
