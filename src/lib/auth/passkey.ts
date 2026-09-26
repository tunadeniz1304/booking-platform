import { randomBytes, randomUUID } from "crypto";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { getConfig } from "@/lib/config/app-config";
import { UnauthorizedError, ValidationError } from "@/lib/http/errors";
import { logger, errorFields } from "@/lib/observability/logger";
import { appendOutbox } from "@/lib/cqrs";
import { EventTypes, makeEvent, type SecurityAlertPayload } from "@/lib/events/events";

/**
 * Passkey (WebAuthn) kaydı ve girişi (P0-8) — `@simplewebauthn/server`.
 *
 * Challenge'lar Redis'te tek kullanımlık (`GETDEL`) ve `WEBAUTHN_CHALLENGE_TTL_SECONDS`
 * ömürlüdür. Giriş "discoverable credential" ile yapılır (kullanıcı adı sorulmaz);
 * challenge, istemciye verilen opak `challengeId` ile eşlenir. Sayaç (counter) geriye
 * giderse (klonlanmış kimlik doğrulayıcı belirtisi) giriş reddedilir.
 */

const REG_PREFIX = "webauthn:reg:";
const AUTH_PREFIX = "webauthn:auth:";
const STEP_UP_PREFIX = "webauthn:stepup:";
const REAUTH_PREFIX = "webauthn:reauth:";
const STEP_UP_OK_PREFIX = "stepup:ok:";
const NONCE_BYTES = 24;

function rp() {
  const c = getConfig();
  return { rpID: c.WEBAUTHN_RP_ID, rpName: c.WEBAUTHN_RP_NAME, origin: c.WEBAUTHN_ORIGIN };
}

async function storeChallenge(key: string, challenge: string): Promise<void> {
  await redis.set(key, challenge, { ex: getConfig().WEBAUTHN_CHALLENGE_TTL_SECONDS });
}

async function takeChallenge(key: string): Promise<string> {
  const challenge = await redis.getdel(key);
  if (!challenge) throw new ValidationError("Passkey isteğinin süresi doldu, tekrar deneyin");
  return challenge;
}

export async function passkeyRegistrationOptions(
  userId: string
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      email: true,
      firstName: true,
      lastName: true,
      webAuthnCredentials: { select: { id: true, transports: true } },
    },
  });
  if (!user) throw new UnauthorizedError();
  const { rpID, rpName } = rp();
  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: user.email,
    userDisplayName: `${user.firstName} ${user.lastName}`,
    userID: new TextEncoder().encode(userId),
    attestationType: "none",
    excludeCredentials: user.webAuthnCredentials.map((c) => ({
      id: c.id,
      transports: c.transports as AuthenticatorTransportFuture[],
    })),
    authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
  });
  await storeChallenge(`${REG_PREFIX}${userId}`, options.challenge);
  return options;
}

export async function verifyPasskeyRegistration(
  userId: string,
  response: RegistrationResponseJSON,
  name?: string
): Promise<{ credentialId: string }> {
  const expectedChallenge = await takeChallenge(`${REG_PREFIX}${userId}`);
  const { rpID, origin } = rp();
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
    });
  } catch (error) {
    logger.warn(errorFields(error), "passkey registration rejected");
    throw new ValidationError("Passkey doğrulanamadı");
  }
  if (!verification.verified) throw new ValidationError("Passkey doğrulanamadı");
  const { credential } = verification.registrationInfo;
  const label = name?.slice(0, 60) ?? null;
  // Kayıt + güvenlik e-postası isteği aynı işlemde (outbox): e-posta kaybolmaz (v4#2).
  await prisma.$transaction(async (tx) => {
    const created = await tx.webAuthnCredential.create({
      data: {
        id: credential.id,
        userId,
        publicKey: Buffer.from(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports ?? [],
        name: label,
      },
      select: { createdAt: true, user: { select: { email: true, firstName: true } } },
    });
    await appendOutbox(
      tx,
      makeEvent<SecurityAlertPayload>(EventTypes.SecurityAlert, userId, "user", {
        alertId: randomUUID(),
        userId,
        to: created.user.email,
        name: created.user.firstName,
        kind: "PASSKEY_ADDED",
        detail: label,
        occurredAt: created.createdAt.toISOString(),
      })
    );
  });
  return { credentialId: credential.id };
}

export async function passkeyLoginOptions(): Promise<{
  challengeId: string;
  options: PublicKeyCredentialRequestOptionsJSON;
}> {
  const { rpID } = rp();
  const options = await generateAuthenticationOptions({ rpID, userVerification: "preferred" });
  const challengeId = randomUUID();
  await storeChallenge(`${AUTH_PREFIX}${challengeId}`, options.challenge);
  return { challengeId, options };
}

