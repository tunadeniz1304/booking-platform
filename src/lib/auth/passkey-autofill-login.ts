"use client";

import {
  browserSupportsWebAuthnAutofill,
  startAuthentication,
  WebAuthnAbortService,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { apiFetch } from "@/lib/api-client";

type LoginChallenge = { challengeId: string; options: PublicKeyCredentialRequestOptionsJSON };

/**
 * Passkey'i e-posta alanının otomatik doldurma önerisinde sunar (koşullu arabuluculuk, F1037).
 * Sayfada `autoComplete` değeri "webauthn" ile biten bir alan olmalı. Yalnız kolaylıktır:
 * destek yoksa, seçenekler alınamazsa, tören iptal edilirse ya da `signal` iptal edildiyse
 * sessizce null döner (ayrı passkey düğmesi yine çalışır). Kullanıcı öneriden anahtar seçerse
 * giriş doğrulanır; doğrulama hatası fırlatılır.
 * Modal passkey girişi (`loginWithPasskey`) başlarken kütüphane bu töreni kendisi iptal eder;
 * çağıran yine de önce `signal`'ı iptal etmelidir ki geç dönen seçenekler yeni töreni bozmasın.
 */
export async function loginWithPasskeyAutofill(signal: AbortSignal) {
  if (!(await browserSupportsWebAuthnAutofill()) || signal.aborted) return null;
  let challenge: LoginChallenge;
  try {
    challenge = await apiFetch<LoginChallenge>("/api/auth/passkey/login/options", {
      method: "POST",
      body: "{}",
    });
  } catch {
    return null;
  }
  if (signal.aborted) return null;

  const cancel = () => WebAuthnAbortService.cancelCeremony();
  signal.addEventListener("abort", cancel, { once: true });
  let response: AuthenticationResponseJSON;
  try {
    response = await startAuthentication({
      optionsJSON: challenge.options,
      useBrowserAutofill: true,
    });
  } catch {
    return null;
  } finally {
    signal.removeEventListener("abort", cancel);
  }

  return apiFetch<{ user: { id: string; role: string } }>("/api/auth/passkey/login/verify", {
    method: "POST",
    body: JSON.stringify({ challengeId: challenge.challengeId, response }),
  });
}
