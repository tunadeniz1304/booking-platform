import { createHash, randomBytes, randomUUID, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { getConfig } from "@/lib/config/app-config";
import { UnauthorizedError } from "@/lib/http/errors";
import { logger } from "@/lib/observability/logger";
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
}

interface RefreshRecord {
  userId: string;
  family: string;
  secretHash: string;
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
  family: string
): Promise<{ token: string; expiresAt: Date }> {
  const { REFRESH_TOKEN_TTL_SECONDS } = getConfig();
  const jti = randomUUID();
  const secret = randomBytes(32).toString("base64url");
  const record: RefreshRecord = { userId, family, secretHash: sha256(secret) };
  await redis.set(`${REFRESH_PREFIX}${jti}`, JSON.stringify(record), {
    ex: REFRESH_TOKEN_TTL_SECONDS,
  });
  return {
    token: `${jti}.${secret}`,
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
  };
}

async function revokeFamily(family: string): Promise<void> {
  const { REFRESH_TOKEN_TTL_SECONDS } = getConfig();
  await redis.set(`${FAMILY_REVOKED_PREFIX}${family}`, "1", { ex: REFRESH_TOKEN_TTL_SECONDS });
}

async function buildSession(
  user: { id: string; role: Role },
  family: string
): Promise<SessionTokens> {
  const { ACCESS_TOKEN_TTL_SECONDS } = getConfig();
  const access = await signAccessToken(user.id, user.role, ACCESS_TOKEN_TTL_SECONDS);
  const refresh = await createRefreshToken(user.id, family);
  return {
    accessToken: access.token,
    accessExpiresAt: access.expiresAt,
    refreshToken: refresh.token,
    refreshExpiresAt: refresh.expiresAt,
    user,
  };
}

/** Başarılı girişte yeni oturum (yeni aile). */
export async function issueSession(user: { id: string; role: string }): Promise<SessionTokens> {
  return buildSession({ id: user.id, role: toRole(user.role) }, randomUUID());
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
    select: { id: true, role: true },
  });
  if (!user) throw new UnauthorizedError("Kullanıcı bulunamadı");

  return buildSession({ id: user.id, role: toRole(user.role) }, record.family);
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
