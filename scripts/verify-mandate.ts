/**
 * Harici mandate doğrulayıcı (v5 P1-1, ADR 0025/0035).
 *
 * Bir ajan/PSP'nin yapacağı doğrulamanın birebir örneği: YALNIZ JWKS URL'si ve mandate (JWS)
 * ile çalışır — platform veritabanına, Redis'e ya da herhangi bir sırra erişmez, uygulama
 * modüllerini içe aktarmaz. Başlıktaki `kid` ile JWKS'ten açık anahtarı seçer, imzayı ES256
 * ile doğrular; `typ`, `iss`, (verilirse) `aud` ve süreyi denetler. HS256 ya da başka
 * algoritmalı mandate reddedilir.
 *
 * Kullanım:
 *   npx tsx scripts/verify-mandate.ts --jwks https://stay.example/.well-known/jwks.json \
 *     --mandate <jws> [--audience booking-platform:agentic-checkout]
 *   (mandate `-` ise stdin'den okunur)
 * Çıkış kodu: 0 geçerli (claim'ler stdout'a JSON), 1 geçersiz, 2 kullanım hatası.
 */
import {
  createLocalJWKSet,
  createRemoteJWKSet,
  jwtVerify,
  type JSONWebKeySet,
  type JWTPayload,
} from "jose";

export const MANDATE_ALG = "ES256";
export const MANDATE_TYP = "ap2-intent-mandate+jwt";
export const MANDATE_ISSUER = "booking-platform";

export interface VerifyMandateOptions {
  /** JWKS URL'si ya da (test/çevrimdışı) hazır JWKS nesnesi. */
  jwks: string | URL | JSONWebKeySet;
  audience?: string;
  now?: Date;
}

export type VerifyMandateResult =
  { valid: true; kid: string; claims: JWTPayload } | { valid: false; error: string };

export async function verifyMandate(
  mandate: string,
  opts: VerifyMandateOptions
): Promise<VerifyMandateResult> {
  const keySet =
    typeof opts.jwks === "string" || opts.jwks instanceof URL
      ? createRemoteJWKSet(new URL(opts.jwks))
      : createLocalJWKSet(opts.jwks);
  try {
    const { payload, protectedHeader } = await jwtVerify(mandate.trim(), keySet, {
      algorithms: [MANDATE_ALG],
      typ: MANDATE_TYP,
      issuer: MANDATE_ISSUER,
      ...(opts.audience ? { audience: opts.audience } : {}),
      ...(opts.now ? { currentDate: opts.now } : {}),
    });
    if (!protectedHeader.kid) return { valid: false, error: "kid başlığı yok" };
    return { valid: true, kid: protectedHeader.kid, claims: payload };
  } catch (error) {
    const code = (error as { code?: string }).code;
    return { valid: false, error: code ?? (error as Error).message };
  }
}

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

export async function main(argv: string[]): Promise<number> {
  const jwks = arg(argv, "--jwks");
  let mandate = arg(argv, "--mandate");
  if (!jwks || !mandate) {
    console.error("Kullanım: verify-mandate --jwks <url> --mandate <jws|-> [--audience <aud>]");
    return 2;
  }
  if (mandate === "-") mandate = await readStdin();
  const out = await verifyMandate(mandate, { jwks, audience: arg(argv, "--audience") });
  if (out.valid) {
    console.log(JSON.stringify({ valid: true, kid: out.kid, claims: out.claims }, null, 2));
    return 0;
  }
  console.error(JSON.stringify({ valid: false, error: out.error }));
  return 1;
}

if (/verify-mandate\.ts$/.test((process.argv[1] ?? "").replace(/\\/g, "/"))) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
