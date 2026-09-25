"use client";

import { useState, useSyncExternalStore } from "react";
import { loginWithPasskey, passkeyErrorMessage, passkeySupported } from "@/lib/auth/passkey-client";

const noopSubscribe = () => () => {};

/** "Passkey ile giriş" (discoverable credential; e-posta/parola gerekmez). */
export default function PasskeyLoginButton({ onSuccess }: { onSuccess: () => void }) {
  // Tarayıcı desteği değişmez; SSR'da false (hidrasyon uyumu).
  const supported = useSyncExternalStore(noopSubscribe, passkeySupported, () => false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!supported) return null;

  async function login() {
    setBusy(true);
    setError(null);
    try {
      await loginWithPasskey();
      onSuccess();
    } catch (err) {
      setError(passkeyErrorMessage(err, "Passkey ile giriş yapılamadı"));
      setBusy(false);
    }
  }

  return (
    <div className="mt-4">
      <div className="my-4 flex items-center gap-3 text-xs text-gray-500" aria-hidden="true">
        <span className="h-px flex-1 bg-gray-200" />
        veya
        <span className="h-px flex-1 bg-gray-200" />
      </div>
      <button
        type="button"
        onClick={() => void login()}
        disabled={busy}
        className="w-full rounded-lg border border-[#003580] px-4 py-3 text-sm font-semibold text-[#003580] transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? "Passkey bekleniyor..." : "Passkey ile giriş"}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