/** Başarılıysa kullanıcıyı döner; oturumu çağıran (route) açar. */
export async function verifyPasskeyLogin(
  challengeId: string,
  response: AuthenticationResponseJSON,
  now = new Date()
): Promise<{ id: string; role: string; email: string; firstName: string; lastName: string }> {
  const expectedChallenge = await takeChallenge(`${AUTH_PREFIX}${challengeId}`);
  const stored = await prisma.webAuthnCredential.findUnique({
    where: { id: response.id },
    select: {
      id: true,
      publicKey: true,
      counter: true,
      transports: true,
      user: {
        select: {
          id: true,
          role: true,
          email: true,
          firstName: true,
          lastName: true,
          deletedAt: true,
          lockedUntil: true,
        },
      },
    },
  });
  if (!stored || stored.user.deletedAt) throw new UnauthorizedError("Passkey tanınmadı");
  if (stored.user.lockedUntil && stored.user.lockedUntil > now) {
    throw new UnauthorizedError("Hesap geçici olarak kilitli");
  }
  await verifyAssertion(stored, response, expectedChallenge, now, "passkey login rejected");
  const { id, role, email, firstName, lastName } = stored.user;
  return { id, role, email, firstName, lastName };
}

interface StoredCredential {
  id: string;
  publicKey: Uint8Array | Buffer;
  counter: number;
  transports: string[];
}

/** Giriş ve step-up için ortak doğrulama + koşullu sayaç güncellemesi. */
async function verifyAssertion(
  stored: StoredCredential,
  response: AuthenticationResponseJSON,
  expectedChallenge: string,
  now: Date,
  logMessage: string,
  requireUserVerification = false
): Promise<void> {
  const { rpID, origin } = rp();
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification,
      credential: {
        id: stored.id,
        publicKey: new Uint8Array(stored.publicKey),
        counter: stored.counter,
        transports: stored.transports as AuthenticatorTransportFuture[],
      },
    });
  } catch (error) {
    logger.warn(errorFields(error), logMessage);
    throw new UnauthorizedError("Passkey doğrulanamadı");
  }
  if (!verification.verified) throw new UnauthorizedError("Passkey doğrulanamadı");
  // Koşullu sayaç güncellemesi: aynı yanıt iki kez (replay) ya da klon → ikinci güncelleme 0 satır.
  const { newCounter } = verification.authenticationInfo;
  const updated = await prisma.webAuthnCredential.updateMany({
    where: {
      id: stored.id,
      counter: stored.counter,
    },
    data: { counter: newCounter, lastUsedAt: now },
  });
  if (updated.count !== 1) throw new UnauthorizedError("Passkey doğrulanamadı");
}

/** Step-up'a bağlanan işlem: rezervasyon + sunucuda hesaplanan tutar (v4#2). */
export interface StepUpBinding {
  bookingId: string;
  amountMinor: number;
}

interface StepUpChallenge extends StepUpBinding {
  challenge: string;
}

/** Bu andan önce oluşturulmuş passkey'ler step-up için uygundur (yeni passkey soğuması). */
function stepUpEligibleBefore(now: Date): Date {
  return new Date(now.getTime() - getConfig().PASSKEY_STEP_UP_COOLDOWN_HOURS * 3_600_000);
}

/** Oturumdaki kullanıcının KENDİ passkey'leriyle `get()` seçenekleri (step-up ve re-auth). */
async function ownAssertionOptions(
  userId: string,
  createdBefore?: Date
): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const creds = await prisma.webAuthnCredential.findMany({
    where: { userId, ...(createdBefore ? { createdAt: { lte: createdBefore } } : {}) },
    select: { id: true, transports: true },
  });
  if (creds.length === 0) {
    throw new ValidationError(
      createdBefore
        ? "Ödeme doğrulaması için kullanılabilir passkey yok (yeni passkey'ler 24 saat bekler)"
        : "Hesapta kayıtlı passkey yok"
    );
  }
  const { rpID } = rp();
  return generateAuthenticationOptions({
    rpID,
    userVerification: "required",
    allowCredentials: creds.map((c) => ({
      id: c.id,
      transports: c.transports as AuthenticatorTransportFuture[],
    })),
  });
}

/** Kullanıcının kendi passkey'iyle yapılan doğrulamayı denetler (başkasınınki reddedilir). */
async function verifyOwnAssertion(
  userId: string,
  response: AuthenticationResponseJSON,
  expectedChallenge: string,
  now: Date,
  logMessage: string,
  createdBefore?: Date
): Promise<void> {
  const stored = await prisma.webAuthnCredential.findUnique({
    where: { id: response.id },
    select: {
      id: true,
      userId: true,
      publicKey: true,
      counter: true,
      transports: true,
      createdAt: true,
    },
  });
  // Başka kullanıcının passkey'i ile doğrulama yapılamaz (aynı hata; varlık sızdırılmaz).
  if (!stored || stored.userId !== userId) throw new UnauthorizedError("Passkey tanınmadı");
  if (createdBefore && stored.createdAt > createdBefore) {
    throw new UnauthorizedError("Yeni eklenen passkey henüz ödeme doğrulamasında kullanılamaz");
  }
  await verifyAssertion(stored, response, expectedChallenge, now, logMessage, true);
}

