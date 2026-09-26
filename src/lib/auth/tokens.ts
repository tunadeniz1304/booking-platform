import { SignJWT, jwtVerify } from "jose";
import { randomUUID } from "crypto";

/**
 * Erişim token'ları (JWT, HS256, yalnızca `jose` — Node ve proxy ortak).
 *
 * Kısa ömürlüdür (varsayılan 5 dk). İptal: `denylist.ts` (logout — `jti` Redis'te kalan
 * ömür kadar) ve `tv` (oturum dönemi, `token-version.ts`): hesap silme / rol değişimi /
 * şifre sıfırlamada kullanıcının tüm token'ları anında geçersizleşir (v3#5).
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
  /** Üretildiği andaki `User.tokenVersion`. */
  tv: number;
  /**
   * Son birincil kimlik doğrulamanın zamanı (Unix sn, OIDC `auth_time`). Yenilemede
   * korunur, yalnızca parola/passkey ile giriş veya yeniden doğrulamada güncellenir (v4#2).
   * Claim yoksa 0 (hassas işlemler için "yakın zamanda doğrulanmamış").
   */
  authTime?: number;
}

/** Test dışındaki HER ortamda (development dahil) zayıf anahtar reddedilir (v4#5). */
export function isWeakJwtSecret(secret: string): boolean {
  return secret.length < 32 || WEAK_DEFAULTS.includes(secret);
}

/**
 * JWT imza anahtarı. Yoksa hata; test dışındaki her ortamda 32 karakterden kısa
 * veya bilinen varsayılan bir değerse uygulama açılmaz (fail-closed, v4#5 — önceden
 * yalnızca production'da kontrol ediliyordu; demo/dev ortamları da internete açılabilir).
 */
export function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET ?? "";
  if (!secret) throw new Error("JWT_SECRET tanımlı değil");
  if (process.env.NODE_ENV !== "test" && isWeakJwtSecret(secret)) {
    throw new Error("JWT_SECRET zayıf (en az 32 karakter, varsayılan olmayan)");
  }
  return new TextEncoder().encode(secret);
}

export async function signAccessToken(
  userId: string,
  role: Role,
  ttlSeconds: number,
  tokenVersion = 0,
  /** Son birincil doğrulama (Unix sn); verilmezse claim yazılmaz (v4#2). */
  authTime?: number
): Promise<{ token: string; jti: string; expiresAt: Date }> {
  const jti = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const exp = now + ttlSeconds;
  const token = await new SignJWT({
    role,
    typ: "access",
    tv: tokenVersion,
    ...(authTime !== undefined ? { auth_time: authTime } : {}),
  })
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
      tv: typeof payload.tv === "number" ? payload.tv : 0,
      authTime: typeof payload.auth_time === "number" ? payload.auth_time : 0,
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
