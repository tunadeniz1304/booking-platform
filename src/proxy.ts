import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { extractAccessToken, verifyAccessToken, type AccessClaims } from "@/lib/auth/tokens";
import { isAccessTokenDenied } from "@/lib/auth/denylist";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "@/lib/auth/cookies";
import { redis } from "@/lib/redis";
import { getConfig } from "@/lib/config/app-config";
import { resolveClientIp } from "@/lib/security/ip";
import { categorize, checkRateLimit } from "@/lib/security/rate-limit";
import { allowedOriginsFromEnv, isCsrfViolation, requestOrigin } from "@/lib/security/csrf";
import { buildCsp } from "@/lib/security/headers";
import { CSRF_EXEMPT_PREFIXES, isPublicApi } from "@/lib/security/public-routes";

/**
 * Ağ sınırı (Next 16 Proxy, Node runtime):
 *
 *  1. İstemcinin gönderdiği kimlik başlıkları (`x-user-id`, `x-user-role`) HER
 *     istekte önce silinir; yalnızca doğrulanmış token'dan yeniden yazılır.
 *  2. API: rate-limit (anahtar = doğrulanmış `sub` veya güvenilir IP), CSRF
 *     (çerezli durum değiştiren istekler için Origin kontrolü), korumalı uçlarda
 *     401. Route handler'lar ayrıca kendi yetki kontrolünü yapar (derinlemesine savunma).
 *  3. Sayfalar: istek başına nonce'lu CSP.
 */

const IDENTITY_HEADERS = ["x-user-id", "x-user-role", "x-user-email"] as const;

function requestIdFrom(req: NextRequest): string {
  const incoming = req.headers.get("x-request-id");
  return incoming && /^[A-Za-z0-9-]{8,64}$/.test(incoming) ? incoming : randomUUID();
}

async function verifiedClaims(req: NextRequest): Promise<AccessClaims | null> {
  const token = extractAccessToken(req);
  if (!token) return null;
  const claims = await verifyAccessToken(token);
  if (!claims) return null;
  return (await isAccessTokenDenied(claims.jti)) ? null : claims;
}

function json(status: number, body: Record<string, unknown>, headers: Headers): NextResponse {
  return NextResponse.json(body, { status, headers });
}

async function handleApi(req: NextRequest, requestHeaders: Headers, requestId: string) {
  const { pathname } = req.nextUrl;
  const method = req.method.toUpperCase();
  const config = getConfig();
  const claims = await verifiedClaims(req);

  const responseHeaders = new Headers({ "x-request-id": requestId });

  // 1) Rate-limit — kimlik yalnızca doğrulanmış kaynaklardan.
  const identity = claims
    ? `u:${claims.userId}`
    : `ip:${resolveClientIp(req.headers, config.TRUSTED_PROXY_HOPS)}`;
  const decision = await checkRateLimit(redis, {
    category: categorize(pathname),
    identity,
    config,
  });
  responseHeaders.set("X-RateLimit-Limit", String(decision.limit));
  responseHeaders.set("X-RateLimit-Remaining", String(decision.remaining));
  responseHeaders.set("X-RateLimit-Reset", String(decision.resetSeconds));
  if (decision.unavailable) {
    return json(
      503,
      { error: "Servis geçici olarak kullanılamıyor", code: "RATE_LIMIT_UNAVAILABLE" },
      responseHeaders
    );
  }
  if (!decision.allowed) {
    responseHeaders.set("Retry-After", String(decision.resetSeconds));
    return json(
      429,
      { error: "Çok fazla istek. Lütfen biraz sonra tekrar deneyin.", code: "RATE_LIMITED" },
      responseHeaders
    );
  }

  // 2) CSRF — çerezli, durum değiştiren istekler.
  if (!CSRF_EXEMPT_PREFIXES.some((p) => pathname.startsWith(p))) {
    const violation = isCsrfViolation({
      method,
      headers: req.headers,
      selfOrigin: requestOrigin(req.nextUrl, req.headers),
      hasCookieAuth: Boolean(req.cookies.get(ACCESS_COOKIE) || req.cookies.get(REFRESH_COOKIE)),
      hasBearer: Boolean(req.headers.get("authorization")?.startsWith("Bearer ")),
      allowedOrigins: allowedOriginsFromEnv(),
    });
    if (violation) {
      return json(
        403,
        { error: "İstek kaynağı doğrulanamadı", code: "CSRF_REJECTED" },
        responseHeaders
      );
    }
  }

  // 3) Korumalı uçlar oturum ister.
  if (!claims && !isPublicApi(pathname, method)) {
    return json(401, { error: "Oturum açmanız gerekiyor", code: "UNAUTHORIZED" }, responseHeaders);
  }

  // 4) Kimlik başlıkları yalnızca doğrulanmış token'dan.
  if (claims) {
    requestHeaders.set("x-user-id", claims.userId);
    requestHeaders.set("x-user-role", claims.role);
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  responseHeaders.forEach((value, key) => response.headers.set(key, value));
  return response;
}

export async function proxy(req: NextRequest) {
  const requestHeaders = new Headers(req.headers);
  for (const name of IDENTITY_HEADERS) requestHeaders.delete(name);

  const requestId = requestIdFrom(req);
  requestHeaders.set("x-request-id", requestId);

  if (req.nextUrl.pathname.startsWith("/api")) {
    return handleApi(req, requestHeaders, requestId);
  }

  const nonce = Buffer.from(randomUUID()).toString("base64");
  const csp = buildCsp(nonce, process.env.NODE_ENV === "development");
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("x-request-id", requestId);
  return response;
}

export const config = {
  matcher: [
    "/api/:path*",
    {
      source:
        "/((?!_next/static|_next/image|favicon.ico|demo/|vendor/|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
