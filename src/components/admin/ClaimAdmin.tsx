"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api-client";
import { useFormat } from "@/i18n/use-format";
import { Button, Card, Field, Status, inputClass, useLoader } from "@/components/ui/ui";
import ClaimDetail from "@/components/resolution/ClaimDetail";
import ClaimList from "@/components/resolution/ClaimList";
import {
  ACTIVE_STATUSES,
  CLAIM_STATUSES,
  parseMajorInput,
  useClaimErrorText,
  type ClaimDetailResponse,
  type ClaimStatus,
  type ClaimSummary,
} from "@/components/resolution/shared";

/** Yönetici talep kuyruğu: durum filtresi, liste ve seçili talebin ayrıntısı + karar formu. */
export default function ClaimAdmin() {
  const t = useTranslations("resolution");
  const [status, setStatus] = useState<ClaimStatus | "">("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data, error, reload } = useLoader(
    () =>
      apiFetch<{ claims: ClaimSummary[] }>(
        `/api/admin/claims${status ? `?status=${encodeURIComponent(status)}` : ""}`
      ),
    [status]
  );

  return (
    <div className="space-y-6">
      <Card title={t("admin.title")} id="claim-admin">
        <div className="mb-4 max-w-xs">
          <Field label={t("admin.filter")} id="claim-status-filter">
            <select
              id="claim-status-filter"
              className={inputClass}
              value={status}
              onChange={(e) => setStatus(e.target.value as ClaimStatus | "")}
            >
              <option value="">{t("admin.all")}</option>
              {CLAIM_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`status.${s}`)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Status error={error} />
        {!data && !error && (
          <p aria-live="polite" className="text-sm text-gray-600">
            {t("loading")}
          </p>
        )}
        {data &&
          (data.claims.length === 0 ? (
            <p className="text-sm text-gray-700">{t("list.empty")}</p>
          ) : (
            <ClaimList
              claims={data.claims}
              selectedId={selectedId}
              onSelect={setSelectedId}
              showRole={false}
            />
          ))}
      </Card>

      {selectedId && (
        <section aria-labelledby="claim-admin-selected" className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 id="claim-admin-selected" className="text-lg font-semibold text-gray-900">
              {t("admin.selected")}
            </h2>
            <Button variant="secondary" onClick={() => setSelectedId(null)}>
              {t("admin.close")}
            </Button>
          </div>
          <ClaimDetail
            key={selectedId}
            claimId={selectedId}
            readOnly
            renderAdmin={(detail, reloadDetail) => (
              <DecisionForm
                detail={detail}
                onDecided={() => {
                  reloadDetail();
                  reload();
                }}
              />
            )}
          />
        </section>
      )}
    </div>
  );
}

type Decision = "APPROVE" | "PARTIAL" | "REJECT";
const DECISIONS: readonly Decision[] = ["APPROVE", "PARTIAL", "REJECT"];

/** Karar formu; ters ibraz (PSP yönetir) ve sonuçlanmış taleplerde yalnızca açıklama gösterilir. */
function DecisionForm({
  detail,
  onDecided,
}: {
  detail: ClaimDetailResponse;
  onDecided: () => void;
}) {
  const t = useTranslations("resolution");
  const f = useFormat();
  const claimError = useClaimErrorText();
  const { claim } = detail;
  const fid = `decision-${claim.id}`;
  const [decision, setDecision] = useState<Decision>("APPROVE");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ error?: string; message?: string }>({});

  if (claim.type === "CHARGEBACK") {
    return (
      <Card title={t("decision.title")}>
        <p className="text-sm text-gray-700">{t("decision.pspManaged")}</p>
      </Card>
    );
  }
  if (!ACTIVE_STATUSES.includes(claim.status)) {
    return (
      <Card title={t("decision.title")}>
        <p className="text-sm text-gray-700">{t("decision.closed")}</p>
      </Card>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFeedback({});
    let amountMinor: number | undefined;
    if (decision === "PARTIAL") {
      const parsed = parseMajorInput(amount, claim.currency);
      if (parsed === null || parsed >= claim.amountRequestedMinor) {
        setFeedback({ error: t("decision.invalidAmount") });
        return;
      }
      amountMinor = parsed;
    }
    setBusy(true);
    try {
      const res = await apiFetch<{ status: ClaimStatus }>(
        `/api/admin/claims/${encodeURIComponent(claim.id)}/decision`,
        {
          method: "POST",
          body: JSON.stringify({
            decision,
            ...(amountMinor !== undefined ? { amountMinor } : {}),
            note: note.trim(),
          }),
        }
      );
      setFeedback({ message: t("decision.done", { status: t(`status.${res.status}`) }) });
      setNote("");
      setAmount("");
      onDecided();
    } catch (err) {
      setFeedback({ error: claimError(err, claim.currency) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={t("decision.title")}>
      <p className="mb-3 text-sm text-gray-700">
        {claim.type === "GUEST_REFUND" ? t("decision.explainRefund") : t("decision.explainDamage")}
      </p>
      <form onSubmit={submit} className="space-y-3">
        <fieldset>
          <legend className="text-sm font-medium text-gray-800">
            {t("decision.decisionLabel")}
          </legend>
          <div className="mt-1 flex flex-wrap gap-4">
            {DECISIONS.map((d) => (
              <label key={d} className="flex items-center gap-2 text-sm text-gray-800">
                <input
                  type="radio"
                  name={`${fid}-decision`}
                  value={d}
                  checked={decision === d}
                  onChange={() => setDecision(d)}
                />
                {t(`decision.${d}`)}
              </label>
            ))}
          </div>
        </fieldset>
        {decision === "PARTIAL" && (
          <Field
            label={t("decision.amount", { currency: claim.currency })}
            id={`${fid}-amount`}
            hint={t("decision.amountHint", {
              amount: f.money(claim.amountRequestedMinor, claim.currency),
            })}
          >
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
        )}
        <Field label={t("decision.note")} id={`${fid}-note`} hint={t("decision.noteHint")}>
          <textarea
            id={`${fid}-note`}
            rows={3}
            className={inputClass}
            value={note}
            minLength={3}
            maxLength={4000}
            required
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        <Button
          type="submit"
          variant={decision === "REJECT" ? "danger" : "primary"}
          disabled={busy}
        >
          {busy ? t("decision.submitting") : t("decision.submit")}
        </Button>
        <Status error={feedback.error} message={feedback.message} />
      </form>
    </Card>
  );
}
