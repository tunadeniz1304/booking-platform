"use client";

import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { apiFetch } from "@/lib/api-client";

/**
 * Tarayıcı tarafı passkey akışları; mevcut WebAuthn uçlarını kullanır
 * (/api/auth/passkey/*, /api/auth/step-up/*). Doğrulama tamamen sunucudadır.
 */
export function passkeySupported(): boolean {
  return typeof window !== "undefined" && browserSupportsWebAuthn();
}

export async function loginWithPasskey() {
  const { challengeId, options } = await apiFetch<{
    challengeId: string;
    options: PublicKeyCredentialRequestOptionsJSON;
  }>("/api/auth/passkey/login/options", { method: "POST", body: "{}" });
  const response = await startAuthentication({ optionsJSON: options });
  return apiFetch<{ user: { id: string; role: string } }>("/api/auth/passkey/login/verify", {
    method: "POST",
    body: JSON.stringify({ challengeId, response }),
  });
}

export async function registerPasskey(name?: string) {
  const options = await apiFetch<PublicKeyCredentialCreationOptionsJSON>(
    "/api/auth/passkey/register/options",
    { method: "POST", body: "{}" }
  );
  const response = await startRegistration({ optionsJSON: options });
  return apiFetch<{ registered: true; credentialId: string }>("/api/auth/passkey/register/verify", {
    method: "POST",
    body: JSON.stringify({ response, name }),
  });
}

/** Risk bazlı step-up (P1-8): başarılıysa sunucu kısa ömürlü, tek kullanımlık izin bırakır. */
export async function performStepUp() {
  const options = await apiFetch<PublicKeyCredentialRequestOptionsJSON>(
    "/api/auth/step-up/options",
    { method: "POST", body: "{}" }
  );
  const response = await startAuthentication({ optionsJSON: options });
  return apiFetch<{ validForSeconds: number }>("/api/auth/step-up/verify", {
    method: "POST",
    body: JSON.stringify({ response }),
  });
}

/** WebAuthn iptal/zaman aşımı hatalarını kullanıcı diline çevirir. */
export function passkeyErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) {
    if (err.name === "NotAllowedError")
      return "Passkey işlemi iptal edildi veya zaman aşımına uğradı";
    if (err.name === "InvalidStateError") return "Bu cihazdaki passkey zaten kayıtlı";
    if ("status" in err) return err.message;
  }
  return fallback;
}
