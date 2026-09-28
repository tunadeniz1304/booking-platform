import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import { MANDATE_TYP, signMandate } from "@/lib/agentic/mandate";
import { publicJwks } from "@/lib/agentic/mandate-keys";
import { main, verifyMandate } from "../../../scripts/verify-mandate";

/**
 * v5 P1-1: `scripts/verify-mandate.ts` — harici doğrulayıcı YALNIZ JWKS URL'si + mandate ile
 * çalışır (DB/Redis/sır yok). JWKS, testte yerel (loopback) HTTP sunucusundan servis edilir;
 * dış ağa çıkılmaz.
 */
describe("verify-mandate betiği (JWKS URL ile harici doğrulama)", () => {
  let server: Server;
  let jwksUrl = "";

  beforeAll(async () => {
    const body = JSON.stringify(publicJwks());
    server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/jwk-set+json" });
      res.end(body);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    jwksUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/.well-known/jwks.json`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("geçerli mandate'i kabul eder, kid ve claim'leri döner", async () => {
    const { mandate, claims } = await signMandate("u-ext", {
      maxAmountMinor: 120_000,
      currency: "TRY",
    });
    const out = await verifyMandate(mandate, {
      jwks: jwksUrl,
      audience: "booking-platform:agentic-checkout",
    });
    expect(out).toMatchObject({
      valid: true,
      claims: { sub: "u-ext", nonce: claims.nonce, maxAmountMinor: 120_000 },
    });
  });

  it("oynanmış mandate'i (payload değişmiş) reddeder", async () => {
    const { mandate } = await signMandate("u-ext", { maxAmountMinor: 1_000, currency: "TRY" });
    const [h, p, s] = mandate.split(".");
    const payload = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
    payload.maxAmountMinor = 9_999_999;
    const forged = [h, Buffer.from(JSON.stringify(payload)).toString("base64url"), s].join(".");
    const out = await verifyMandate(forged, { jwks: jwksUrl });
    expect(out.valid).toBe(false);
  });

  it("HS256 (simetrik) mandate'i ve yanlış audience'ı reddeder", async () => {
    const hs = await new SignJWT({ maxAmountMinor: 1, currency: "TRY", nonce: "n-12345678" })
      .setProtectedHeader({ alg: "HS256", typ: MANDATE_TYP, kid: "x" })
      .setIssuer("booking-platform")
      .setSubject("u")
      .setAudience("booking-platform:agentic-checkout")
      .setExpirationTime("10m")
      .sign(new TextEncoder().encode("s".repeat(32)));
    expect((await verifyMandate(hs, { jwks: jwksUrl })).valid).toBe(false);

    const { mandate } = await signMandate("u-ext", { maxAmountMinor: 1_000, currency: "TRY" });
    expect((await verifyMandate(mandate, { jwks: jwksUrl, audience: "other" })).valid).toBe(false);
  });

  it("CLI: geçerli → 0, oynanmış → 1, eksik argüman → 2", async () => {
    const { mandate } = await signMandate("u-cli", { maxAmountMinor: 5_000, currency: "TRY" });
    const quiet = { log: console.log, error: console.error };
    console.log = () => undefined;
    console.error = () => undefined;
    try {
      expect(await main(["--jwks", jwksUrl, "--mandate", mandate])).toBe(0);
      expect(await main(["--jwks", jwksUrl, "--mandate", `${mandate.slice(0, -4)}AAAA`])).toBe(1);
      expect(await main(["--jwks", jwksUrl])).toBe(2);
    } finally {
      console.log = quiet.log;
      console.error = quiet.error;
    }
  });

  it("betik uygulama modüllerine (DB/Redis/config/sır) bağımlı değildir", () => {
    const src = readFileSync(path.resolve("scripts/verify-mandate.ts"), "utf8");
    const imports = [...src.matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
    expect(imports.every((m) => m === "jose" || m.startsWith("node:"))).toBe(true);
    expect(src).not.toMatch(/process\.env/);
  });
});
