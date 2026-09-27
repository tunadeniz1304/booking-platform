import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { extractAccessToken, verifyAccessToken, type AccessClaims } from "@/lib/auth/tokens";
import { isAccessTokenDenied } from "@/lib/auth/denylist";
import { isTokenVersionCurrent } from "@/lib/auth/token-version";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "@/lib/auth/cookies";
import { redis } from "@/lib/redis";
import { getConfig } from "@/lib/config/app-config";
import { anonymousIdentities, SHARED_ANON_KEY } from "@/lib/security/ip";
import { categorize, checkRateLimit } from "@/lib/security/rate-limit";
import { AUTH_DEGRADED_HEADER, AUTH_DEGRADED_PATHS } from "@/lib/security/auth-degraded";
import {
  allowedOriginsFromEnv,
  isCsrfViolation,
  isLoginCsrfViolation,
  requestOrigin,
} from "@/lib/security/csrf";
import { buildCsp } from "@/lib/security/headers";
import { CSRF_EXEMPT_PREFIXES, isPublicApi, isPublicDiscovery } from "@/lib/security/public-routes";

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
  if (await isAccessTokenDenied(claims.jti)) return null;
  return (await isTokenVersionCurrent(claims.userId, claims.tv)) ? claims : null;
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
  // Anonimde anahtar soket/güvenilir-proxy IP'sidir (IPv6 /64). IP bilinmiyorsa
  // paylaşılan `anon` kovası birincildir; UA parmak izi yalnızca ikincil, daha dar
  // bir kovadır — UA değiştirmek toplam kotayı büyütmez (v4#4).
  // v5#6: Next 16'da `NextRequest.ip` yok ve kendi barındırmada soket adresi Proxy'ye
  // ulaşmaz; istemci IP'si yalnızca güvenilir ters vekilin (Caddy, ADR 0034) başlığından gelir.
  const category = categorize(pathname);
  const identities = claims
    ? { primary: `u:${claims.userId}`, secondary: null }
    : anonymousIdentities(req.headers, {
        trustedProxyHops: config.TRUSTED_PROXY_HOPS,
        trustRealIpHeader: config.TRUST_REAL_IP_HEADER,
      });
  const sharedPrimary = identities.primary === SHARED_ANON_KEY;
  // v5#6: e-postalı auth uçlarında paylaşılan kova tükenince istemcinin kendi (ikincil) kovası
  // boşsa 429 yerine yavaşlatılmış yola (e-posta kovası + PoW) düşülür: tek saldırgan herkesin
  // girişini kilitleyemez. İkincil kova önce sayılır ki saldırgan kendi kovasında 429 alsın.
  const degradable =
    sharedPrimary &&
    category === "auth" &&
    method === "POST" &&
    (AUTH_DEGRADED_PATHS as readonly string[]).includes(pathname);
  let decision;
  let degraded = false;
  if (degradable && identities.secondary) {
    decision = await checkRateLimit(redis, { category, identity: identities.secondary, config });
    if (decision.allowed && !decision.unavailable) {
      const shared = await checkRateLimit(redis, {
        category,
        identity: identities.primary,
        config,
        limitMultiplier: config.RATE_LIMIT_ANON_SHARED_MULTIPLIER,
      });
      if (shared.unavailable) decision = shared;
      else degraded = !shared.allowed;
    }
  } else {
    decision = await checkRateLimit(redis, {
      category,
      identity: identities.primary,
      config,
      limitMultiplier: sharedPrimary ? config.RATE_LIMIT_ANON_SHARED_MULTIPLIER : 1,
    });
    if (identities.secondary && decision.allowed && !decision.unavailable) {
      decision = await checkRateLimit(redis, {
        category,
        identity: identities.secondary,
        config,
      });
    }
  }
  if (degraded) requestHeaders.set(AUTH_DEGRADED_HEADER, "1");
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
    const csrfInput = {
      method,
      headers: req.headers,
      selfOrigin: requestOrigin(req.nextUrl, req.headers),
      hasCookieAuth: Boolean(req.cookies.get(ACCESS_COOKIE) || req.cookies.get(REFRESH_COOKIE)),
      hasBearer: Boolean(req.headers.get("authorization")?.startsWith("Bearer ")),
      allowedOrigins: allowedOriginsFromEnv(),
    };
    const violation =
      isCsrfViolation(csrfInput) ||
      (pathname.startsWith("/api/auth/") && isLoginCsrfViolation(csrfInput));
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
    // MCP istemcileri JSON-RPC hata gövdesi ve `WWW-Authenticate` bekler (ADR 0015).
    if (pathname.startsWith("/api/mcp")) {
      responseHeaders.set("WWW-Authenticate", 'Bearer realm="booking-mcp"');
      responseHeaders.set("Cache-Control", "no-store");
      return json(
        401,
        { jsonrpc: "2.0", error: { code: -32001, message: "Bearer token gerekli" }, id: null },
        responseHeaders
      );
    }
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
  // Yavaşlatılmış auth işaretini yalnız proxy yazar (v5#6).
  requestHeaders.delete(AUTH_DEGRADED_HEADER);

  const requestId = requestIdFrom(req);
  requestHeaders.set("x-request-id", requestId);

  if (req.nextUrl.pathname.startsWith("/api")) {
    return handleApi(req, requestHeaders, requestId);
  }

  // Keşif belgeleri (JWKS, UCP profili) herkese açık JSON'dur: oturum ve sayfa CSP'si yok.
  if (isPublicDiscovery(req.nextUrl.pathname)) {
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set("x-request-id", requestId);
    return response;
  }

  const nonce = Buffer.from(randomUUID()).toString("base64");
  const csp = buildCsp(nonce, process.env.NODE_ENV === "development", {
    stripe: process.env.PAYMENT_PROVIDER?.trim().toLowerCase() === "stripe",
  });
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("x-request-id", requestId);
  // Sayfa dili çerezden, yoksa Accept-Language'ten çözülür; paylaşılan önbellek dilleri karıştırmasın.
  response.headers.append("Vary", "Accept-Language, Cookie");
  return response;
}

export const config = {
  matcher: [
    "/api/:path*",
    {
      source:
        "/((?!_next/static|_next/image|favicon.ico|demo/|vendor/|sw\\.js$|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
