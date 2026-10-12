"use client";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ApiError, apiFetch } from "@/lib/api-client";
import { useFormat } from "@/i18n/use-format";
import { Button, Field, Status, focusRing, inputClass } from "@/components/ui/ui";
import { ResendVerificationButton } from "@/components/auth/AuthCard";
import OpenClaimSummaryCard from "./OpenClaimSummaryCard";
import {
  CLAIM_GUEST_WINDOW_DAYS,
  claimErrorAction,
  parseMajorInput,
  useClaimErrorText,
  type ClaimErrorAction,
  type ClaimStatus,
} from "./shared";

const DESCRIPTION_MIN = 10;
const DESCRIPTION_MAX = 4000;
/** Bu uzunluktan sonra sınıra yaklaşıldığı (bir kez) duyurulur. */
const DESCRIPTION_WARN_AT = 3600;

type FieldErrors = { amount?: string; description?: string };
type CreatedClaim = { id: string; status: ClaimStatus; amountMinor: number };

/**
 * Talep açma formu. Tür role göre sabittir: misafir → iade (GUEST_REFUND),
 * ev sahibi → hasar (HOST_DAMAGE). Tutar ana birimde girilir ("1.250,50"), minor-unit
 * gönderilir; çözümlenen tutar alanın altında canlı olarak gösterilir.
 * `maxMinor` (misafir: iade edilebilir üst sınır) ve `depositMinor` (ev sahibi: depozito;
 * `null` = depozito yok) verilirse ipucunda gösterilir; üst sınır istemcide de denetlenir.
 * Başarıdan sonra form yerine talep özeti gösterilir ve odak "Kanıt ekle"ye taşınır.
 */
