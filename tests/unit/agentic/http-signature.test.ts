import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertAgentHttpSignature,
  contentDigest,
  parseAgentKeyDirectory,
  signHttpRequest,
  verifyHttpSignature,
} from "@/lib/agentic/http-signature";
import { resetConfigForTests } from "@/lib/config/app-config";

/** v5 P1-1: RFC 9421 HTTP Message Signatures — ajan isteği doğrulaması (ADR 0035). */

const ec = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const ed = generateKeyPairSync("ed25519");
const ecJwk = { ...ec.publicKey.export({ format: "jwk" }), kid: "agent-ec" };
const edJwk = { ...ed.publicKey.export({ format: "jwk" }), kid: "agent-ed" };
const directory = JSON.stringify({ keys: [ecJwk, edJwk] });
const keys = parseAgentKeyDirectory(directory);
const NOW = new Date("2026-09-28T10:00:00Z");
const created = Math.floor(NOW.getTime() / 1000);
const URL_ = "https://stay.example/api/ucp/checkout-sessions/cs_1/complete";
const BODY = JSON.stringify({ payment_data: { credential: { token: "spt_1" } } });

function signed(alg: "ecdsa-p256-sha256" | "ed25519" = "ecdsa-p256-sha256", body = BODY) {
  return signHttpRequest(
    { method: "POST", url: URL_, headers: { "content-type": "application/json" }, body },
    {
      keyid: alg === "ed25519" ? "agent-ed" : "agent-ec",
      privateKey: alg === "ed25519" ? ed.privateKey : ec.privateKey,
      alg,
      created,
    }
  );
}

const verify = (headers: Record<string, string>, body = BODY, url = URL_, method = "POST") =>
  verifyHttpSignature(
    { method, url, headers: new Headers(headers) },
    new TextEncoder().encode(body),
    {
      keys,
      maxAgeSeconds: 300,
      now: NOW,
    }
  );

describe("RFC 9421 ajan istek imzası", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetConfigForTests();
  });

  it("P-256 ve Ed25519 imzalı istek kabul edilir; keyid döner", () => {
    expect(verify(signed())).toBe("agent-ec");
    expect(verify(signed("ed25519"))).toBe("agent-ed");
  });

  it("gövde değişirse digest uyuşmaz → HTTP_SIGNATURE_DIGEST_MISMATCH", () => {
    expect(() => verify(signed(), BODY.replace("spt_1", "spt_2"))).toThrow(
      expect.objectContaining({ status: 401, code: "HTTP_SIGNATURE_DIGEST_MISMATCH" })
    );
  });

  it("digest de yeniden hesaplanırsa imza tutmaz → HTTP_SIGNATURE_INVALID", () => {
    const tampered = BODY.replace("spt_1", "spt_2");
    const headers = { ...signed(), "content-digest": contentDigest(tampered) };
    expect(() => verify(headers, tampered)).toThrow(
      expect.objectContaining({ code: "HTTP_SIGNATURE_INVALID" })
    );
  });

  it("farklı yol/metot imza tabanını değiştirir → red", () => {
    expect(() => verify(signed(), BODY, URL_.replace("cs_1", "cs_2"))).toThrow(
      expect.objectContaining({ code: "HTTP_SIGNATURE_INVALID" })
    );
    expect(() => verify(signed(), BODY, URL_, "PUT")).toThrow(
      expect.objectContaining({ code: "HTTP_SIGNATURE_INVALID" })
    );
  });

  it("imza yok → REQUIRED; bilinmeyen keyid → UNKNOWN_KEY; eski created → EXPIRED", () => {
    expect(() => verify({})).toThrow(expect.objectContaining({ code: "HTTP_SIGNATURE_REQUIRED" }));
    const unknown = signed();
    unknown["signature-input"] = unknown["signature-input"].replace("agent-ec", "agent-x");
    expect(() => verify(unknown)).toThrow(
      expect.objectContaining({ code: "HTTP_SIGNATURE_UNKNOWN_KEY" })
    );
    const old = signHttpRequest(
      { method: "POST", url: URL_, body: BODY },
      {
        keyid: "agent-ec",
        privateKey: ec.privateKey,
        alg: "ecdsa-p256-sha256",
        created: created - 3600,
      }
    );
    expect(() => verify(old)).toThrow(expect.objectContaining({ code: "HTTP_SIGNATURE_EXPIRED" }));
  });

  it("gövdeli istekte content-digest kapsanmıyorsa red", () => {
    const noBody = signHttpRequest(
      { method: "POST", url: URL_ },
      { keyid: "agent-ec", privateKey: ec.privateKey, alg: "ecdsa-p256-sha256", created }
    );
    expect(() => verify(noBody)).toThrow(
      expect.objectContaining({ code: "HTTP_SIGNATURE_INVALID" })
    );
    // Gövdesiz istek (GET) için digest gerekmez.
    const get = signHttpRequest(
      { method: "GET", url: URL_ },
      { keyid: "agent-ec", privateKey: ec.privateKey, alg: "ecdsa-p256-sha256", created }
    );
    expect(verify(get, "", URL_, "GET")).toBe("agent-ec");
  });

  it("anahtar dizini özel anahtar/kid'siz/desteklenmeyen eğri içeremez (503)", () => {
    const priv = { ...ec.privateKey.export({ format: "jwk" }), kid: "k" };
    expect(() => parseAgentKeyDirectory(JSON.stringify({ keys: [priv] }))).toThrow(
      expect.objectContaining({ status: 503 })
    );
    expect(() => parseAgentKeyDirectory(JSON.stringify({ keys: [{ ...ecJwk, kid: "" }] }))).toThrow(
      expect.objectContaining({ status: 503 })
    );
    expect(() => parseAgentKeyDirectory("not json")).toThrow(
      expect.objectContaining({ status: 503 })
    );
    expect(parseAgentKeyDirectory("").size).toBe(0);
  });

  it("route kapısı: dizin boşsa kapalı; doluysa imzasız istek 401", async () => {
    vi.stubEnv("AGENT_HTTP_SIGNATURE_KEYS", "");
    resetConfigForTests();
    const plain = new Request(URL_, { method: "POST", body: BODY });
    await expect(assertAgentHttpSignature(plain)).resolves.toBeNull();

    vi.stubEnv("AGENT_HTTP_SIGNATURE_KEYS", directory);
    resetConfigForTests();
    await expect(
      assertAgentHttpSignature(new Request(URL_, { method: "POST", body: BODY }))
    ).rejects.toMatchObject({
      status: 401,
      code: "HTTP_SIGNATURE_REQUIRED",
    });
    const fresh = signHttpRequest(
      { method: "POST", url: URL_, body: BODY },
      { keyid: "agent-ed", privateKey: ed.privateKey, alg: "ed25519" }
    );
    const ok = new Request(URL_, { method: "POST", body: BODY, headers: fresh });
    await expect(assertAgentHttpSignature(ok)).resolves.toBe("agent-ed");
    // Gövde klondan okunur; route gövdeyi yine okuyabilir.
    expect(await ok.text()).toBe(BODY);
  });
});
