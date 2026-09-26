import { createHmac, hkdfSync, timingSafeEqual } from "crypto";
import { HttpError } from "@/lib/http/errors";

/**
 * Bölünmüş ödeme davet linki (P1-2): `<base64url(payload)>.<base64url(HMAC-SHA256)>`.
 * Payload = { s: payId, n: davet nonce'u, e: son geçerlilik (ms) }. Anahtar JWT_SECRET'tan
 * HKDF ile türetilir (alan ayrımı: oturum imzalarıyla aynı anahtar KULLANILMAZ). Link yalnızca
 * payı gösterir; ödeme için yine oturum + doğrulanmış e-posta gerekir. Nonce DB'de tutulur →
 * yeniden üretilen link eskisini geçersiz kılar.
 */

export interface ShareTokenPayload {
  s: string;
  n: string;
  e: number;
}

export class ShareLinkInvalidError extends HttpError {
  constructor() {
    super(404, "SHARE_LINK_INVALID", "Ödeme linki geçersiz");
    this.name = "ShareLinkInvalidError";
  }
}

export class ShareLinkExpiredError extends HttpError {
  constructor() {
    super(410, "SHARE_LINK_EXPIRED", "Ödeme linkinin süresi doldu");
    this.name = "ShareLinkExpiredError";
  }
}

let cachedKey: { secret: string; key: Buffer } | null = null;

function signingKey(): Buffer {
  const secret = process.env.JWT_SECRET ?? "";
  if (secret.length < 32) {
    throw new HttpError(503, "SPLIT_PAY_UNAVAILABLE", "Bölünmüş ödeme yapılandırılmamış");
  }
  if (cachedKey?.secret !== secret) {
    const key = Buffer.from(
      hkdfSync("sha256", secret, "booking-split-pay", "split-pay-invite:v1", 32)
    );
    cachedKey = { secret, key };
  }
  return cachedKey.key;
}

function mac(body: string): Buffer {
  return createHmac("sha256", signingKey()).update(body).digest();
}

export function signShareToken(payload: ShareTokenPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${mac(body).toString("base64url")}`;
}

/** İmza (timing-safe) → 404; süre → 410. Geçerliyse payload. */
export function verifyShareToken(token: string, now = Date.now()): ShareTokenPayload {
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined || token.length > 512) {
    throw new ShareLinkInvalidError();
  }
  const expected = mac(body);
  const actual = Buffer.from(sig, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new ShareLinkInvalidError();
  }
  let payload: ShareTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as ShareTokenPayload;
  } catch {
    throw new ShareLinkInvalidError();
  }
  if (
    typeof payload?.s !== "string" ||
    typeof payload.n !== "string" ||
    typeof payload.e !== "number"
  ) {
    throw new ShareLinkInvalidError();
  }
  if (payload.e < now) throw new ShareLinkExpiredError();
  return payload;
}

export function shareUrl(token: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/+$/, "");
  return `${base}/pay/share/${encodeURIComponent(token)}`;
}
