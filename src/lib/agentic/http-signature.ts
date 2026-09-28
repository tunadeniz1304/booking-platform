import {
  createHash,
  createPublicKey,
  sign as cryptoSign,
  verify as cryptoVerify,
  type KeyObject,
} from "node:crypto";
import { getConfig } from "@/lib/config/app-config";
import { HttpError } from "@/lib/http/errors";
import { logger } from "@/lib/observability/logger";

/**
 * Ajan HTTP isteği imzası — RFC 9421 HTTP Message Signatures (v5 P1-1, ADR 0035).
 *
 * Opsiyoneldir: `AGENT_HTTP_SIGNATURE_KEYS` (JWKS JSON, ajanların açık anahtarları) boşsa
 * doğrulama kapalıdır. Doluysa `/api/ucp/*` ve `/api/agentic/*` istekleri `Signature-Input` +
 * `Signature` başlıklarını taşımalıdır. Desteklenen algoritmalar: `ecdsa-p256-sha256` (P-256,
 * r‖s 64 bayt) ve `ed25519`. Kapsam kuralları (fail-closed):
 *   - `@method` ve (`@target-uri` ya da `@authority` + `@path`) imzalı olmalı;
 *   - `created` zorunlu ve `AGENT_HTTP_SIGNATURE_MAX_AGE_SECONDS` penceresinde; `expires` geçmemiş;
 *   - gövde varsa `content-digest` (RFC 9530; sha-256/sha-512) imzalı ve gövdeyle eşleşmeli.
 * İmza kimlik bilgisi değildir: kullanıcı kimliği her zaman bearer token'dan gelir; imza yalnız
 * isteğin hangi ajan tarafından ve değiştirilmeden gönderildiğini kanıtlar.
 */

export type HttpSignatureAlg = "ecdsa-p256-sha256" | "ed25519";

export type HttpSignatureRejectReason =
  | "HTTP_SIGNATURE_REQUIRED"
  | "HTTP_SIGNATURE_INVALID"
  | "HTTP_SIGNATURE_EXPIRED"
  | "HTTP_SIGNATURE_UNKNOWN_KEY"
  | "HTTP_SIGNATURE_DIGEST_MISMATCH";

const MESSAGES: Record<HttpSignatureRejectReason, string> = {
  HTTP_SIGNATURE_REQUIRED: "Ajan isteği RFC 9421 HTTP imzası taşımalıdır",
  HTTP_SIGNATURE_INVALID: "HTTP imzası geçersiz ya da gerekli bileşenleri kapsamıyor",
  HTTP_SIGNATURE_EXPIRED: "HTTP imzasının süresi dolmuş ya da oluşturma zamanı geçersiz",
  HTTP_SIGNATURE_UNKNOWN_KEY: "HTTP imzasının anahtarı (keyid) tanınmıyor",
  HTTP_SIGNATURE_DIGEST_MISMATCH: "Content-Digest istek gövdesiyle eşleşmiyor",
};

export class HttpSignatureError extends HttpError {
  constructor(readonly reason: HttpSignatureRejectReason) {
    super(401, reason, MESSAGES[reason]);
    this.name = "HttpSignatureError";
  }
}

interface AgentKey {
  alg: HttpSignatureAlg;
  key: KeyObject;
}

