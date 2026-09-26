import { createHash, randomBytes, randomUUID, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { getConfig } from "@/lib/config/app-config";
import { UnauthorizedError } from "@/lib/http/errors";
import { logger, errorFields } from "@/lib/observability/logger";
import { signAccessToken, type Role, ROLES } from "./tokens";
import { denyAccessToken } from "./denylist";

/**
 * Oturum = kısa ömürlü erişim JWT'si + dönen (rotating) yenileme token'ı.
 *
 * Yenileme token'ı opak bir değerdir (`<jti>.<sır>`); Redis'te yalnızca sırrın
 * SHA-256 özeti tutulur. Her kullanımda tek seferlik tüketilir ve aynı "aile"
 * içinde yenisi verilir. Tüketilmiş bir token tekrar gelirse (çalınma belirtisi)
 * tüm aile iptal edilir (refresh token reuse detection).
 */

const REFRESH_PREFIX = "auth:refresh:";
const USED_PREFIX = "auth:refresh-used:";
const FAMILY_REVOKED_PREFIX = "auth:family-revoked:";

export interface SessionTokens {
  accessToken: string;
  accessExpiresAt: Date;
  refreshToken: string;
  refreshExpiresAt: Date;
  user: { id: string; role: Role };
  /** Oturum (yenileme ailesi) kimliği. */
  sessionId?: string;
}

interface RefreshRecord {
  userId: string;
  family: string;
  secretHash: string;
  /** Oturum dönemi; `User.tokenVersion` artarsa bu aile geçersizdir (v3#5). */
  tv?: number;
  /** Son birincil doğrulama (Unix sn); yenilemede taşınır, yenilenmez (v4#2). */
  authTime?: number;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

function toRole(value: string): Role {
  return (ROLES as readonly string[]).includes(value) ? (value as Role) : "USER";
}

async function createRefreshToken(
  userId: string,
  family: string,
  tv: number,
  authTime: number
): Promise<{ token: string; expiresAt: Date }> {
  const { REFRESH_TOKEN_TTL_SECONDS } = getConfig();
  const jti = randomUUID();
  const secret = randomBytes(32).toString("base64url");
  const record: RefreshRecord = { userId, family, secretHash: sha256(secret), tv, authTime };
  await redis.set(`${REFRESH_PREFIX}${jti}`, JSON.stringify(record), {
    ex: REFRESH_TOKEN_TTL_SECONDS,
  });
  return {
    token: `${jti}.${secret}`,
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
  };
}

/** Oturum meta verisi (P0-4): cihaz, tarayıcı ve kaba IP ipucu. */
export interface SessionContext {
  deviceId?: string | null;
  userAgent?: string | null;
  ipHint?: string | null;
}

/**
 * Aileyi iptal eder: Redis işareti yetkilidir (yenileme + `sid`'li erişim token'ları düşer);
 * `UserSession.revokedAt` yalnızca listeleme içindir (best-effort).
 */
export async function revokeFamily(family: string): Promise<void> {
  const { REFRESH_TOKEN_TTL_SECONDS } = getConfig();
  await redis.set(`${FAMILY_REVOKED_PREFIX}${family}`, "1", { ex: REFRESH_TOKEN_TTL_SECONDS });
  try {
    await prisma.userSession.updateMany({
      where: { id: family, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  } catch (error) {
    logger.warn({ family, ...errorFields(error) }, "session row revoke failed");
  }
}

/** Oturum (aile) uzaktan çıkış / yeniden kullanım tespiti ile iptal edildi mi? */
export async function isSessionRevoked(sessionId: string): Promise<boolean> {
  return (await redis.exists(`${FAMILY_REVOKED_PREFIX}${sessionId}`)) === 1;
}

async function recordSessionRow(
  userId: string,
  family: string,
  context: SessionContext | undefined
): Promise<void> {
  try {
    await prisma.userSession.create({
      data: {
        id: family,
        userId,
        deviceId: context?.deviceId ?? null,
        userAgent: context?.userAgent?.slice(0, 256) ?? null,
        ipHint: context?.ipHint ?? null,
      },
    });
  } catch (error) {
    logger.warn({ userId, ...errorFields(error) }, "session row create failed");
  }
}

async function buildSession(
  user: { id: string; role: Role; tokenVersion: number },
  family: string,
  authTime: number
): Promise<SessionTokens> {
  const { ACCESS_TOKEN_TTL_SECONDS } = getConfig();
  const access = await signAccessToken(
    user.id,
    user.role,
    ACCESS_TOKEN_TTL_SECONDS,
    user.tokenVersion,
    authTime,
    family
  );
  const refresh = await createRefreshToken(user.id, family, user.tokenVersion, authTime);
  return {
    accessToken: access.token,
    accessExpiresAt: access.expiresAt,
    refreshToken: refresh.token,
    refreshExpiresAt: refresh.expiresAt,
    user: { id: user.id, role: user.role },
  };
}

/**
 * Başarılı girişte yeni oturum (yeni aile). `tokenVersion` verilmezse veritabanından okunur.
 * `authTime` (Unix sn) varsayılan olarak şimdi: oturum bir birincil doğrulamayla açılır.
 */
export async function issueSession(
  user: {
    id: string;
    role: string;
    tokenVersion?: number;
  },
  opts: { authTime?: number; context?: SessionContext } = {}
): Promise<SessionTokens> {
  const tokenVersion =
    user.tokenVersion ??
    (await prisma.user.findUnique({ where: { id: user.id }, select: { tokenVersion: true } }))
      ?.tokenVersion ??
    0;
  const family = randomUUID();
  const session = await buildSession(
    { id: user.id, role: toRole(user.role), tokenVersion },
    family,
    opts.authTime ?? Math.floor(Date.now() / 1000)
  );
  await recordSessionRow(user.id, family, opts.context);
  return { ...session, sessionId: family };
}

/**
 * Yenileme token'ını tüketir ve aynı ailede yeni oturum döner. Rol veritabanından
 * yeniden okunur (rol değişikliği yenilemede yansır).
 */
export async function rotateRefreshToken(raw: string): Promise<SessionTokens> {
  const [jti, secret] = raw.split(".");
  if (!jti || !secret) throw new UnauthorizedError("Geçersiz oturum");

  const stored = await redis.getdel(`${REFRESH_PREFIX}${jti}`);
  if (!stored) {
    const reusedFamily = await redis.get(`${USED_PREFIX}${jti}`);
    if (reusedFamily) {
      await revokeFamily(reusedFamily);
      logger.warn({ family: reusedFamily }, "refresh token reuse detected; family revoked");
    }
    throw new UnauthorizedError("Oturum süresi doldu");
  }

  const record = JSON.parse(stored) as RefreshRecord;
  const { REFRESH_TOKEN_TTL_SECONDS } = getConfig();
  await redis.set(`${USED_PREFIX}${jti}`, record.family, { ex: REFRESH_TOKEN_TTL_SECONDS });

  if (!safeEqualHex(record.secretHash, sha256(secret))) {
    await revokeFamily(record.family);
    throw new UnauthorizedError("Geçersiz oturum");
  }
  if ((await redis.exists(`${FAMILY_REVOKED_PREFIX}${record.family}`)) === 1) {
    throw new UnauthorizedError("Oturum iptal edildi");
  }

  const user = await prisma.user.findUnique({
    where: { id: record.userId },
    select: { id: true, role: true, tokenVersion: true, deletedAt: true },
  });
  if (!user || user.deletedAt) throw new UnauthorizedError("Kullanıcı bulunamadı");
  // Hesap silme / rol değişimi / şifre sıfırlama sonrası eski aileler yenilenemez (v3#5).
  if ((record.tv ?? 0) !== user.tokenVersion) {
    await revokeFamily(record.family);
    throw new UnauthorizedError("Oturum iptal edildi");
  }

  try {
    await prisma.userSession.updateMany({
      where: { id: record.family, revokedAt: null },
      data: { lastSeenAt: new Date() },
    });
  } catch (error) {
    logger.warn({ family: record.family, ...errorFields(error) }, "session touch failed");
  }

  // auth_time yenilemede TAŞINIR: çalınan yenileme token'ı "yakın zamanda doğrulandı"
  // durumunu tazeleyemez (v4#2). Eski kayıtlarda alan yoksa 0.
  return buildSession(
    { id: user.id, role: toRole(user.role), tokenVersion: user.tokenVersion },
    record.family,
    record.authTime ?? 0
  );
}

/** Çıkış: yenileme ailesini ve mevcut erişim token'ını iptal eder. */
export async function revokeSession(input: {
  refreshToken?: string | null;
  access?: { jti: string; exp: number } | null;
}): Promise<void> {
  if (input.refreshToken) {
    const [jti] = input.refreshToken.split(".");
    if (jti) {
      const stored = await redis.getdel(`${REFRESH_PREFIX}${jti}`);
      if (stored) await revokeFamily((JSON.parse(stored) as RefreshRecord).family);
    }
  }
  if (input.access) await denyAccessToken(input.access.jti, input.access.exp);
}
