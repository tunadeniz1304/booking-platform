import { randomUUID } from "crypto";
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
  await prisma.webAuthnCredential.create({
    data: {
      id: credential.id,
      userId,
      publicKey: Buffer.from(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports ?? [],
      name: name?.slice(0, 60) ?? null,
    },
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
  const { rpID, origin } = rp();
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
      credential: {
        id: stored.id,
        publicKey: new Uint8Array(stored.publicKey),
        counter: stored.counter,
        transports: stored.transports as AuthenticatorTransportFuture[],
      },
    });
  } catch (error) {
    logger.warn(errorFields(error), "passkey login rejected");
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
  const { id, role, email, firstName, lastName } = stored.user;
  return { id, role, email, firstName, lastName };
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