/** JWKS JSON → keyid → açık anahtar. Geçersiz yapılandırma fail-closed (503). */
export function parseAgentKeyDirectory(raw: string): Map<string, AgentKey> {
  const out = new Map<string, AgentKey>();
  if (!raw.trim()) return out;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HttpError(503, "HTTP_SIGNATURE_KEYS_INVALID", "Ajan imza anahtar dizini okunamadı");
  }
  const keys = Array.isArray(parsed) ? parsed : (parsed as { keys?: unknown })?.keys;
  if (!Array.isArray(keys)) {
    throw new HttpError(503, "HTTP_SIGNATURE_KEYS_INVALID", "Ajan imza anahtar dizini JWKS değil");
  }
  for (const jwk of keys as Array<Record<string, unknown>>) {
    const kid = typeof jwk?.kid === "string" ? jwk.kid : "";
    if (!kid || "d" in jwk) {
      throw new HttpError(
        503,
        "HTTP_SIGNATURE_KEYS_INVALID",
        "Ajan imza anahtarı `kid` içermeli ve yalnız açık anahtar olmalı"
      );
    }
    const alg: HttpSignatureAlg | null =
      jwk.kty === "EC" && jwk.crv === "P-256"
        ? "ecdsa-p256-sha256"
        : jwk.kty === "OKP" && jwk.crv === "Ed25519"
          ? "ed25519"
          : null;
    if (!alg) {
      throw new HttpError(
        503,
        "HTTP_SIGNATURE_KEYS_INVALID",
        "Ajan imza anahtarı P-256 ya da Ed25519 olmalı"
      );
    }
    const { kty, crv, x, y } = jwk as Record<string, string>;
    const key = createPublicKey({ key: { kty, crv, x, ...(y ? { y } : {}) }, format: "jwk" });
    out.set(kid, { alg, key });
  }
  return out;
}

// ---------------------------------------------------------------------------
// RFC 8941 yapılandırılmış alanların (yalnız gereken alt küme) ayrıştırılması
// ---------------------------------------------------------------------------

/** Sözlük üyelerini üst düzey virgüllerden böler (tırnak/parantez/iki nokta içini korur). */
function splitDictionary(value: string): Map<string, string> {
  const out = new Map<string, string>();
  let depth = 0;
  let quoted = false;
  let binary = false;
  let start = 0;
  const push = (end: number) => {
    const member = value.slice(start, end).trim();
    const eq = member.indexOf("=");
    if (eq > 0) out.set(member.slice(0, eq).trim(), member.slice(eq + 1).trim());
  };
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (quoted) {
      if (ch === "\\") i++;
      else if (ch === '"') quoted = false;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ":") binary = !binary;
    else if (!binary && ch === "(") depth++;
    else if (!binary && ch === ")") depth--;
    else if (ch === "," && depth === 0 && !binary) {
      push(i);
      start = i + 1;
    }
  }
  push(value.length);
  return out;
}

interface SignatureParams {
  components: string[];
  params: Record<string, string | number>;
  /** `@signature-params` satırının değeri: Signature-Input'taki ham iç liste. */
  raw: string;
}

function parseSignatureInput(raw: string): SignatureParams | null {
  const m = /^\(([^)]*)\)(.*)$/.exec(raw.trim());
  if (!m) return null;
  const components: string[] = [];
  for (const item of m[1].trim().split(/\s+/).filter(Boolean)) {
    const q = /^"([^"]+)"$/.exec(item);
    if (!q) return null;
    components.push(q[1].toLowerCase());
  }
  const params: Record<string, string | number> = {};
  for (const part of m[2].split(";").slice(1)) {
    const eq = part.indexOf("=");
    if (eq <= 0) return null;
    const key = part.slice(0, eq).trim();
    const val = part.slice(eq + 1).trim();
    if (/^"(.*)"$/.test(val)) params[key] = val.slice(1, -1);
    else if (/^-?\d+$/.test(val)) params[key] = Number(val);
    else return null;
  }
  return { components, params, raw: raw.trim() };
}

// ---------------------------------------------------------------------------
// İmza tabanı (RFC 9421 §2.5)
// ---------------------------------------------------------------------------

export interface SignableRequest {
  method: string;
  url: string;
  headers: Headers;
}

function componentValue(name: string, req: SignableRequest): string | null {
  const url = new URL(req.url);
  switch (name) {
    case "@method":
      return req.method.toUpperCase();
    case "@target-uri":
      return url.href;
    case "@authority":
      return url.host.toLowerCase();
    case "@scheme":
      return url.protocol.replace(/:$/, "").toLowerCase();
    case "@path":
      return url.pathname;
    case "@query":
      return url.search || "?";
    case "@request-target":
      return `${url.pathname}${url.search}`;
    default: {
      if (name.startsWith("@")) return null;
      const v = req.headers.get(name);
      return v === null ? null : v.trim();
    }
  }
}

