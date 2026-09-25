import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { getConfig } from "@/lib/config/app-config";
import { logger, errorFields } from "@/lib/observability/logger";

/**
 * Oturum dönemi (`User.tokenVersion`, v3#5).
 *
 * Her erişim/yenileme token'ı üretildiği andaki `tokenVersion`'ı taşır (`tv`). Hesap
 * silme, rol değişimi ve şifre sıfırlamada sürüm artırılır → o kullanıcının TÜM açık
 * oturumları (diğer cihazlar dahil) geçersizleşir:
 *
 *  - Yenileme: veritabanındaki sürümle karşılaştırılır (yetkili kaynak).
 *  - Erişim token'ı (her istek): Redis'teki `auth:tv:<userId>` ile karşılaştırılır; anahtar
 *    yoksa token geçerli sayılır (kısa ömürlüdür). Redis erişilemezse fail-CLOSED.
 */

const TV_PREFIX = "auth:tv:";

/** Sürümü artırır (verilen işlem içinde) ve yeni değeri döner. */
export async function bumpTokenVersion(
  userId: string,
  tx: Prisma.TransactionClient = prisma
): Promise<number> {
  const user = await tx.user.update({
    where: { id: userId },
    data: { tokenVersion: { increment: 1 } },
    select: { tokenVersion: true },
  });
  return user.tokenVersion;
}

/**
 * Yeni sürümü erişim-token kontrolü için Redis'e yayınlar. İşlem commit edildikten SONRA
 * çağrılır; en az bir yenileme token'ı ömrü boyunca tutulur.
 */
export async function publishTokenVersion(userId: string, version: number): Promise<void> {
  try {
    await redis.set(`${TV_PREFIX}${userId}`, String(version), {
      ex: getConfig().REFRESH_TOKEN_TTL_SECONDS,
    });
  } catch (error) {
    // Yenileme yine veritabanından reddedilir; erişim token'ı en geç TTL sonunda düşer.
    logger.error({ userId, ...errorFields(error) }, "token version publish failed");
  }
}

/** bump + publish kısayolu (işlem dışı kullanım). */
export async function revokeAllSessions(userId: string): Promise<number> {
  const version = await bumpTokenVersion(userId);
  await publishTokenVersion(userId, version);
  return version;
}

/** Erişim token'ındaki sürüm güncel mi? Redis hatasında `false` (fail-closed). */
export async function isTokenVersionCurrent(userId: string, tv: number): Promise<boolean> {
  try {
    const current = await redis.get(`${TV_PREFIX}${userId}`);
    if (current === null) return true;
    return tv >= Number(current);
  } catch (error) {
    logger.warn(errorFields(error), "token version check failed (fail-closed)");
    return false;
  }
}
