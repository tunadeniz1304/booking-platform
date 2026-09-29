import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";
import { getAuth } from "@/lib/auth";
import { getJwtSecret } from "@/lib/auth/tokens";
import { getConfig } from "@/lib/config/app-config";
import { redis } from "@/lib/redis";
import { anonymousIdentities } from "@/lib/security/ip";

/**
 * Canlı görüntülenme sayımı için izleyici kimliği (v4#18).
 *
 * Sayım yalnızca doğrulanmış bir kimlik başına yapılır:
 *  - oturum açmış kullanıcı → `u:<userId>` (imzalı JWT),
 *  - anonim cihaz → sunucunun HMAC ile imzaladığı `bk_viewer` çerezi → `d:<id>`.
 * İmzasız/sahte çerez sayılmaz. Yeni cihaz çerezi basımı istemci anahtarı (IP /
 * paylaşılan anonim kova) başına `LIVE_VIEWER_MINT_MAX` ile sınırlıdır; böylece
 * çerezleri atıp yeniden bağlanarak sayacı şişirmek sınırlanır.
 */

export const VIEWER_COOKIE = "bk_viewer";
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

function signature(id: string): string {
  return createHmac("sha256", getJwtSecret()).update(`live-viewer:${id}`).digest("base64url");
}

/** `<id>.<imza>` biçiminde imzalı çerez değeri üretir. */
export function signViewerId(id: string): string {
  return `${id}.${signature(id)}`;
}

/** İmza geçerliyse izleyici kimliğini, değilse null döner. */
export function verifyViewerCookie(value: string | undefined | null): string | null {
  if (!value) return null;
  const dot = value.indexOf(".");
  if (dot <= 0) return null;
  const id = value.slice(0, dot);
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(id)) return null;
  const given = Buffer.from(value.slice(dot + 1));
  const expected = Buffer.from(signature(id));
  return given.length === expected.length && timingSafeEqual(given, expected) ? id : null;
}

function cookieHeader(value: string): string {
  const secure = process.env.NODE_ENV === "production" && process.env.COOKIE_SECURE !== "false";
  return [
    `${VIEWER_COOKIE}=${value}`,
    "Path=/",
    `Max-Age=${COOKIE_MAX_AGE}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export interface ViewerIdentity {
  /** Sayıma girecek kimlik; null → bu bağlantı sayılmaz. */
  viewerId: string | null;
  /** Yeni basılan cihaz çerezi için `Set-Cookie` değeri. */
  setCookie: string | null;
}

export async function resolveViewer(req: NextRequest): Promise<ViewerIdentity> {
  const claims = await getAuth(req);
  if (claims) return { viewerId: `u:${claims.userId}`, setCookie: null };

  const existing = verifyViewerCookie(req.cookies.get(VIEWER_COOKIE)?.value);
  if (existing) return { viewerId: `d:${existing}`, setCookie: null };

  const config = getConfig();
  const { primary } = anonymousIdentities(req.headers, {
    trustedProxyHops: config.TRUSTED_PROXY_HOPS,
    trustRealIpHeader: config.TRUST_REAL_IP_HEADER,
  });
  try {
    const minted = await redis.incrWithTtl(
      `live:viewer-mint:${primary}`,
      config.LIVE_VIEW_DEDUPE_SECONDS
    );
    if (minted > config.LIVE_VIEWER_MINT_MAX) return { viewerId: null, setCookie: null };
  } catch {
    return { viewerId: null, setCookie: null }; // sayaç yoksa sayma (zararsız)
  }
  const id = randomBytes(18).toString("base64url");
  return { viewerId: `d:${id}`, setCookie: cookieHeader(signViewerId(id)) };
}
