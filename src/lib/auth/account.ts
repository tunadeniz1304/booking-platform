import { createHash, randomBytes } from "crypto";
import { AuthTokenKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { appendOutbox } from "@/lib/cqrs";
import { EventTypes, makeEvent, type AuthEmailRequestedPayload } from "@/lib/events/events";
import { getConfig } from "@/lib/config/app-config";
import { HttpError, ValidationError } from "@/lib/http/errors";
import { withSerializableRetry } from "@/lib/db/transactions";
import { hashPassword } from "./password";
import { bumpTokenVersion, publishTokenVersion } from "./token-version";

/**
 * Hesap güvenliği (P0-8): giriş kilidi, hesap bazlı deneme limiti, e-posta doğrulama
 * ve şifre sıfırlama. Tek kullanımlık token'lar yalnızca SHA-256 özetiyle saklanır;
 * e-postalar outbox üzerinden (at-least-once, dedupe'lu) gönderilir.
 */

export class AccountLockedError extends HttpError {
  constructor(retryAfterSeconds: number) {
    super(
      423,
      "ACCOUNT_LOCKED",
      "Çok fazla başarısız giriş denemesi. Hesap geçici olarak kilitlendi.",
      { retryAfterSeconds }
    );
    this.name = "AccountLockedError";
  }
}

export class LoginRateLimitedError extends HttpError {
  constructor() {
    super(
      429,
      "RATE_LIMITED",
      "Bu hesap için çok fazla deneme. Lütfen biraz sonra tekrar deneyin."
    );
    this.name = "LoginRateLimitedError";
  }
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Hesap (e-posta) bazlı deneme limiti — IP'den bağımsız (v3#3). Anahtar e-postanın
 * özetidir (log/Redis'te açık e-posta yok). Redis yoksa fail-closed.
 */
export async function checkLoginAttemptLimit(email: string, now = Date.now()): Promise<void> {
  const config = getConfig();
  const window = config.RATE_LIMIT_WINDOW_SECONDS;
  const bucket = Math.floor(now / 1000 / window);
  const key = `rl:login-acct:${sha256Hex(email.toLowerCase()).slice(0, 32)}:${bucket}`;
  let count: number;
  try {
    count = await redis.incrWithTtl(key, window);
  } catch {
    throw new LoginRateLimitedError();
  }
  if (count > config.RATE_LIMIT_LOGIN_PER_ACCOUNT_MAX) throw new LoginRateLimitedError();
}

/** Kilit durumu: kilitliyse kalan saniye, değilse 0. */
export function lockRemainingSeconds(lockedUntil: Date | null, now = new Date()): number {
  if (!lockedUntil) return 0;
  return Math.max(0, Math.ceil((lockedUntil.getTime() - now.getTime()) / 1000));
}

/**
 * Başarısız girişi kaydeder; eşik aşılınca hesabı `AUTH_LOCKOUT_MINUTES` kilitler.
 * Atomik artış (eşzamanlı denemeler sayacı kaçırmaz).
 * @returns bu denemeyle hesap kilitlendiyse `true`
 */
export async function recordFailedLogin(userId: string, now = new Date()): Promise<boolean> {
  const config = getConfig();
  const user = await prisma.user.update({
    where: { id: userId },
    data: { failedLoginCount: { increment: 1 } },
    select: { failedLoginCount: true },
  });
  if (user.failedLoginCount < config.AUTH_LOCKOUT_THRESHOLD) return false;
  await prisma.user.update({
    where: { id: userId },
    data: {
      failedLoginCount: 0,
      lockedUntil: new Date(now.getTime() + config.AUTH_LOCKOUT_MINUTES * 60_000),
    },
  });
  return true;
}

export async function recordSuccessfulLogin(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { failedLoginCount: 0, lockedUntil: null },
  });
}

function newRawToken(): string {
  return randomBytes(32).toString("base64url");
}

function ttlMs(kind: AuthTokenKind): number {
  const config = getConfig();
  return kind === AuthTokenKind.PASSWORD_RESET
    ? config.AUTH_RESET_TOKEN_TTL_MINUTES * 60_000
    : config.AUTH_VERIFY_TOKEN_TTL_HOURS * 3_600_000;
}

/**
 * Tek kullanımlık token oluşturur ve e-posta isteğini outbox'a yazar (aynı işlem).
 * Aynı türden önceki kullanılmamış token'lar geçersizleşir.
 */
export async function issueEmailToken(
  user: { id: string; email: string; firstName: string },
  kind: AuthTokenKind,
  now = new Date()
): Promise<string> {
  const raw = newRawToken();
  await prisma.$transaction(async (tx) => {
    await tx.authToken.updateMany({
      where: { userId: user.id, kind, usedAt: null },
      data: { usedAt: now },
    });
    const row = await tx.authToken.create({
      data: {
        userId: user.id,
        kind,
        tokenHash: sha256Hex(raw),
        expiresAt: new Date(now.getTime() + ttlMs(kind)),
      },
      select: { id: true },
    });
    await appendOutbox(
      tx,
      makeEvent<AuthEmailRequestedPayload>(EventTypes.AuthEmailRequested, row.id, "user", {
        tokenId: row.id,
        userId: user.id,
        to: user.email,
        name: user.firstName,
        kind,
        token: raw,
      })
    );
  });
  return raw;
}

/**
 * Token'ı tüketir (koşullu güncelleme: yalnızca kullanılmamış + süresi dolmamış).
 * Aynı token iki kez gelirse ikincisi 400 alır.
 */
async function consumeToken(raw: string, kind: AuthTokenKind, now: Date): Promise<string> {
  const hash = sha256Hex(raw);
  const row = await prisma.authToken.findUnique({
    where: { tokenHash: hash },
    select: { id: true, userId: true, kind: true },
  });
  if (!row || row.kind !== kind) throw new ValidationError("Bağlantı geçersiz veya süresi dolmuş");
  const used = await prisma.authToken.updateMany({
    where: { id: row.id, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  });
  if (used.count !== 1) throw new ValidationError("Bağlantı geçersiz veya süresi dolmuş");
  return row.userId;
}

export async function verifyEmail(raw: string, now = new Date()): Promise<{ userId: string }> {
  const userId = await consumeToken(raw, AuthTokenKind.EMAIL_VERIFY, now);
  await prisma.user.updateMany({
    where: { id: userId, emailVerifiedAt: null },
    data: { emailVerifiedAt: now },
  });
  return { userId };
}

/** Şifre sıfırlama isteği. Kullanıcı yoksa sessizce hiçbir şey yapmaz (e-posta sızdırmaz). */
export async function requestPasswordReset(email: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    select: { id: true, email: true, firstName: true, deletedAt: true },
  });
  if (!user || user.deletedAt) return;
  await issueEmailToken(user, AuthTokenKind.PASSWORD_RESET);
}

/**
 * Yeni şifreyi ayarlar, kilidi kaldırır ve TÜM oturumları kapatır (tokenVersion++).
 */
export async function resetPassword(
  raw: string,
  password: string,
  now = new Date()
): Promise<{ userId: string }> {
  const userId = await consumeToken(raw, AuthTokenKind.PASSWORD_RESET, now);
  const passwordHash = await hashPassword(password);
  const version = await withSerializableRetry(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { passwordHash, failedLoginCount: 0, lockedUntil: null },
    });
    return bumpTokenVersion(userId, tx);
  });
  await publishTokenVersion(userId, version);
  return { userId };
}
