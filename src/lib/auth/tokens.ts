import { SignJWT, jwtVerify } from "jose";
import { randomUUID } from "crypto";

/**
 * Erişim token'ları (JWT, HS256, yalnızca `jose` — Node ve proxy ortak).
 *
 * Kısa ömürlüdür (varsayılan 15 dk); rol değişiklikleri en geç bu sürede
 * yansır. İptal: `denylist.ts` (logout) — `jti` Redis'te kalan ömür kadar tutulur.
 */

export type Role = "USER" | "HOST" | "ADMIN";
export const ROLES: readonly Role[] = ["USER", "HOST", "ADMIN"];

const ISSUER = "booking-platform";
const AUDIENCE = "booking-platform:api";
const WEAK_DEFAULTS = ["change-me", "change-me-to-a-long-random-string", "secret", "test-secret"];

export interface AccessClaims {
  userId: string;
  role: Role;
  jti: string;
  /** Unix saniye. */
  exp: number;
}

/**
 * JWT imza anahtarı. Yoksa hata; production'da 32 karakterden kısa veya bilinen
 * varsayılan bir değerse uygulama açılmaz (fail-closed).
 */
export function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET ?? "";
  if (!secret) throw new Error("JWT_SECRET tanımlı değil");
  if (
    process.env.NODE_ENV === "production" &&
    (secret.length < 32 || WEAK_DEFAULTS.includes(secret))
  ) {
    throw new Error("JWT_SECRET production için zayıf (en az 32 karakter, varsayılan olmayan)");
  }
  return new TextEncoder().encode(secret);
}

export async function signAccessToken(
  userId: string,
  role: Role,
  ttlSeconds: number
): Promise<{ token: string; jti: string; expiresAt: Date }> {
  const jti = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const exp = now + ttlSeconds;
  const token = await new SignJWT({ role, typ: "access" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setJti(jti)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(getJwtSecret());
  return { token, jti, expiresAt: new Date(exp * 1000) };
}

/** Geçerli bir erişim token'ı ise iddiaları, değilse `null` döner (asla fırlatmaz). */
export async function verifyAccessToken(token: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret(), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ["HS256"],
    });
    if (payload.typ !== "access" || typeof payload.sub !== "string" || !payload.jti) return null;
    const role = payload.role;
    if (typeof role !== "string" || !ROLES.includes(role as Role)) return null;
    return {
      userId: payload.sub,
      role: role as Role,
      jti: payload.jti,
      exp: payload.exp ?? 0,
    };
  } catch {
    return null;
  }
}

/** İstekten ham token'ı çıkarır: önce `Authorization: Bearer`, sonra `token` çerezi. */
export function extractAccessToken(req: {
  headers: Headers;
  cookies: { get(name: string): { value: string } | undefined };
}): string | null {
  const header = req.headers.get("authorization");
  if (header?.startsWith("Bearer ")) {
    const value = header.slice(7).trim();
    if (value) return value;
  }
  return req.cookies.get("token")?.value ?? null;
}
