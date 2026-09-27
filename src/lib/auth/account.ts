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
import { sealLink } from "./link-crypto";
import { issuePowChallenge, PowRequiredError, verifyPow } from "./pow";
import type { PowSolution } from "./pow-solver";
import { rateLimitRelaxFactor } from "@/lib/security/rate-limit";

/**
 * Hesap güvenliği (P0-8, v4#12): giriş denemesi koruması, e-posta doğrulama ve şifre
 * sıfırlama. Tek kullanımlık token'lar yalnızca SHA-256 özetiyle saklanır; outbox'a
 * ham token değil yalnızca özet + şifreli bağlantı yazılır; e-postalar outbox
 * üzerinden (at-least-once, dedupe'lu) gönderilir.
 *
 * v4#12: Hesap artık kilitlenmez (bilinen bir e-postayı kilitleyerek sahibini dışarıda
 * bırakma DoS'u). Onun yerine:
 *  - (istemci, e-posta) çifti başına kademeli gecikme — saldırganın başarısızlıkları
 *    başka ağdaki gerçek kullanıcıyı yavaşlatmaz;
 *  - eşik aşılınca (çift ya da e-posta genelinde, dağıtık saldırı) iş kanıtı (PoW);
 *    gerçek kullanıcı tarayıcıda küçük bir bulmaca çözerek her zaman girebilir.
 * Sayaçlar e-posta özetiyle tutulur; var olan/olmayan hesap aynı yolu izler.
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

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export class LoginDelayedError extends HttpError {
  constructor(retryAfterSeconds: number) {
    super(429, "LOGIN_DELAYED", "Çok fazla başarısız deneme. Lütfen biraz bekleyin.", {
      retryAfterSeconds,
    });
    this.name = "LoginDelayedError";
  }
}

function emailKey(email: string): string {
  return sha256Hex(email.trim().toLowerCase()).slice(0, 32);
}

function pairKey(email: string, client: string): string {
  return sha256Hex(`${client}|${email.trim().toLowerCase()}`).slice(0, 32);
}

const loginKeys = (email: string, client: string) => ({
  pairFails: `auth:login:fail:pair:${pairKey(email, client)}`,
  pairNext: `auth:login:next:${pairKey(email, client)}`,
  acctFails: `auth:login:fail:acct:${emailKey(email)}`,
});

/** n. başarısızlıktan sonraki bekleme (ms): serbest denemelerden sonra üstel, tavanlı. */
export function loginDelayMs(failures: number, config = getConfig()): number {
  const over = failures - config.AUTH_LOGIN_FREE_FAILURES;
  if (over <= 0) return 0;
  return Math.min(
    config.AUTH_LOGIN_DELAY_MAX_MS,
    config.AUTH_LOGIN_DELAY_BASE_MS * 2 ** (over - 1)
  );
}

/**
 * Giriş denemesinden ÖNCE çağrılır (parola kontrolünden önce, v4#12).
 *  - Çiftin bekleme süresi dolmadıysa → 429 `LOGIN_DELAYED` (Retry-After).
 *  - Çift ya da e-posta genelindeki başarısızlıklar `AUTH_LOCKOUT_THRESHOLD`'a ulaştıysa
 *    veya e-posta başına pencere limiti (`RATE_LIMIT_LOGIN_PER_ACCOUNT_MAX`, v3#3)
 *    aşıldıysa → geçerli bir PoW çözümü gerekir; yoksa 429 `POW_REQUIRED` + bulmaca.
 * Redis yoksa fail-closed (429).
 */
export async function assertLoginAttemptAllowed(input: {
  email: string;
  client: string;
  pow?: PowSolution | null;
  /** Yavaşlatılmış auth yolunda PoW zaten doğrulandı (v5#6) — ikinci bulmaca istenmez. */
  powVerified?: boolean;
  now?: number;
}): Promise<void> {
  const config = getConfig();
  const now = input.now ?? Date.now();
  const keys = loginKeys(input.email, input.client);
  const window = config.RATE_LIMIT_WINDOW_SECONDS;
  const rateKey = `rl:login-acct:${emailKey(input.email)}:${Math.floor(now / 1000 / window)}`;
  let next: string | null;
  let pairFails: number;
  let acctFails: number;
  let attempts: number;
  try {
    const [nextRaw, pairRaw, acctRaw] = await redis.mget([
      keys.pairNext,
      keys.pairFails,
      keys.acctFails,
    ]);
    next = nextRaw;
    pairFails = Number(pairRaw ?? 0);
    acctFails = Number(acctRaw ?? 0);
    attempts = await redis.incrWithTtl(rateKey, window);
  } catch {
    throw new LoginRateLimitedError();
  }
  const waitMs = Number(next ?? 0) - now;
  if (waitMs > 0) throw new LoginDelayedError(Math.ceil(waitMs / 1000));
  const needsPow =
    pairFails >= config.AUTH_LOCKOUT_THRESHOLD ||
    acctFails >= config.AUTH_LOCKOUT_THRESHOLD ||
    attempts > config.RATE_LIMIT_LOGIN_PER_ACCOUNT_MAX * rateLimitRelaxFactor(config);
  if (needsPow && !input.powVerified && !(await verifyPow(input.pow, now))) {
    throw new PowRequiredError(issuePowChallenge(now));
  }
}

