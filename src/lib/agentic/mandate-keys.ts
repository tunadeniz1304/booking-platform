import {
  createECDH,
  createHash,
  createPrivateKey,
  createPublicKey,
  hkdfSync,
  type JsonWebKey,
  type KeyObject,
} from "node:crypto";
import { getJwtSecret } from "@/lib/auth/tokens";
import { isDemoMode } from "@/lib/config/demo";
import { HttpError } from "@/lib/http/errors";

/**
 * AP2 mandate anahtar halkası (v2-P1-1, ADR 0025).
 *
 * Mandate'ler ES256 (ECDSA P-256) ile imzalanır; açık anahtarlar `/.well-known/jwks.json`'da
 * yayımlanır, böylece ajan/PSP mandate'i platforma sormadan doğrulayabilir.
 *
 * - Etkin (imzalayan) anahtar: `AGENT_MANDATE_PRIVATE_KEY` — PKCS#8 PEM ya da özel EC JWK
 *   (JSON). Yalnız P-256 kabul edilir; başka eğri/RSA/simetrik anahtar her ortamda reddedilir.
 * - `kid`: `AGENT_MANDATE_KEY_ID` > JWK `kid` > RFC 7638 thumbprint.
 * - Rotasyon: eski anahtarların AÇIK hâlleri `AGENT_MANDATE_PREVIOUS_PUBLIC_KEYS`'te (JWKS
 *   JSON ya da JWK dizisi, `kid` zorunlu). Bunlar yalnız doğrulamada kullanılır ve JWKS'te
 *   yayımlanır; süresi dolmamış eski mandate'ler anahtar değişiminden sonra da geçerlidir.
 * - Anahtar verilmemişse: demo/test ortamında `AGENT_MANDATE_SIGNING_KEY` (≥32) ya da JWT
 *   sırrından HKDF ile deterministik P-256 anahtar türetilir (yeniden başlatmada aynı kid);
 *   demo dışında (production) fail-closed → 503 `MANDATE_KEYS_UNAVAILABLE`.
 */

export const MANDATE_ALG = "ES256";
const CURVE = "P-256";
const NODE_CURVE = "prime256v1";
/** P-256 grup mertebesi n. */
const P256_ORDER = BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551");
const DERIVE_INFO = "booking-platform:agent-mandate:es256:v1";
/** Türetme tohumu için alt sınır (eski HS256 anahtarıyla aynı kural). */
const MIN_SEED_LENGTH = 32;
/** JWKS'te yayımlanabilecek (açık) JWK alanları. */
const PUBLIC_MEMBERS = ["kty", "crv", "x", "y"] as const;
const PRIVATE_MEMBERS = ["d", "p", "q", "dp", "dq", "qi", "k", "oth"] as const;

export class MandateKeyConfigError extends HttpError {
  /** Yalnız log içindir; istemciye dönmez. */
  constructor(readonly detail: string) {
    super(503, "MANDATE_KEYS_UNAVAILABLE", "Mandate imza anahtarı yapılandırılmamış veya geçersiz");
    this.name = "MandateKeyConfigError";
  }
}

export interface MandatePublicJwk {
  kty: "EC";
  crv: typeof CURVE;
  x: string;
  y: string;
  kid: string;
  alg: typeof MANDATE_ALG;
  use: "sig";
}

export interface MandateKeyRing {
  /** İmzalayan anahtar. */
  active: { kid: string; privateKey: KeyObject };
  /** kid → doğrulama anahtarı (etkin + eski). */
  verifiers: Map<string, KeyObject>;
  /** Yalnız açık alanlar; ilk eleman etkin anahtar. */
  jwks: MandatePublicJwk[];
  /** Anahtar env'den değil türetmeden geliyorsa true (yalnız demo/test). */
  derived: boolean;
}

type Env = Record<string, string | undefined>;

function assertP256(key: KeyObject, what: string): void {
  if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== NODE_CURVE) {
    throw new MandateKeyConfigError(`${what} ES256 için P-256 EC anahtarı olmalı`);
  }
}

