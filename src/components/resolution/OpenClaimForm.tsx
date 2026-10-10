"use client";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ApiError, apiFetch } from "@/lib/api-client";
import { useFormat } from "@/i18n/use-format";
import { Button, Field, Status, focusRing, inputClass } from "@/components/ui/ui";
import { CLAIM_GUEST_WINDOW_DAYS, parseMajorInput, useClaimErrorText } from "./shared";

const DESCRIPTION_MIN = 10;
const DESCRIPTION_MAX = 4000;

type FieldErrors = { amount?: string; description?: string };

/**
 * Talep açma formu. Tür role göre sabittir: misafir → iade (GUEST_REFUND),
 * ev sahibi → hasar (HOST_DAMAGE). Tutar ana birimde girilir ("1.250,50"), minor-unit
 * gönderilir; çözümlenen tutar alanın altında canlı olarak gösterilir.
 */
export default function OpenClaimForm({
  bookingId,
  role,
  currency,
  onCreated,
}: {
  bookingId: string;
  role: "GUEST" | "HOST";
  currency: string;
  onCreated: () => void;
}) {
  const t = useTranslations("resolution.open");
  const f = useFormat();
  const claimError = useClaimErrorText();
  const type = role === "GUEST" ? "GUEST_REFUND" : "HOST_DAMAGE";
  const fid = `claim-${bookingId}`;
  const amountRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ error?: string; message?: string }>({});
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const parsedAmount = amount.trim() ? parseMajorInput(amount, currency) : null;
  const trimmedLength = description.trim().length;

  function formatAmount(minor: number): string {
    try {
      return f.money(minor, currency);
    } catch {
      return String(minor);
    }
  }

  function focusFirst(errors: FieldErrors) {
    if (errors.amount) amountRef.current?.focus();
    else if (errors.description) descRef.current?.focus();
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setFeedback({});
    setCreatedId(null);
    const amountMinor = parseMajorInput(amount, currency);
    const errors: FieldErrors = {};
    if (amountMinor === null) errors.amount = t("invalidAmount");
    if (trimmedLength < DESCRIPTION_MIN) {
      errors.description = t("descriptionTooShort", { min: DESCRIPTION_MIN });
    }
    setFieldErrors(errors);
    if (amountMinor === null || errors.description) {
      focusFirst(errors);
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch<{ id: string; status: string }>("/api/claims", {
        method: "POST",
        body: JSON.stringify({ bookingId, type, amountMinor, description: description.trim() }),
      });
      setCreatedId(res.id);
      setAmount("");
      setDescription("");
      setFeedback({ message: t("created", { amount: formatAmount(amountMinor) }) });
      onCreated();
    } catch (err) {
      const text = claimError(err, currency);
      if (err instanceof ApiError && err.code === "CLAIM_AMOUNT_EXCEEDS_REFUNDABLE") {
        // Tutar hatası ilgili alana bağlanır ve odak oraya taşınır.
        const next = { amount: text };
        setFieldErrors(next);
        focusFirst(next);
      } else {
        setFeedback({ error: text });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      className="space-y-3"
      aria-labelledby={`${fid}-title`}
      aria-busy={busy || undefined}
    >
      <h3 id={`${fid}-title`} className="text-base font-semibold text-gray-900">
        {role === "GUEST" ? t("titleGuest") : t("titleHost")}
      </h3>
      <p className="text-sm text-gray-700">
        {role === "GUEST" ? t("infoGuest", { days: CLAIM_GUEST_WINDOW_DAYS }) : t("infoHost")}
      </p>
      <Field
        label={t("amount", { currency })}
        id={`${fid}-amount`}
        hint={t("amountHint")}
        error={fieldErrors.amount}
      >
        <input
          ref={amountRef}
          id={`${fid}-amount`}
          inputMode="decimal"
          autoComplete="off"
          className={inputClass}
          value={amount}
          required
          onChange={(e) => {
            setAmount(e.target.value);
            if (fieldErrors.amount) setFieldErrors((prev) => ({ ...prev, amount: undefined }));
          }}
        />
      </Field>
      <p aria-live="polite" className="text-sm font-medium text-gray-900">
        {parsedAmount !== null ? t("amountPreview", { amount: formatAmount(parsedAmount) }) : ""}
      </p>
      <Field
        label={t("description")}
        id={`${fid}-desc`}
        hint={t("descriptionHint")}
        error={fieldErrors.description}
      >
        <textarea
          ref={descRef}
          id={`${fid}-desc`}
          rows={4}
          className={inputClass}
          value={description}
          minLength={DESCRIPTION_MIN}
          maxLength={DESCRIPTION_MAX}
          required
          onChange={(e) => {
            setDescription(e.target.value);
            if (fieldErrors.description && e.target.value.trim().length >= DESCRIPTION_MIN) {
              setFieldErrors((prev) => ({ ...prev, description: undefined }));
            }
          }}
        />
      </Field>
      <p className="text-xs text-gray-600">
        {t("descriptionCount", { count: trimmedLength, max: DESCRIPTION_MAX })}
      </p>
      <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
        {busy ? t("submitting") : t("submit")}
      </Button>
      <Status error={feedback.error} message={feedback.message} />
      {createdId && (
        <p className="text-sm">
          <Link
            href={`/resolution/${encodeURIComponent(createdId)}`}
            className={`font-semibold text-[#003580] underline ${focusRing}`}
          >
            {t("viewCreated")}
          </Link>
        </p>
      )}
    </form>
  );
}