export default function OpenClaimForm({
  bookingId,
  role,
  currency,
  onCreated,
  maxMinor,
  depositMinor,
}: {
  bookingId: string;
  role: "GUEST" | "HOST";
  currency: string;
  onCreated: (claim: { id: string; status: string }) => void;
  maxMinor?: number | null;
  depositMinor?: number | null;
}) {
  const t = useTranslations("resolution.open");
  const tErr = useTranslations("resolution.errors");
  const tRes = useTranslations("resolution");
  const f = useFormat();
  const claimError = useClaimErrorText();
  const type = role === "GUEST" ? "GUEST_REFUND" : "HOST_DAMAGE";
  const fid = `claim-${bookingId}`;
  const amountRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<CreatedClaim | null>(null);
  const [feedback, setFeedback] = useState<{ error?: string }>({});
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [errorAction, setErrorAction] = useState<ClaimErrorAction>(null);

  const parsedAmount = amount.trim() ? parseMajorInput(amount, currency) : null;
  const trimmedLength = description.trim().length;
  const guestMax = role === "GUEST" && typeof maxMinor === "number" ? maxMinor : null;
  const hostDeposit = role === "HOST" && typeof depositMinor === "number" ? depositMinor : null;
  const hostNoDeposit = role === "HOST" && (depositMinor === null || depositMinor === 0);

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
    setErrorAction(null);
    const amountMinor = parseMajorInput(amount, currency);
    const errors: FieldErrors = {};
    if (!amount.trim()) errors.amount = t("amountRequired");
    else if (amountMinor === null) errors.amount = t("invalidAmount");
    else if (guestMax !== null && amountMinor > guestMax) {
      errors.amount = tErr("CLAIM_AMOUNT_EXCEEDS_REFUNDABLE", { amount: formatAmount(guestMax) });
    }
    if (trimmedLength < DESCRIPTION_MIN) {
      errors.description = t("descriptionTooShortCount", {
        min: DESCRIPTION_MIN,
        count: trimmedLength,
      });
    } else if (trimmedLength > DESCRIPTION_MAX) {
      errors.description = t("descriptionTooLong", { max: DESCRIPTION_MAX, count: trimmedLength });
    }
    setFieldErrors(errors);
    if (amountMinor === null || errors.amount || errors.description) {
      focusFirst(errors);
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch<{ id: string; status: string }>("/api/claims", {
        method: "POST",
        body: JSON.stringify({ bookingId, type, amountMinor, description: description.trim() }),
      });
      setCreated({ id: res.id, status: res.status as ClaimStatus, amountMinor });
      setAmount("");
      setDescription("");
      onCreated(res);
    } catch (err) {
      const text = claimError(err, currency);
      if (err instanceof ApiError && err.code === "CLAIM_AMOUNT_EXCEEDS_REFUNDABLE") {
        // Tutar hatası ilgili alana bağlanır ve odak oraya taşınır.
        const next = { amount: text };
        setFieldErrors(next);
        focusFirst(next);
      } else {
        setFeedback({ error: text });
        setErrorAction(claimErrorAction(err));
      }
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <OpenClaimSummaryCard
        claim={{
          id: created.id,
          type,
          status: created.status,
          amountRequestedMinor: created.amountMinor,
          currency,
          slaDueAt: null,
        }}
        justCreated
      />
    );
  }

  const amountHint =
    guestMax !== null
      ? `${t("amountHint")} ${t("amountMaxGuest", { amount: formatAmount(guestMax) })}`
      : hostDeposit !== null && hostDeposit > 0
        ? `${t("amountHint")} ${t("amountDepositHost", { amount: formatAmount(hostDeposit) })}`
        : t("amountHint");
  const overDeposit =
    parsedAmount !== null && hostDeposit !== null && hostDeposit > 0 && parsedAmount > hostDeposit
      ? parsedAmount - hostDeposit
      : null;
  // Sayaç ipucunun parçasıdır; böylece alana aria-describedby ile bağlanır.
  const descriptionCount = t("descriptionCount", { count: trimmedLength, max: DESCRIPTION_MAX });
  const descriptionHint = `${t("descriptionHint")} ${descriptionCount}`;
  const limitNote =
    description.length > DESCRIPTION_MAX
      ? t("descriptionOverLimit", {
          max: DESCRIPTION_MAX,
          over: description.length - DESCRIPTION_MAX,
        })
      : description.length >= DESCRIPTION_WARN_AT
        ? t("descriptionNearLimit", { max: DESCRIPTION_MAX })
        : "";

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
      {hostNoDeposit && (
        <p className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-800">
          {t("noDepositHost")}
        </p>
      )}
      <Field
        label={t("amount", { currency })}
        id={`${fid}-amount`}
        hint={amountHint}
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
        {overDeposit !== null &&
          ` ${t("amountOverDeposit", { amount: formatAmount(overDeposit) })}`}
      </p>
      <Field
        label={t("description")}
        id={`${fid}-desc`}
        hint={descriptionHint}
        error={fieldErrors.description}
      >
        <textarea
          ref={descRef}
          id={`${fid}-desc`}
          rows={4}
          className={inputClass}
          value={description}
          minLength={DESCRIPTION_MIN}
          required
          onChange={(e) => {
            setDescription(e.target.value);
            const length = e.target.value.trim().length;
            if (fieldErrors.description && length >= DESCRIPTION_MIN && length <= DESCRIPTION_MAX) {
              setFieldErrors((prev) => ({ ...prev, description: undefined }));
            }
          }}
        />
      </Field>
      <p aria-live="polite" className="text-xs text-gray-700">
        {limitNote}
      </p>
      <Button type="submit" busy={busy}>
        {busy ? t("submitting") : t("submit")}
      </Button>
      <Status error={feedback.error} />
      {errorAction === "resendVerification" && <ResendVerificationButton />}
      {errorAction && typeof errorAction === "object" && (
        <p className="text-sm">
          <Link href={errorAction.href} className={`font-semibold underline ${focusRing}`}>
            {tRes(errorAction.labelKey)}
          </Link>
        </p>
      )}
    </form>
  );
}