/** RFC 7638 JWK thumbprint (EC: crv, kty, x, y — sözlük sırası). */
export function jwkThumbprint(jwk: { crv: string; x: string; y: string }): string {
  const canonical = JSON.stringify({ crv: jwk.crv, kty: "EC", x: jwk.x, y: jwk.y });
  return createHash("sha256").update(canonical).digest("base64url");
}

function toPublicJwk(key: KeyObject, kid?: string): MandatePublicJwk {
  const pub = key.type === "public" ? key : createPublicKey(key);
  const jwk = pub.export({ format: "jwk" }) as JsonWebKey;
  if (jwk.kty !== "EC" || jwk.crv !== CURVE || !jwk.x || !jwk.y) {
    throw new MandateKeyConfigError("Açık anahtar P-256 EC değil");
  }
  const coords = { crv: CURVE, x: jwk.x, y: jwk.y } as const;
  return {
    kty: "EC",
    ...coords,
    kid: kid || jwkThumbprint(coords),
    alg: MANDATE_ALG,
    use: "sig",
  };
}

function parsePrivateKey(raw: string): { key: KeyObject; kid?: string } {
  try {
    if (raw.startsWith("{")) {
      const jwk = JSON.parse(raw) as JsonWebKey & { kid?: string };
      if (!jwk.d) throw new MandateKeyConfigError("AGENT_MANDATE_PRIVATE_KEY özel anahtar değil");
      return {
        key: createPrivateKey({ key: jwk, format: "jwk" }),
        kid: typeof jwk.kid === "string" ? jwk.kid : undefined,
      };
    }
    // Env'de tek satır PEM için kaçışlı `\n` kabul edilir.
    return { key: createPrivateKey(raw.replace(/\\n/g, "\n")) };
  } catch (error) {
    if (error instanceof MandateKeyConfigError) throw error;
    throw new MandateKeyConfigError("AGENT_MANDATE_PRIVATE_KEY okunamadı");
  }
}

function parsePreviousKeys(raw: string): Array<{ kid: string; key: KeyObject }> {
  let list: unknown;
  try {
    const parsed: unknown = JSON.parse(raw);
    list = Array.isArray(parsed) ? parsed : (parsed as { keys?: unknown }).keys;
  } catch {
    throw new MandateKeyConfigError("AGENT_MANDATE_PREVIOUS_PUBLIC_KEYS geçerli JSON değil");
  }
  if (!Array.isArray(list)) {
    throw new MandateKeyConfigError("AGENT_MANDATE_PREVIOUS_PUBLIC_KEYS JWK listesi değil");
  }
  return list.map((item) => {
    const jwk = (item ?? {}) as Record<string, unknown>;
    if (PRIVATE_MEMBERS.some((m) => m in jwk)) {
      throw new MandateKeyConfigError("Eski anahtar listesi özel anahtar materyali içeriyor");
    }
    if (typeof jwk.kid !== "string" || !jwk.kid) {
      throw new MandateKeyConfigError("Eski anahtarda kid zorunlu");
    }
    let key: KeyObject;
    try {
      const pub = Object.fromEntries(PUBLIC_MEMBERS.map((m) => [m, jwk[m]])) as JsonWebKey;
      key = createPublicKey({ key: pub, format: "jwk" });
    } catch {
      throw new MandateKeyConfigError(`Eski anahtar okunamadı (kid=${jwk.kid})`);
    }
    assertP256(key, `Eski anahtar (kid=${jwk.kid})`);
    return { kid: jwk.kid, key };
  });
}

/** Tohumdan deterministik P-256 özel anahtar (yalnız demo/test). */
export function deriveP256Key(seed: Uint8Array): KeyObject {
  const okm = Buffer.from(hkdfSync("sha256", seed, Buffer.alloc(0), DERIVE_INFO, 48));
  // 48 bayt → mod (n−1) + 1: [1, n−1] aralığında, sapması ihmal edilebilir skaler.
  const d = (BigInt(`0x${okm.toString("hex")}`) % (P256_ORDER - BigInt(1))) + BigInt(1);
  const dBytes = Buffer.from(d.toString(16).padStart(64, "0"), "hex");
  const ecdh = createECDH(NODE_CURVE);
  ecdh.setPrivateKey(dBytes);
  const pub = ecdh.getPublicKey(); // 0x04 || x || y
  return createPrivateKey({
    key: {
      kty: "EC",
      crv: CURVE,
      d: dBytes.toString("base64url"),
      x: pub.subarray(1, 33).toString("base64url"),
      y: pub.subarray(33, 65).toString("base64url"),
    },
    format: "jwk",
  });
}