/**
 * Başarısız girişi (var olan/olmayan e-posta için aynı biçimde) kaydeder: çift ve
 * e-posta sayaçlarını artırır, çiftin bir sonraki deneme zamanını ileri iter.
 * Hesap kilitlenmez (v4#12).
 */
export async function recordLoginFailure(input: {
  email: string;
  client: string;
  now?: number;
}): Promise<void> {
  const config = getConfig();
  const now = input.now ?? Date.now();
  const keys = loginKeys(input.email, input.client);
  const windowSeconds = config.AUTH_LOCKOUT_MINUTES * 60;
  try {
    const [pairFails] = await Promise.all([
      redis.incrWithTtl(keys.pairFails, windowSeconds),
      redis.incrWithTtl(keys.acctFails, windowSeconds),
    ]);
    const delay = loginDelayMs(pairFails, config);
    if (delay > 0) {
      await redis.set(keys.pairNext, String(now + delay), { ex: Math.ceil(delay / 1000) });
    }
  } catch {
    // Sayaç yazılamazsa bir sonraki denemede `assertLoginAttemptAllowed` fail-closed olur.
  }
}

/** Başarılı girişte çiftin sayaçları sıfırlanır (e-posta geneli dağıtık sayaç kalır). */
export async function clearLoginFailures(email: string, client: string): Promise<void> {
  const keys = loginKeys(email, client);
  await redis.del(keys.pairFails, keys.pairNext).catch(() => 0);
}

/** Yanıtı en az `minMs` sürdürür (bilinen/bilinmeyen e-posta zamanlama farkı, v4#12). */
export async function padResponseTime(
  startedAt: number,
  minMs = getConfig().AUTH_MIN_RESPONSE_MS
): Promise<void> {
  const remaining = startedAt + minMs - Date.now();
  if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
}

/** Kilit durumu: kilitliyse kalan saniye, değilse 0. */
export function lockRemainingSeconds(lockedUntil: Date | null, now = new Date()): number {
  if (!lockedUntil) return 0;
  return Math.max(0, Math.ceil((lockedUntil.getTime() - now.getTime()) / 1000));
}

export async function recordSuccessfulLogin(userId: string, locale?: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    // Dil tercihi e-postalar için saklanır (çerez yoksa mevcut değer korunur).
    data: { failedLoginCount: 0, lockedUntil: null, ...(locale ? { locale } : {}) },
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

/** E-postadaki bağlantının yolu (kök adres tüketicide eklenir). */
export function authLinkPath(kind: AuthTokenKind, raw: string): string {
  const path = kind === AuthTokenKind.EMAIL_VERIFY ? "/verify-email" : "/reset-password";
  return `${path}?token=${encodeURIComponent(raw)}`;
}

/**
 * Tek kullanımlık token oluşturur ve e-posta isteğini outbox'a yazar (aynı işlem).
 * Aynı türden önceki kullanılmamış token'lar geçersizleşir. Outbox payload'ında ham
 * token YOKTUR: yalnızca özeti ve şifreli bağlantı (v4#12).
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
        tokenHash: sha256Hex(raw),
        sealedLink: sealLink(authLinkPath(kind, raw)),
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

/**
 * E-posta başına sıfırlama isteği sınırı (v4#12): pencere başına en çok
 * `AUTH_RESET_PER_EMAIL_MAX` e-posta; aşılırsa (veya Redis yoksa) sessizce gönderilmez.
 * Sayaç e-posta özetiyle tutulur ve hesap var olsun olmasın artar.
 */
async function allowResetEmail(email: string): Promise<boolean> {
  const config = getConfig();
  try {
    const count = await redis.incrWithTtl(
      `auth:reset:${emailKey(email)}`,
      config.AUTH_RESET_WINDOW_SECONDS
    );
    return count <= config.AUTH_RESET_PER_EMAIL_MAX;
  } catch {
    return false;
  }
}

/**
 * Şifre sıfırlama isteği. Kullanıcı yoksa sessizce hiçbir şey yapmaz (e-posta sızdırmaz);
 * yanıt süresi çağıran route'ta sabitlenir (`padResponseTime`).
 */
export async function requestPasswordReset(email: string): Promise<void> {
  if (!(await allowResetEmail(email))) return;
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
