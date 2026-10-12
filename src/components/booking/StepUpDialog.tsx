"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { WebAuthnAbortService } from "@simplewebauthn/browser";
import { ApiError } from "@/lib/api-client";
import { passkeyErrorCode, performStepUp } from "@/lib/auth/passkey-client";
import { useFormat } from "@/i18n/use-format";
import { ErrorText, focusRing, useErrorText } from "@/components/ui/ui";

/**
 * P1-8 step-up penceresi: kural motoru ödemeyi riskli bulduğunda (403 STEP_UP_REQUIRED)
 * kullanıcıdan kendi passkey'i ile yeniden doğrulama istenir. Karar sunucudadır; bu
 * bileşen yalnızca WebAuthn törenini yürütür.
 *
 * Native `<dialog>` + `showModal()`: odak kapanı, arka planın etkisizleşmesi ve Escape
 * (`cancel` olayı) tarayıcıdan gelir. Kapanınca odak açılıştan önceki öğeye döner.
 */
export default function StepUpDialog({
  bookingId,
  holdExpiresAt,
  onVerified,
  onCancel,
}: {
  bookingId: string;
  /** Verilirse odanın ne zamana kadar tutulduğu diyalogda gösterilir. */
  holdExpiresAt?: string | null;
  /** Doğrulama bu rezervasyon + tutara bağlı tek kullanımlık token üretir (v4#2). */
  onVerified: (stepUpToken: string) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("payment.stepUp");
  const f = useFormat();
  const errorText = useErrorText();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const busyRef = useRef(false);
  // Diyalog kapandıysa (vazgeçme/zorla kapatma) geç gelen doğrulama sonucu iletilmez (F1234).
  const closedRef = useRef(false);
  const onCancelRef = useRef(onCancel);

  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    const dialog = dialogRef.current;
    closedRef.current = false;
    const returnFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Diyalog açıkken arka plan sayfası kaymasın (F629).
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (dialog && !dialog.open) dialog.showModal();
    primary.current?.focus();
    return () => {
      closedRef.current = true;
      document.body.style.overflow = prevOverflow;
      if (busyRef.current) WebAuthnAbortService.cancelCeremony();
      if (dialog?.open) dialog.close();
      if (returnFocus?.isConnected) returnFocus.focus();
    };
  }, []);

  async function verify() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const { stepUpToken } = await performStepUp(bookingId);
      if (!closedRef.current) onVerified(stepUpToken);
    } catch (err) {
      busyRef.current = false;
      if (closedRef.current) return;
      setError(stepUpErrorText(err));
      setBusy(false);
    }
  }

  function stepUpErrorText(err: unknown): string {
    if (passkeyErrorCode(err) === "CANCELLED") return t("cancelled");
    if (err instanceof ApiError) return errorText(err, t("failed"));
    return t("failed");
  }

  function cancel() {
    if (busyRef.current) return;
    onCancelRef.current();
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="stepup-title"
      aria-describedby="stepup-desc"
      onCancel={(e) => {
        // Escape: tören sürerken kapatma; aksi hâlde "Vazgeç" ile aynı.
        e.preventDefault();
        cancel();
      }}
      onClose={(e) => {
        // Tarayıcı diyaloğu zorla kapattıysa (ör. art arda Escape) vazgeçilmiş say; süren
        // passkey töreni de iptal edilir, sonucu sonradan "doğrulandı" diye dönmez.
        if (e.currentTarget.open) return;
        closedRef.current = true;
        if (busyRef.current) WebAuthnAbortService.cancelCeremony();
        onCancelRef.current();
      }}
      className="max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-sm overflow-y-auto overscroll-contain rounded-xl bg-white p-6 shadow-lg backdrop:bg-black/40"
    >
      <h2 id="stepup-title" className="text-lg font-semibold text-gray-900">
        {t("title")}
      </h2>
      <p id="stepup-desc" className="mt-2 text-sm text-gray-700">
        {t("description")}
      </p>
      <p className="mt-2 text-sm text-gray-700">{t("whatIsPasskey")}</p>
      <p className="mt-2 text-sm text-gray-700">
        {t("noPasskey")}{" "}
        <Link
          href="/account"
          target="_blank"
          rel="noopener noreferrer"
          className={`inline-flex min-h-[44px] items-center font-semibold underline sm:min-h-0 ${focusRing}`}
        >
          {t("managePasskeys")}
        </Link>
      </p>
      {holdExpiresAt && (
        <p className="mt-2 text-sm text-gray-700">
          {t("holdUntil", { time: f.time(holdExpiresAt) })}
        </p>
      )}
      {/* Diyalogda aria-busy yok: meşgulken bu canlı bölge duyurulmalı (F1237). */}
      <p role="status" className={busy ? "mt-3 text-sm text-gray-700" : "sr-only"}>
        {busy ? t("waitingHint") : ""}
      </p>
      {error && <ErrorText className="mt-3">{error}</ErrorText>}
      <div className="mt-5 flex gap-2">
        <button
          ref={primary}
          type="button"
          onClick={() => void verify()}
          aria-disabled={busy || undefined}
          className={`min-h-[44px] flex-1 rounded-lg bg-[#003580] px-4 py-2 text-sm font-semibold text-white aria-disabled:opacity-50 ${focusRing}`}
        >
          {busy ? t("waiting") : t("verify")}
        </button>
        <button
          type="button"
          onClick={cancel}
          aria-disabled={busy || undefined}
          className={`min-h-[44px] rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 aria-disabled:opacity-50 ${focusRing}`}
        >
          {t("cancel")}
        </button>
      </div>
    </dialog>
  );
}