/**
 * P1-8 risk bazlı step-up (v4#2 ile sıkılaştırıldı): doğrulama belirli bir rezervasyona ve
 * SUNUCUDA hesaplanan tutara bağlanır; yalnızca soğuma süresini (varsayılan 24 saat)
 * doldurmuş passkey'ler kabul edilir — çalınan oturumla eklenen passkey ödemeyi onaylayamaz.
 */
export async function stepUpOptions(
  userId: string,
  binding: StepUpBinding,
  now = new Date()
): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const options = await ownAssertionOptions(userId, stepUpEligibleBefore(now));
  const record: StepUpChallenge = { ...binding, challenge: options.challenge };
  await storeChallenge(`${STEP_UP_PREFIX}${userId}`, JSON.stringify(record));
  return options;
}

/**
 * Başarılıysa tek kullanımlık step-up token'ı döner: `stepup:ok:<userId>:<bookingId>:<nonce>`
 * anahtarında tutar saklanır; ödeme bunu `consumeStepUp` ile (GETDEL) tüketir.
 */
export async function verifyStepUp(
  userId: string,
  response: AuthenticationResponseJSON,
  now = new Date()
): Promise<{ stepUpToken: string; bookingId: string; validForSeconds: number }> {
  const raw = await takeChallenge(`${STEP_UP_PREFIX}${userId}`);
  let record: StepUpChallenge;
  try {
    record = JSON.parse(raw) as StepUpChallenge;
  } catch {
    throw new ValidationError("Passkey isteğinin süresi doldu, tekrar deneyin");
  }
  await verifyOwnAssertion(
    userId,
    response,
    record.challenge,
    now,
    "passkey step-up rejected",
    stepUpEligibleBefore(now)
  );
  const ttl = getConfig().STEP_UP_TTL_SECONDS;
  const nonce = randomBytes(NONCE_BYTES).toString("base64url");
  await redis.set(
    `${STEP_UP_OK_PREFIX}${userId}:${record.bookingId}:${nonce}`,
    String(record.amountMinor),
    { ex: ttl }
  );
  return { stepUpToken: nonce, bookingId: record.bookingId, validForSeconds: ttl };
}

/**
 * Step-up token'ını tüketir (GETDEL, tek kullanımlık). Yalnızca aynı kullanıcı + rezervasyon
 * + tutar için geçerlidir; tutar değiştiyse token yanar ve `false` döner.
 */
export async function consumeStepUp(
  userId: string,
  binding: StepUpBinding,
  token: string | null | undefined
): Promise<boolean> {
  if (!token || !/^[A-Za-z0-9_-]{16,64}$/.test(token)) return false;
  const stored = await redis.getdel(`${STEP_UP_OK_PREFIX}${userId}:${binding.bookingId}:${token}`);
  return stored !== null && stored === String(binding.amountMinor);
}

/** Step-up'a uygun (soğuma süresini doldurmuş) passkey var mı? */
export async function hasStepUpPasskey(userId: string, now = new Date()): Promise<boolean> {
  return (
    (await prisma.webAuthnCredential.count({
      where: { userId, createdAt: { lte: stepUpEligibleBefore(now) } },
    })) > 0
  );
}

/** Yeniden doğrulama (recent-auth, v4#2) için kendi passkey'iyle `get()` seçenekleri. */
export async function reauthPasskeyOptions(
  userId: string
): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const options = await ownAssertionOptions(userId);
  await storeChallenge(`${REAUTH_PREFIX}${userId}`, options.challenge);
  return options;
}

export async function verifyReauthPasskey(
  userId: string,
  response: AuthenticationResponseJSON,
  now = new Date()
): Promise<void> {
  const expectedChallenge = await takeChallenge(`${REAUTH_PREFIX}${userId}`);
  await verifyOwnAssertion(userId, response, expectedChallenge, now, "passkey re-auth rejected");
}

export async function hasPasskey(userId: string): Promise<boolean> {
  return (await prisma.webAuthnCredential.count({ where: { userId } })) > 0;
}

export async function listPasskeys(userId: string) {
  return prisma.webAuthnCredential.findMany({
    where: { userId },
    select: { id: true, name: true, createdAt: true, lastUsedAt: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function deletePasskey(userId: string, credentialId: string): Promise<boolean> {
  const res = await prisma.webAuthnCredential.deleteMany({
    where: { id: credentialId, userId },
  });
  return res.count === 1;
}