function signatureBase(req: SignableRequest, input: SignatureParams): string | null {
  const lines: string[] = [];
  for (const c of input.components) {
    const v = componentValue(c, req);
    if (v === null) return null;
    lines.push(`"${c}": ${v}`);
  }
  lines.push(`"@signature-params": ${input.raw}`);
  return lines.join("\n");
}

/** RFC 9530 `Content-Digest` değeri (sha-256). */
export function contentDigest(body: Uint8Array | string): string {
  return `sha-256=:${createHash("sha256").update(body).digest("base64")}:`;
}

function digestMatches(header: string, body: Uint8Array): boolean {
  const members = splitDictionary(header);
  let checked = false;
  for (const [alg, value] of members) {
    const m = /^:([A-Za-z0-9+/=]*):$/.exec(value);
    const nodeAlg = alg === "sha-256" ? "sha256" : alg === "sha-512" ? "sha512" : null;
    if (!m || !nodeAlg) continue;
    checked = true;
    if (createHash(nodeAlg).update(body).digest("base64") !== m[1]) return false;
  }
  return checked;
}

export interface VerifyHttpSignatureOptions {
  keys: Map<string, AgentKey>;
  maxAgeSeconds: number;
  now?: Date;
}

/**
 * İsteğin RFC 9421 imzasını doğrular; başarıda imzalayan `keyid`'yi döner. Saf (ağ/DB yok).
 * Birden çok imza varsa ilk geçerli olan yeterlidir.
 */
export function verifyHttpSignature(
  req: SignableRequest,
  body: Uint8Array,
  opts: VerifyHttpSignatureOptions
): string {
  const inputHeader = req.headers.get("signature-input");
  const sigHeader = req.headers.get("signature");
  if (!inputHeader || !sigHeader) throw new HttpSignatureError("HTTP_SIGNATURE_REQUIRED");
  const inputs = splitDictionary(inputHeader);
  const sigs = splitDictionary(sigHeader);
  let lastError: HttpSignatureError = new HttpSignatureError("HTTP_SIGNATURE_INVALID");
  const nowSec = Math.floor((opts.now ?? new Date()).getTime() / 1000);
  for (const [label, rawInput] of inputs) {
    try {
      const input = parseSignatureInput(rawInput);
      const sigRaw = sigs.get(label);
      const sigMatch = sigRaw ? /^:([A-Za-z0-9+/=]+):$/.exec(sigRaw) : null;
      if (!input || !sigMatch) throw new HttpSignatureError("HTTP_SIGNATURE_INVALID");
      const has = (c: string) => input.components.includes(c);
      const targetCovered = has("@target-uri") || (has("@authority") && has("@path"));
      if (!has("@method") || !targetCovered) throw new HttpSignatureError("HTTP_SIGNATURE_INVALID");
      if (body.byteLength > 0) {
        if (!has("content-digest")) throw new HttpSignatureError("HTTP_SIGNATURE_INVALID");
        const digest = req.headers.get("content-digest");
        if (!digest || !digestMatches(digest, body)) {
          throw new HttpSignatureError("HTTP_SIGNATURE_DIGEST_MISMATCH");
        }
      }
      const created = input.params.created;
      if (typeof created !== "number" || Math.abs(nowSec - created) > opts.maxAgeSeconds) {
        throw new HttpSignatureError("HTTP_SIGNATURE_EXPIRED");
      }
      const expires = input.params.expires;
      if (expires !== undefined && (typeof expires !== "number" || expires < nowSec)) {
        throw new HttpSignatureError("HTTP_SIGNATURE_EXPIRED");
      }
      const keyid = input.params.keyid;
      const agentKey = typeof keyid === "string" ? opts.keys.get(keyid) : undefined;
      if (!agentKey || typeof keyid !== "string") {
        throw new HttpSignatureError("HTTP_SIGNATURE_UNKNOWN_KEY");
      }
      if (input.params.alg !== undefined && input.params.alg !== agentKey.alg) {
        throw new HttpSignatureError("HTTP_SIGNATURE_INVALID");
      }
      const base = signatureBase(req, input);
      if (base === null) throw new HttpSignatureError("HTTP_SIGNATURE_INVALID");
      const signature = Buffer.from(sigMatch[1], "base64");
      const ok =
        agentKey.alg === "ed25519"
          ? cryptoVerify(null, Buffer.from(base), agentKey.key, signature)
          : cryptoVerify(
              "sha256",
              Buffer.from(base),
              { key: agentKey.key, dsaEncoding: "ieee-p1363" },
              signature
            );
      if (!ok) throw new HttpSignatureError("HTTP_SIGNATURE_INVALID");
      return keyid;
    } catch (error) {
      if (!(error instanceof HttpSignatureError)) throw error;
      lastError = error;
    }
  }
  throw lastError;
}

