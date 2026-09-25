"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { passkeyErrorMessage, performStepUp } from "@/lib/auth/passkey-client";

/**
 * P1-8 step-up penceresi: kural motoru ödemeyi riskli bulduğunda (403 STEP_UP_REQUIRED)
 * kullanıcıdan kendi passkey'i ile yeniden doğrulama istenir. Karar sunucudadır; bu
 * bileşen yalnızca WebAuthn törenini yürütür.
 */
export default function StepUpDialog({
  onVerified,
  onCancel,
}: {
  onVerified: () => void;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const primary = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    primary.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  async function verify() {
    setBusy(true);
    setError(null);
    try {
      await performStepUp();
      onVerified();
    } catch (err) {
      setError(passkeyErrorMessage(err, "Doğrulama başarısız"));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="stepup-title"
        aria-describedby="stepup-desc"
        className="w-full max-w-sm rounded-xl bg-white p-6 shadow-lg"
      >
        <h2 id="stepup-title" className="text-lg font-semibold text-gray-900">
          Ek doğrulama gerekli
        </h2>
        <p id="stepup-desc" className="mt-2 text-sm text-gray-700">
          Hesabınızı korumak için bu ödemeyi passkey&apos;inizle onaylamanızı istiyoruz. Onaydan
          sonra ödeme otomatik olarak yeniden denenir.
        </p>
        {error && (
          <p role="alert" className="mt-3 text-sm text-red-700">
            {error}{" "}
            <Link href="/account" className="font-semibold underline">
              Passkey&apos;lerimi yönet
            </Link>
          </p>
        )}
        <div className="mt-5 flex gap-2">
          <button
            ref={primary}
            type="button"
            onClick={() => void verify()}
            disabled={busy}
            className="flex-1 rounded-lg bg-[#003580] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Bekleniyor..." : "Passkey ile doğrula"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700"
          >
            Vazgeç
          </button>
        </div>
      </div>
    </div>
  );
}
