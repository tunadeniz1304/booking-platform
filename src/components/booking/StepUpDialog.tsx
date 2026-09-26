"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { passkeyErrorMessage, performStepUp } from "@/lib/auth/passkey-client";

/**
 * P1-8 step-up penceresi: kural motoru ödemeyi riskli bulduğunda (403 STEP_UP_REQUIRED)
 * kullanıcıdan kendi passkey'i ile yeniden doğrulama istenir. Karar sunucudadır; bu
 * bileşen yalnızca WebAuthn törenini yürütür.
 */
export default function StepUpDialog({
  bookingId,
  onVerified,
  onCancel,
}: {
  bookingId: string;
  /** Doğrulama bu rezervasyon + tutara bağlı tek kullanımlık token üretir (v4#2). */
  onVerified: (stepUpToken: string) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("payment.stepUp");
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
      const { stepUpToken } = await performStepUp(bookingId);
      onVerified(stepUpToken);
    } catch (err) {
      setError(passkeyErrorMessage(err, t("failed")));
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
          {t("title")}
        </h2>
        <p id="stepup-desc" className="mt-2 text-sm text-gray-700">
          {t("description")}
        </p>
        {error && (
          <p role="alert" className="mt-3 text-sm text-red-700">
            {error}{" "}
            <Link href="/account" className="font-semibold underline">
              {t("managePasskeys")}
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
            {busy ? t("waiting") : t("verify")}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700"
          >
            {t("cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
