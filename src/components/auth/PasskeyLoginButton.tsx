"use client";

import { useId, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { loginWithPasskey, passkeyErrorCode, passkeySupported } from "@/lib/auth/passkey-client";
import { ApiError } from "@/lib/api-client";
import { useAuthErrorText } from "@/components/auth/AuthCard";

const noopSubscribe = () => () => {};

/**
 * "Geçiş anahtarı (passkey) ile giriş" (discoverable credential; e-posta/parola gerekmez).
 * `disabled`: başka bir giriş (parola) sürerken düğme etkisiz ve önceki passkey iletisi silinir.
 * `onStart`: passkey denemesi başlarken (ör. parola hatasını temizlemek için).
 * `onBusyChange`: passkey beklenirken parola formunu kilitlemek için.
 */
export default function PasskeyLoginButton({
  onSuccess,
  disabled = false,
  onStart,
  onBusyChange,
}: {
  onSuccess: () => void;
  disabled?: boolean;
  onStart?: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const t = useTranslations("auth");
  const authErrorText = useAuthErrorText();
  const hintId = useId();
  // Tarayıcı desteği değişmez; SSR ve hidrasyonda null (bilinmiyor): blok görünmez ama yerini
  // tutar, böylece desteklenen tarayıcıda hidrasyondan sonra kart kaymaz (CLS).
  const supported = useSyncExternalStore<boolean | null>(
    noopSubscribe,
    passkeySupported,
    () => null
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // İptal / bu cihazda anahtar yok: hata değil, nötr bilgi (role="status").
  const [notice, setNotice] = useState<string | null>(null);
  const [wasDisabled, setWasDisabled] = useState(disabled);
  if (disabled !== wasDisabled) {
    setWasDisabled(disabled);
    if (disabled) {
      setError(null);
      setNotice(null);
    }
  }

  if (supported === false) return null;
  const pending = supported === null;

  // WebAuthn hata adları ve API hata kodları arayüz dilindeki metne eşlenir
  // (sunucu metinleri sabit Türkçe olduğu için olduğu gibi gösterilmez).
  function errorText(err: unknown): string {
    const code = passkeyErrorCode(err);
    if (code === "ALREADY_REGISTERED") return t("passkey.alreadyRegistered");
    if (err instanceof TypeError) return t("errors.network");
    // UNAUTHORIZED burada "passkey tanınmadı" demektir: genel passkey metni.
    if (err instanceof ApiError && err.code !== "UNAUTHORIZED") {
      return authErrorText(err.code, t("passkey.failed"));
    }
    return t("passkey.failed");
  }

  function setBusyState(next: boolean) {
    setBusy(next);
    onBusyChange?.(next);
  }

  async function login() {
    if (busy || disabled || pending) return;
    setBusyState(true);
    setError(null);
    setNotice(null);
    onStart?.();
    try {
      await loginWithPasskey();
      onSuccess();
    } catch (err) {
      // WebAuthn iptal ile "bu cihazda anahtar yok"u ayırt etmez (ikisi de NotAllowedError).
      if (passkeyErrorCode(err) === "CANCELLED") setNotice(t("passkey.cancelled"));
      else setError(errorText(err));
      setBusyState(false);
    }
  }

  const inactive = busy || disabled;
  return (
    <div className={`mt-4${pending ? "invisible" : ""}`}>
      <div className="my-4 flex items-center gap-3 text-xs text-gray-500" aria-hidden="true">
        <span className="h-px flex-1 bg-gray-200" />
        {t("passkey.or")}
        <span className="h-px flex-1 bg-gray-200" />
      </div>
      <button
        type="button"
        onClick={() => void login()}
        // `disabled` yerine aria-disabled: bekleme ve hata sonrası odak düğmede kalır.
        aria-disabled={inactive || undefined}
        aria-busy={busy || undefined}
        aria-describedby={hintId}
        className="w-full rounded-lg border border-[#003580] px-4 py-3 text-sm font-semibold text-[#003580] transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60 aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
      >
        {busy ? t("passkey.waiting") : t("passkey.login")}
      </button>
      <p id={hintId} className="mt-2 text-xs text-gray-600">
        {t("passkey.hint")}
      </p>
      <details className="mt-1 text-xs text-gray-600">
        <summary className="cursor-pointer underline">{t("passkey.whatIs")}</summary>
        <p className="mt-1">{t("passkey.whatIsBody")}</p>
      </details>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <div role="status">{notice && <p className="mt-2 text-sm text-gray-600">{notice}</p>}</div>
    </div>
  );
}
