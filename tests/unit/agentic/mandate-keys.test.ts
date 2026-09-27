import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/redis", async () => {
  const { FakeRedis } = await import("../../helpers/fake-redis");
  return { redis: new FakeRedis() };
});
vi.mock("@/lib/admin/audit", () => ({ audit: vi.fn(async () => undefined) }));

import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { SignJWT, decodeProtectedHeader } from "jose";
import { MANDATE_TYP, signMandate, verifyMandateToken } from "@/lib/agentic/mandate";
import { jwkThumbprint, mandateKeyRing, publicJwks } from "@/lib/agentic/mandate-keys";
import { ucpProfile } from "@/lib/agentic/ucp";
import { resetConfigForTests } from "@/lib/config/app-config";
import { GET as jwksRoute } from "@/app/.well-known/jwks.json/route";

const NOW = new Date("2026-10-01T10:00:00.000Z");
const SECRET_MEMBERS = ["d", "p", "q", "k", "dp", "dq", "qi"];

function p256() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return {
    pem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    publicJwk: publicKey.export({ format: "jwk" }),
  };
}

const pem = (type: "rsa" | "P-384") =>
  (type === "rsa"
    ? generateKeyPairSync("rsa", { modulusLength: 2048 })
    : generateKeyPairSync("ec", { namedCurve: type })
  ).privateKey
    .export({ format: "pem", type: "pkcs8" })
    .toString();

const sign = (maxAmountMinor = 200_000) =>
  signMandate("u1", { maxAmountMinor, currency: "TRY" }, NOW).then((m) => m.mandate);

afterEach(() => {
  vi.unstubAllEnvs();
  resetConfigForTests();
});