function derivationSeed(env: Env): Uint8Array {
  const configured = env.AGENT_MANDATE_SIGNING_KEY?.trim() ?? "";
  if (configured.length >= MIN_SEED_LENGTH) return new TextEncoder().encode(configured);
  return getJwtSecret();
}

function buildKeyRing(env: Env): MandateKeyRing {
  const rawPrivate = env.AGENT_MANDATE_PRIVATE_KEY?.trim() ?? "";
  let privateKey: KeyObject;
  let jwkKid: string | undefined;
  let derived = false;
  if (rawPrivate) {
    ({ key: privateKey, kid: jwkKid } = parsePrivateKey(rawPrivate));
  } else if (isDemoMode(env)) {
    privateKey = deriveP256Key(derivationSeed(env));
    derived = true;
  } else {
    throw new MandateKeyConfigError(
      "AGENT_MANDATE_PRIVATE_KEY tanımlı değil (demo dışında türetilmiş anahtar kullanılmaz)"
    );
  }
  assertP256(privateKey, "AGENT_MANDATE_PRIVATE_KEY");
  const activeJwk = toPublicJwk(privateKey, env.AGENT_MANDATE_KEY_ID?.trim() || jwkKid);

  const verifiers = new Map<string, KeyObject>([[activeJwk.kid, createPublicKey(privateKey)]]);
  const jwks: MandatePublicJwk[] = [activeJwk];
  const rawPrevious = env.AGENT_MANDATE_PREVIOUS_PUBLIC_KEYS?.trim() ?? "";
  for (const prev of rawPrevious ? parsePreviousKeys(rawPrevious) : []) {
    if (verifiers.has(prev.kid)) continue; // etkin anahtarla aynı kid → etkin kazanır
    verifiers.set(prev.kid, prev.key);
    jwks.push(toPublicJwk(prev.key, prev.kid));
  }
  return { active: { kid: activeJwk.kid, privateKey }, verifiers, jwks, derived };
}

const CACHE_VARS = [
  "AGENT_MANDATE_PRIVATE_KEY",
  "AGENT_MANDATE_KEY_ID",
  "AGENT_MANDATE_PREVIOUS_PUBLIC_KEYS",
  "AGENT_MANDATE_SIGNING_KEY",
  "JWT_SECRET",
  "DEMO_MODE",
  "NODE_ENV",
] as const;
let cache: { fingerprint: string; ring: MandateKeyRing } | null = null;

/** Anahtar halkası; ilgili env değişmedikçe önbellekten. Hatalı yapılandırmada fırlatır. */
export function mandateKeyRing(env: Env = process.env): MandateKeyRing {
  const fingerprint = JSON.stringify(CACHE_VARS.map((name) => env[name] ?? null));
  if (cache?.fingerprint === fingerprint) return cache.ring;
  let ring: MandateKeyRing;
  try {
    ring = buildKeyRing(env);
  } catch (error) {
    // Beklenmeyen her kurulum hatası (ör. JWT_SECRET yok) de yapılandırma hatasıdır: 503.
    if (error instanceof MandateKeyConfigError) throw error;
    throw new MandateKeyConfigError(error instanceof Error ? error.message : String(error));
  }
  cache = { fingerprint, ring };
  return ring;
}

/** `/.well-known/jwks.json` gövdesi: yalnız açık anahtarlar. */
export function publicJwks(env: Env = process.env): { keys: MandatePublicJwk[] } {
  return { keys: mandateKeyRing(env).jwks.map((k) => ({ ...k })) };
}
