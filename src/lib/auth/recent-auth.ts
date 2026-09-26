import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { getConfig } from "@/lib/config/app-config";
import { HttpError, UnauthorizedError } from "@/lib/http/errors";
import { audit } from "@/lib/admin/audit";
import { requireAuth, type AccessClaims, type AuthRequest } from "./index";
import { verifyPasswordConstantTime } from "./password";
import { verifyReauthPasskey } from "./passkey";
import { issueSession, revokeSession, type SessionTokens } from "./session";
import { REFRESH_COOKIE } from "./cookies";
import { sessionContextFrom } from "./user-sessions";

/**
 * "Recent auth" — hassas işlemler için yakın zamanda yeniden doğrulama (v4#2, P0-4).
 *
 * Erişim token'ı `auth_time` claim'i taşır: son PAROLA/PASSKEY doğrulamasının zamanı.
 * Yenileme (refresh) bu değeri taşır ama tazelemez; çalınmış bir oturum (çerez / refresh
 * token) passkey ekleme/silme veya hesap silme gibi işlemleri yapamaz. Kullanım:
 *
 *   const claims = await requireRecentAuth(req);   // route'ta requireAuth yerine
 *
 * İstemci 403 `REAUTH_REQUIRED` alınca `POST /api/auth/reauth` ile parola ya da passkey
 * (`POST /api/auth/reauth/options` → WebAuthn `get()`) gönderir; yanıt taze `auth_time`'lı
 * yeni oturum çerezlerini yazar ve istek tekrarlanır.
 */

export class ReauthRequiredError extends HttpError {
  constructor(maxAgeSeconds: number) {
    super(403, "REAUTH_REQUIRED", "Bu işlem için kimliğinizi yeniden doğrulayın", {
      maxAgeSeconds,
    });
    this.name = "ReauthRequiredError";
  }
}

export class ReauthRateLimitedError extends HttpError {
  constructor(retryAfterSeconds: number) {
    super(429, "REAUTH_RATE_LIMITED", "Çok fazla hatalı deneme. Lütfen daha sonra tekrar deneyin", {
      retryAfterSeconds,
    });
    this.name = "ReauthRateLimitedError";
  }
}

/** Son birincil doğrulamanın yaşı (sn). `auth_time` yoksa sonsuz. */
export function authAgeSeconds(claims: Pick<AccessClaims, "authTime">, nowMs = Date.now()): number {
  if (!claims.authTime) return Number.POSITIVE_INFINITY;
  return Math.floor(nowMs / 1000) - claims.authTime;
}

export function isRecentAuth(
  claims: Pick<AccessClaims, "authTime">,
  nowMs = Date.now(),
  maxAgeSeconds = getConfig().RECENT_AUTH_MAX_AGE_SECONDS
): boolean {
  const age = authAgeSeconds(claims, nowMs);
  // Saat kayması için küçük negatif pay kabul edilir; gelecekten gelen değer kabul edilmez.
  return age >= -60 && age <= maxAgeSeconds;
}

/** Zaten doğrulanmış iddialar için: yakın zamanda doğrulanmamışsa 403 `REAUTH_REQUIRED`. */
export function assertRecentAuth(claims: Pick<AccessClaims, "authTime">, nowMs = Date.now()): void {
  const maxAge = getConfig().RECENT_AUTH_MAX_AGE_SECONDS;
  if (!isRecentAuth(claims, nowMs, maxAge)) throw new ReauthRequiredError(maxAge);
}

/** `requireAuth` + recent-auth: oturum yoksa 401, eskiyse 403 `REAUTH_REQUIRED`. */
export async function requireRecentAuth(req: AuthRequest): Promise<AccessClaims> {
  const claims = await requireAuth(req);
  assertRecentAuth(claims);
  return claims;
}

export type ReauthProof =
  | { method: "password"; password: string }
  | { method: "passkey"; response: AuthenticationResponseJSON };

const attemptsKey = (userId: string) => `reauth:fail:${userId}`;

async function assertNotRateLimited(userId: string): Promise<void> {
  const { REAUTH_MAX_ATTEMPTS, REAUTH_WINDOW_SECONDS } = getConfig();
  if (Number((await redis.get(attemptsKey(userId))) ?? 0) >= REAUTH_MAX_ATTEMPTS) {
    const ttl = await redis.ttl(attemptsKey(userId));
    throw new ReauthRateLimitedError(ttl > 0 ? ttl : REAUTH_WINDOW_SECONDS);
  }
}

async function recordFailure(userId: string): Promise<void> {
  await redis.incrWithTtl(attemptsKey(userId), getConfig().REAUTH_WINDOW_SECONDS);
}

/**
 * Oturumdaki kullanıcının kimliğini parola ya da KENDİ passkey'iyle yeniden doğrular.
 * Hatalı denemeler kullanıcı başına sınırlıdır (çalınan oturumla parola denemesi yapılamaz).
 */
export async function verifyReauthProof(userId: string, proof: ReauthProof): Promise<void> {
  await assertNotRateLimited(userId);
  try {
    if (proof.method === "password") {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { passwordHash: true, deletedAt: true },
      });
      const valid = await verifyPasswordConstantTime(proof.password, user?.passwordHash);
      if (!user || user.deletedAt || !valid) throw new UnauthorizedError("Parola hatalı");
    } else {
      await verifyReauthPasskey(userId, proof.response);
    }
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      await recordFailure(userId);
      await audit(userId, "auth.reauth_failed", "User", userId, { method: proof.method });
    }
    throw error;
  }
  await redis.del(attemptsKey(userId));
}

/**
 * Yeniden doğrulama sonrası oturumu tazeler: eski yenileme ailesi ve erişim token'ı iptal
 * edilir, `auth_time = şimdi` olan yeni oturum döner (çağıran `setSessionCookies` ile yazar).
 */
export async function refreshAuthTime(
  req: AuthRequest,
  claims: AccessClaims
): Promise<SessionTokens> {
  await revokeSession({
    refreshToken: req.cookies.get(REFRESH_COOKIE)?.value,
    access: { jti: claims.jti, exp: claims.exp },
  });
  const session = await issueSession(
    { id: claims.userId, role: claims.role },
    { context: sessionContextFrom(req).context }
  );
  await audit(claims.userId, "auth.reauth", "User", claims.userId);
  return session;
}