describe("AP2 mandate ES256 anahtar halkası + JWKS (v2-P1-1)", () => {
  it("JWKS yalnız açık anahtar içerir; kid başlıkla eşleşir; node:crypto imzayı doğrular", async () => {
    const mandate = await sign(500_000);
    const header = decodeProtectedHeader(mandate);
    expect(header.alg).toBe("ES256");

    const res = jwksRoute();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/jwk-set+json");
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    const body = (await res.json()) as { keys: Array<Record<string, string>> };
    expect(body.keys.length).toBeGreaterThan(0);
    for (const k of body.keys) {
      for (const m of SECRET_MEMBERS) expect(k).not.toHaveProperty(m);
      expect(k).toMatchObject({ kty: "EC", crv: "P-256", alg: "ES256", use: "sig" });
    }
    const jwk = body.keys.find((k) => k.kid === header.kid);
    expect(jwk).toBeDefined();

    const [h64, p64, s64] = mandate.split(".");
    const key = createPublicKey({ key: jwk!, format: "jwk" });
    const valid = verify(
      "sha256",
      Buffer.from(`${h64}.${p64}`),
      { key, dsaEncoding: "ieee-p1363" },
      Buffer.from(s64, "base64url")
    );
    expect(valid).toBe(true);
    const payload = JSON.parse(Buffer.from(p64, "base64url").toString());
    expect(payload).toMatchObject({ maxAmountMinor: 500_000, currency: "TRY" });
  });

  it("JWKS önbellek süresi yapılandırmadan gelir", () => {
    vi.stubEnv("AGENT_MANDATE_JWKS_MAX_AGE_SECONDS", "60");
    resetConfigForTests();
    expect(jwksRoute().headers.get("cache-control")).toBe("public, max-age=60");
  });

  it("demo/test türetmesi deterministik; tohum değişince kid değişir", () => {
    const a = mandateKeyRing().active.kid;
    expect(mandateKeyRing().derived).toBe(true);
    expect(mandateKeyRing({ ...process.env }).active.kid).toBe(a);
    vi.stubEnv("AGENT_MANDATE_SIGNING_KEY", "s".repeat(40));
    const b = mandateKeyRing().active.kid;
    expect(b).not.toBe(a);
    // Önbellek dışı yeniden türetme aynı anahtarı verir (yeniden başlatma).
    expect(mandateKeyRing({ ...process.env, NODE_ENV: "test", DEMO_MODE: "1" }).active.kid).toBe(b);
  });

  it("env anahtarı: PEM → kid = RFC 7638 thumbprint; AGENT_MANDATE_KEY_ID ezer; JWK kabul", async () => {
    const k = p256();
    vi.stubEnv("AGENT_MANDATE_PRIVATE_KEY", k.pem.replace(/\n/g, "\\n"));
    const ring = mandateKeyRing();
    expect(ring.derived).toBe(false);
    expect(ring.active.kid).toBe(
      jwkThumbprint(k.publicJwk as { crv: string; x: string; y: string })
    );
    expect(decodeProtectedHeader(await sign()).kid).toBe(ring.active.kid);

    vi.stubEnv("AGENT_MANDATE_KEY_ID", "mandate-2026-10");
    expect(mandateKeyRing().active.kid).toBe("mandate-2026-10");
    vi.stubEnv("AGENT_MANDATE_KEY_ID", "");

    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const jwk = { ...privateKey.export({ format: "jwk" }), kid: "jwk-kid" };
    vi.stubEnv("AGENT_MANDATE_PRIVATE_KEY", JSON.stringify(jwk));
    const mandate = await sign();
    expect(decodeProtectedHeader(mandate).kid).toBe("jwk-kid");
    await expect(verifyMandateToken(mandate, NOW)).resolves.toMatchObject({ sub: "u1" });
  });

  it("rotasyon: eski kid'li süresi dolmamış mandate yeni etkin anahtardan sonra da geçerli", async () => {
    const oldKey = p256();
    vi.stubEnv("AGENT_MANDATE_PRIVATE_KEY", oldKey.pem);
    vi.stubEnv("AGENT_MANDATE_KEY_ID", "k-old");
    const oldMandate = await sign();
    expect(decodeProtectedHeader(oldMandate).kid).toBe("k-old");

    const newKey = p256();
    vi.stubEnv("AGENT_MANDATE_PRIVATE_KEY", newKey.pem);
    vi.stubEnv("AGENT_MANDATE_KEY_ID", "k-new");
    // Eski açık anahtar yayımlanmadıkça eski mandate doğrulanmaz (bilinmeyen kid).
    await expect(verifyMandateToken(oldMandate, NOW)).rejects.toMatchObject({
      status: 403,
      code: "MANDATE_INVALID",
    });

    vi.stubEnv(
      "AGENT_MANDATE_PREVIOUS_PUBLIC_KEYS",
      JSON.stringify({ keys: [{ ...oldKey.publicJwk, kid: "k-old" }] })
    );
    await expect(verifyMandateToken(oldMandate, NOW)).resolves.toMatchObject({ sub: "u1" });
    const newMandate = await sign();
    expect(decodeProtectedHeader(newMandate).kid).toBe("k-new");
    await expect(verifyMandateToken(newMandate, NOW)).resolves.toMatchObject({ sub: "u1" });
    expect(publicJwks().keys.map((k) => k.kid)).toEqual(["k-new", "k-old"]);

    // Süresi dolmuş eski mandate rotasyonda da reddedilir.
    await expect(
      verifyMandateToken(oldMandate, new Date(NOW.getTime() + 61 * 60_000))
    ).rejects.toMatchObject({ code: "MANDATE_EXPIRED" });
  });

  it("bilinmeyen kid, sahte imza, kid'siz başlık ve eski HS256 mandate reddedilir", async () => {
    const rogue = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey;
    const { active } = mandateKeyRing();
    const iat = Math.floor(NOW.getTime() / 1000);
    const build = () =>
      new SignJWT({
        maxAmountMinor: 1,
        currency: "TRY",
        expiresAt: new Date((iat + 600) * 1000).toISOString(),
        nonce: "n".repeat(16),
      })
        .setSubject("u1")
        .setAudience("booking-platform:agentic-checkout")
        .setIssuer("booking-platform")
        .setIssuedAt(iat)
        .setExpirationTime(iat + 600);

    const good = await build()
      .setProtectedHeader({ alg: "ES256", typ: MANDATE_TYP, kid: active.kid })
      .sign(active.privateKey);
    await expect(verifyMandateToken(good, NOW)).resolves.toMatchObject({ sub: "u1" });

    const unknownKid = await build()
      .setProtectedHeader({ alg: "ES256", typ: MANDATE_TYP, kid: "k-unknown" })
      .sign(rogue);
    const forged = await build()
      .setProtectedHeader({ alg: "ES256", typ: MANDATE_TYP, kid: active.kid })
      .sign(rogue);
    const noKid = await build()
      .setProtectedHeader({ alg: "ES256", typ: MANDATE_TYP })
      .sign(active.privateKey);
    const legacy = await build()
      .setProtectedHeader({ alg: "HS256", typ: MANDATE_TYP, kid: active.kid })
      .sign(new TextEncoder().encode("h".repeat(40)));
    for (const token of [unknownKid, forged, noKid, legacy]) {
      await expect(verifyMandateToken(token, NOW)).rejects.toMatchObject({
        status: 403,
        code: "MANDATE_INVALID",
      });
    }
  });

  it("fail-closed: demo dışında anahtar yok, P-256 değil, bozuk ya da eski listede özel alan → 503", async () => {
    const mandate = await sign();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEMO_MODE", "false");
    await expect(sign()).rejects.toMatchObject({ status: 503, code: "MANDATE_KEYS_UNAVAILABLE" });
    await expect(verifyMandateToken(mandate, NOW)).rejects.toMatchObject({ status: 503 });
    expect(jwksRoute().status).toBe(503);

    for (const bad of [pem("rsa"), pem("P-384"), "not-a-key", '{"kty":"EC","crv":"P-256"}']) {
      vi.stubEnv("AGENT_MANDATE_PRIVATE_KEY", bad);
      await expect(sign()).rejects.toMatchObject({ code: "MANDATE_KEYS_UNAVAILABLE" });
    }
    // Demo modunda bile bozuk anahtar türetmeye düşmez.
    vi.stubEnv("DEMO_MODE", "true");
    await expect(sign()).rejects.toMatchObject({ code: "MANDATE_KEYS_UNAVAILABLE" });

    const good = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey;
    vi.stubEnv(
      "AGENT_MANDATE_PRIVATE_KEY",
      good.export({ format: "pem", type: "pkcs8" }).toString()
    );
    vi.stubEnv(
      "AGENT_MANDATE_PREVIOUS_PUBLIC_KEYS",
      JSON.stringify([{ ...good.export({ format: "jwk" }), kid: "leak" }])
    );
    expect(() => publicJwks()).toThrow(expect.objectContaining({ status: 503 }));
    vi.stubEnv("AGENT_MANDATE_PREVIOUS_PUBLIC_KEYS", JSON.stringify([{ kty: "EC" }]));
    expect(() => publicJwks()).toThrow(expect.objectContaining({ status: 503 }));
    vi.stubEnv("AGENT_MANDATE_PREVIOUS_PUBLIC_KEYS", "");
    expect(publicJwks().keys).toHaveLength(1);
  });

  it("UCP profili mandate algoritmasını ve jwks_uri'yi bildirir", () => {
    const profile = ucpProfile("https://stay.example");
    expect(profile.ap2.intent_mandate).toMatchObject({
      alg: "ES256",
      jwks_uri: "https://stay.example/.well-known/jwks.json",
    });
  });
});
