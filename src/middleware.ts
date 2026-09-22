import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { Redis } from "@upstash/redis";
import { resolveClientIp } from "@/lib/security/ip";

const JWT_SECRET = process.env.JWT_SECRET || "";
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const REDIS_TOKEN = process.env.REDIS_TOKEN || "";

const RATE_LIMIT_PREFIX = "rate-limit:";
const RATE_LIMIT_WINDOW = 60; // saniye
const RATE_LIMIT_MAX = 100; // istek / pencere
const AUTH_RATE_LIMIT_MAX = 20;
const SEARCH_RATE_LIMIT_MAX = 60;
const BOOKING_RATE_LIMIT_MAX = 30;

const PUBLIC_PATHS = [
  "/api/auth/login",
  "/api/auth/register",
  "/api/properties",
  "/api/search",
  "/api/locations",
  "/api/rooms",
];

const AUTH_PATHS = ["/api/auth/login", "/api/auth/register"];
const SEARCH_PATHS = ["/api/search", "/api/properties"];
const BOOKING_PATHS = ["/api/bookings"];

/**
 * Upstash REST istemcisi yalnızca https URL verildiğinde yapılandırılır;
 * redis:// (yerel Docker Redis) için null kalır — kuruluş anında hata vermemek
 * için tembel (lazy) başlatma kullanılır. Edge runtime'ında (middleware)
 * TCP tabanlı ioredis kullanılamadığından, redis:// senaryosunda rate-limit
 * tek instance için bellekte (in-memory) çalışır; Upstash konfigüre edilmişse
 * dağıtık (REST) olarak çalışır.
 */
let upstash: Redis | null = null;
const useUpstash = REDIS_URL.startsWith("https://");

function getUpstash(): Redis | null {
  if (useUpstash) {
    if (!upstash) {
      upstash = new Redis({ url: REDIS_URL, token: REDIS_TOKEN });
    }
    return upstash;
  }
  return null;
}

/** Tek instance belleği (redis:// fallback için) — key → istek zaman damgaları */
const memoryStore = new Map<string, number[]>();

function getClientIp(req: NextRequest): string {
  // IP-spoof korumalı çözüm (güvenilir proxy zinciri + enjeksiyon trim)
  return resolveClientIp(req);
}

function getRateLimitKey(req: NextRequest): string {
  const ip = getClientIp(req);
  const path = req.nextUrl.pathname;
  const userId = req.headers.get("x-user-id") || "anonymous";
  return `${RATE_LIMIT_PREFIX}${path}:${userId}:${ip}`;
}

function getRateLimitMax(path: string): number {
  if (AUTH_PATHS.some((p) => path.startsWith(p))) {
    return AUTH_RATE_LIMIT_MAX;
  }
  if (SEARCH_PATHS.some((p) => path.startsWith(p))) {
    return SEARCH_RATE_LIMIT_MAX;
  }
  if (BOOKING_PATHS.some((p) => path.startsWith(p))) {
    return BOOKING_RATE_LIMIT_MAX;
  }
  return RATE_LIMIT_MAX;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  reset: number;
}

/** Bellek içi sliding window: key başına son pencere içindeki zaman damgaları */
function checkMemoryRateLimit(key: string, max: number): RateLimitResult {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW * 1000;
  const stamps = memoryStore.get(key) ?? [];
  const filtered = stamps.filter((t) => t > windowStart);

  if (filtered.length >= max) {
    memoryStore.set(key, filtered);
    return { allowed: false, remaining: 0, reset: RATE_LIMIT_WINDOW };
  }

  filtered.push(now);
  memoryStore.set(key, filtered);
  if (memoryStore.size > 10_000) {
    // bellek sınırı: büyüyen mapleri tek seferde temizle
    const now2 = Date.now() - RATE_LIMIT_WINDOW * 1000;
    for (const [k, v] of memoryStore) {
      const kept = v.filter((t) => t > now2);
      if (kept.length === 0) memoryStore.delete(k);
      else memoryStore.set(k, kept);
    }
  }

  return { allowed: true, remaining: max - filtered.length, reset: RATE_LIMIT_WINDOW };
}

