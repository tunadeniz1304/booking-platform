import { EmailNotVerifiedError, ForbiddenError, UnauthorizedError } from "@/lib/http/errors";
import { prisma } from "@/lib/prisma";
import { extractAccessToken, verifyAccessToken, type AccessClaims, type Role } from "./tokens";
import { isAccessTokenDenied } from "./denylist";
import { isTokenVersionCurrent } from "./token-version";
import { isSessionRevoked } from "./session";

export type { AccessClaims, Role } from "./tokens";
export { ROLES, signAccessToken, verifyAccessToken, extractAccessToken } from "./tokens";
export { hashPassword, verifyPasswordConstantTime } from "./password";

export interface AuthRequest {
  headers: Headers;
  cookies: { get(name: string): { value: string } | undefined };
}

/**
 * İsteği doğrular (Bearer başlığı veya httpOnly `token` çerezi). Geçersiz,
 * süresi dolmuş veya iptal edilmiş token → `null`. Rol her zaman token'dan
 * gelir; istemcinin gönderdiği `x-user-*` başlıklarına ASLA güvenilmez.
 */
export async function getAuth(req: AuthRequest): Promise<AccessClaims | null> {
  const token = extractAccessToken(req);
  if (!token) return null;
  const claims = await verifyAccessToken(token);
  if (!claims) return null;
  if (await isAccessTokenDenied(claims.jti)) return null;
  if (!(await isTokenVersionCurrent(claims.userId, claims.tv))) return null;
  // Uzaktan çıkış (P0-4): iptal edilen oturumun erişim token'ı süresini beklemeden düşer.
  if (claims.sessionId && (await isSessionRevoked(claims.sessionId))) return null;
  return claims;
}

/** Oturum zorunlu: yoksa `UnauthorizedError` (401). */
export async function requireAuth(req: AuthRequest): Promise<AccessClaims> {
  const claims = await getAuth(req);
  if (!claims) throw new UnauthorizedError();
  return claims;
}

/** Rol zorunlu: oturum yoksa 401, rol uymuyorsa 403. */
export async function requireRole(req: AuthRequest, roles: readonly Role[]): Promise<AccessClaims> {
  const claims = await requireAuth(req);
  if (!roles.includes(claims.role)) throw new ForbiddenError();
  return claims;
}

/**
 * E-postası doğrulanmış oturum zorunlu (v4#6): rezervasyon, ödeme, yorum, devir ve
 * ajan checkout gibi para/itibar etkili işlemler. Oturum yoksa 401; kullanıcı yoksa
 * veya `emailVerifiedAt` boşsa 403 `EMAIL_NOT_VERIFIED`. Durum her istekte DB'den
 * okunur (token'a gömülmez) — doğrulama sonrası yeniden giriş gerekmez.
 */
export async function requireVerifiedEmail(req: AuthRequest): Promise<AccessClaims> {
  const claims = await requireAuth(req);
  const user = await prisma.user.findUnique({
    where: { id: claims.userId },
    select: { emailVerifiedAt: true },
  });
  if (!user?.emailVerifiedAt) throw new EmailNotVerifiedError();
  return claims;
}
