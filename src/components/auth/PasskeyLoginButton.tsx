"use client";

import { useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { loginWithPasskey, passkeyErrorCode, passkeySupported } from "@/lib/auth/passkey-client";
import { ApiError } from "@/lib/api-client";
import { useAuthErrorText } from "@/components/auth/AuthCard";

const noopSubscribe = () => () => {};

/** "Passkey ile giriş" (discoverable credential; e-posta/parola gerekmez). */
export default function PasskeyLoginButton({ onSuccess }: { onSuccess: () => void }) {
  const t = useTranslations("auth");
  const authErrorText = useAuthErrorText();
  // Tarayıcı desteği değişmez; SSR'da false (hidrasyon uyumu).
  const supported = useSyncExternalStore(noopSubscribe, passkeySupported, () => false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!supported) return null;

  // WebAuthn hata adları ve API hata kodları arayüz dilindeki metne eşlenir
  // (sunucu metinleri sabit Türkçe olduğu için olduğu gibi gösterilmez).
  function errorText(err: unknown): string {
    const code = passkeyErrorCode(err);
    if (code === "CANCELLED") return t("passkey.cancelled");
    if (code === "ALREADY_REGISTERED") return t("passkey.alreadyRegistered");
    if (err instanceof TypeError) return t("errors.network");
    // UNAUTHORIZED burada "passkey tanınmadı" demektir: genel passkey metni.
    if (err instanceof ApiError && err.code !== "UNAUTHORIZED") {
      return authErrorText(err.code, t("passkey.failed"));
    }
    return t("passkey.failed");
  }

  async function login() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await loginWithPasskey();
      onSuccess();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <div className="mt-4">
      <div className="my-4 flex items-center gap-3 text-xs text-gray-500" aria-hidden="true">
        <span className="h-px flex-1 bg-gray-200" />
        {t("passkey.or")}
        <span className="h-px flex-1 bg-gray-200" />
      </div>
      <button
        type="button"
        onClick={() => void login()}
        // `disabled` yerine aria-disabled: bekleme ve hata sonrası odak düğmede kalır.
        aria-disabled={busy || undefined}
        aria-busy={busy || undefined}
        className="w-full rounded-lg border border-[#003580] px-4 py-3 text-sm font-semibold text-[#003580] transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60 aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
      >
        {busy ? t("passkey.waiting") : t("passkey.login")}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