/** Upstash (REST) sliding window — dağıtık */
async function checkUpstashRateLimit(key: string, max: number): Promise<RateLimitResult> {
  const client = getUpstash();
  if (!client) {
    return checkMemoryRateLimit(key, max);
  }
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - RATE_LIMIT_WINDOW;

  try {
    const pipeline = client.pipeline();
    pipeline.zremrangebyscore(key, 0, windowStart);
    pipeline.zcard(key);
    const [, countResult] = await pipeline.exec();
    const count = (countResult as number | null) || 0;

    if (count >= max) {
      const ttl = await client.ttl(key);
      return { allowed: false, remaining: 0, reset: ttl > 0 ? ttl : RATE_LIMIT_WINDOW };
    }

    pipeline.zadd(key, { score: now, member: `${now}:${Math.random()}` });
    pipeline.expire(key, RATE_LIMIT_WINDOW);
    await pipeline.exec();

    return { allowed: true, remaining: max - count - 1, reset: RATE_LIMIT_WINDOW };
  } catch (error) {
    console.error("Rate limit check failed:", error);
    // fail-open: Redis hatası isteği engellemez
    return { allowed: true, remaining: max, reset: RATE_LIMIT_WINDOW };
  }
}

async function checkRateLimit(req: NextRequest): Promise<RateLimitResult> {
  const key = getRateLimitKey(req);
  const max = getRateLimitMax(req.nextUrl.pathname);
  if (!useUpstash) {
    return checkMemoryRateLimit(key, max);
  }
  return checkUpstashRateLimit(key, max);
}

async function verifyToken(req: NextRequest): Promise<{ userId: string } | null> {
  const token =
    req.cookies.get("token")?.value ||
    req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return null;

  // JWT_SECRET boşsa hiçbir token kabul edilmez (fail-closed)
  if (!JWT_SECRET) return null;

  try {
    const secret = new TextEncoder().encode(JWT_SECRET);
    const { payload } = await jwtVerify(token, secret);
    return { userId: payload.sub as string };
  } catch {
    return null;
  }
}

async function isTokenBlacklisted(token: string): Promise<boolean> {
  const client = getUpstash();
  if (!client) return false;
  try {
    const blacklistKey = `${RATE_LIMIT_PREFIX}blacklist:${token}`;
    const exists = await client.exists(blacklistKey);
    return exists === 1;
  } catch {
    return false;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/static") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  const isPublic = PUBLIC_PATHS.some((path) => pathname.startsWith(path));
  const isApi = pathname.startsWith("/api");

  if (isApi) {
    const rateLimit = await checkRateLimit(req);
    const rateLimitHeaders = new Headers();
    rateLimitHeaders.set("X-RateLimit-Limit", String(getRateLimitMax(pathname)));
    rateLimitHeaders.set("X-RateLimit-Remaining", String(rateLimit.remaining));
    rateLimitHeaders.set("X-RateLimit-Reset", String(rateLimit.reset));

    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429, headers: rateLimitHeaders }
      );
    }

    if (!isPublic) {
      const user = await verifyToken(req);
      if (!user) {
        return NextResponse.json(
          { error: "Unauthorized" },
          { status: 401, headers: rateLimitHeaders }
        );
      }

      const token =
        req.cookies.get("token")?.value ||
        req.headers.get("authorization")?.replace("Bearer ", "");
      if (token && (await isTokenBlacklisted(token))) {
        return NextResponse.json(
          { error: "Unauthorized" },
          { status: 401, headers: rateLimitHeaders }
        );
      }

      const requestHeaders = new Headers(req.headers);
      requestHeaders.set("x-user-id", user.userId);

      return NextResponse.next({
        request: {
          headers: requestHeaders,
        },
        headers: rateLimitHeaders,
      });
    }

    return NextResponse.next({ headers: rateLimitHeaders });
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/api/:path*",
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
