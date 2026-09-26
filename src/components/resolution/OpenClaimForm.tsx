"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api-client";
import { Button, Field, Status, focusRing, inputClass } from "@/components/ui/ui";
import { parseMajorInput, useClaimErrorText } from "./shared";

/**
 * Talep açma formu. Tür role göre sabittir: misafir → iade (GUEST_REFUND),
 * ev sahibi → hasar (HOST_DAMAGE). Tutar ana birimde girilir, minor-unit gönderilir.
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
  const claimError = useClaimErrorText();
  const type = role === "GUEST" ? "GUEST_REFUND" : "HOST_DAMAGE";
  const fid = `claim-${bookingId}`;
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ error?: string; message?: string }>({});

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFeedback({});
    setCreatedId(null);
    const amountMinor = parseMajorInput(amount, currency);
    if (amountMinor === null) {
      setFeedback({ error: t("invalidAmount") });
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
      setFeedback({ message: t("created") });
      onCreated();
    } catch (err) {
      setFeedback({ error: claimError(err, currency) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3" aria-labelledby={`${fid}-title`}>
      <h3 id={`${fid}-title`} className="text-base font-semibold text-gray-900">
        {role === "GUEST" ? t("titleGuest") : t("titleHost")}
      </h3>
      <p className="text-sm text-gray-700">{role === "GUEST" ? t("infoGuest") : t("infoHost")}</p>
      <Field label={t("amount", { currency })} id={`${fid}-amount`} hint={t("amountHint")}>
        <input
          id={`${fid}-amount`}
          inputMode="decimal"
          className={inputClass}
          value={amount}
          required
          pattern="\d+([.,]\d{1,3})?"
          onChange={(e) => setAmount(e.target.value)}
        />
      </Field>
      <Field label={t("description")} id={`${fid}-desc`} hint={t("descriptionHint")}>
        <textarea
          id={`${fid}-desc`}
          rows={4}
          className={inputClass}
          value={description}
          minLength={10}
          maxLength={4000}
          required
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
      <Button type="submit" disabled={busy}>
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