export interface SignHttpRequestOptions {
  keyid: string;
  privateKey: KeyObject;
  alg: HttpSignatureAlg;
  created?: number;
  label?: string;
}

/**
 * İstemci (ajan) tarafı imzalayıcı: test/demo ve harici entegrasyon örneği içindir. Gövde varsa
 * `content-digest` ekler ve imzalar; dönen başlıklar isteğe eklenir.
 */
export function signHttpRequest(
  req: { method: string; url: string; headers?: Record<string, string>; body?: string },
  opts: SignHttpRequestOptions
): Record<string, string> {
  const headers: Record<string, string> = { ...(req.headers ?? {}) };
  const components = ["@method", "@target-uri"];
  if (req.body) {
    headers["content-digest"] = contentDigest(req.body);
    components.push("content-digest");
  }
  const created = opts.created ?? Math.floor(Date.now() / 1000);
  const raw = `(${components.map((c) => `"${c}"`).join(" ")});created=${created};keyid="${opts.keyid}";alg="${opts.alg}"`;
  const input = parseSignatureInput(raw)!;
  const base = signatureBase(
    { method: req.method, url: req.url, headers: new Headers(headers) },
    input
  );
  const signature =
    opts.alg === "ed25519"
      ? cryptoSign(null, Buffer.from(base!), opts.privateKey)
      : cryptoSign("sha256", Buffer.from(base!), {
          key: opts.privateKey,
          dsaEncoding: "ieee-p1363",
        });
  const label = opts.label ?? "sig1";
  return {
    ...headers,
    "signature-input": `${label}=${raw}`,
    signature: `${label}=:${signature.toString("base64")}:`,
  };
}

let cachedDirectory: { raw: string; keys: Map<string, AgentKey> } | null = null;

function agentKeyDirectory(): Map<string, AgentKey> {
  const raw = getConfig().AGENT_HTTP_SIGNATURE_KEYS;
  if (cachedDirectory?.raw !== raw) cachedDirectory = { raw, keys: parseAgentKeyDirectory(raw) };
  return cachedDirectory.keys;
}

/** Ajan imza doğrulaması açık mı (anahtar dizini yapılandırılmış mı)? */
export function httpSignaturesEnabled(): boolean {
  return getConfig().AGENT_HTTP_SIGNATURE_KEYS.trim().length > 0;
}

/**
 * Route kapısı: dizin boşsa hiçbir şey yapmaz; doluysa isteğin imzasını doğrular (gövde
 * klondan okunur, route gövdeyi yine kendisi ayrıştırır). Red → 401 + neden kodu.
 */
export async function assertAgentHttpSignature(req: Request): Promise<string | null> {
  if (!httpSignaturesEnabled()) return null;
  const keys = agentKeyDirectory();
  const body = new Uint8Array(await req.clone().arrayBuffer());
  try {
    return verifyHttpSignature(req, body, {
      keys,
      maxAgeSeconds: getConfig().AGENT_HTTP_SIGNATURE_MAX_AGE_SECONDS,
    });
  } catch (error) {
    if (error instanceof HttpSignatureError) {
      logger.warn(
        { reason: error.reason, path: new URL(req.url).pathname },
        "agent http signature rejected"
      );
    }
    throw error;
  }
}
