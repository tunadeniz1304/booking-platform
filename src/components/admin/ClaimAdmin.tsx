"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api-client";
import { useFormat } from "@/i18n/use-format";
import { Button, Card, Field, Status, inputClass, useLoader } from "@/components/ui/ui";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { parseAmountToMinor } from "@/lib/ui/amount-input";
import ClaimDetail from "@/components/resolution/ClaimDetail";
import ClaimList from "@/components/resolution/ClaimList";
import {
  ACTIVE_STATUSES,
  CLAIM_STATUSES,
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
  // "Ayrıntıyı göster" tetikleyicisi: ayrıntı kapanınca odak oraya döner.
  const openerRef = useRef<HTMLElement | null>(null);
  const select = (id: string | null) => {
    const active = document.activeElement;
    if (id && active instanceof HTMLElement && active !== document.body) openerRef.current = active;
    setSelectedId(id);
  };
  const closeDetail = () => {
    setSelectedId(null);
    const opener = openerRef.current;
    openerRef.current = null;
    requestAnimationFrame(() => {
      if (opener?.isConnected) opener.focus();
      else {
        const heading = document.getElementById("claim-admin-title");
        heading?.setAttribute("tabindex", "-1");
        heading?.focus();
      }
    });
  };
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
              onSelect={select}
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
            <Button variant="secondary" onClick={closeDetail}>
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

/** Para birimi kuruş basamağı (TRY/EUR 2, JPY 0). */
function currencyDigits(currency: string): number {
  try {
    return (
      new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
        .maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}

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
  // Varsayılan karar yok: en ağır sonuçlu seçenek önceden işaretli gelmesin.
  const [decision, setDecision] = useState<Decision | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ error?: string; message?: string }>({});
  const [amountInvalid, setAmountInvalid] = useState(false);
  const { confirm, confirmDialog } = useConfirm();
  const closedRef = useRef<HTMLParagraphElement>(null);
  const firstRadioRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const isClosed = !ACTIVE_STATUSES.includes(claim.status);

  // Karar kaydedilince form "sonuçlandı" görünümüne geçer; odak kaybolmasın diye oraya taşınır.
  useEffect(() => {
    if (isClosed && feedback.message) closedRef.current?.focus();
  }, [isClosed, feedback.message]);

  if (claim.type === "CHARGEBACK") {
    return (
      <Card title={t("decision.title")}>
        <p className="text-sm text-gray-700">{t("decision.pspManaged")}</p>
      </Card>
    );
  }
  if (isClosed) {
    return (
      <Card title={t("decision.title")}>
        <Status message={feedback.message} />
        <p ref={closedRef} tabIndex={-1} className="text-sm text-gray-700 focus:outline-none">
          {t("decision.closed")}
        </p>
      </Card>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setFeedback({});
    setAmountInvalid(false);
    if (!decision) {
      setFeedback({ error: t("decision.chooseFirst") });
      firstRadioRef.current?.focus();
      return;
    }
    let amountMinor: number | undefined;
    if (decision === "PARTIAL") {
      const parsed = parseAmountToMinor(amount, currencyDigits(claim.currency));
      if (parsed === null || parsed <= 0 || parsed >= claim.amountRequestedMinor) {
        setFeedback({ error: t("decision.invalidAmount") });
        setAmountInvalid(true);
        amountRef.current?.focus();
        return;
      }
      amountMinor = parsed;
    }
    const money = f.money(amountMinor ?? claim.amountRequestedMinor, claim.currency);
    const effect =
      decision === "REJECT"
        ? t("decision.confirm.reject")
        : claim.type === "GUEST_REFUND"
          ? t("decision.confirm.refund", { amount: money })
          : t("decision.confirm.damage", { amount: money });
    const ok = await confirm({
      title: t(`decision.confirm.title.${decision}`),
      body: (
        <>
          <p>{effect}</p>
          <p className="mt-2 font-medium">{t("decision.confirm.final")}</p>
        </>
      ),
      confirmLabel:
        decision === "REJECT"
          ? t("decision.confirm.confirmReject")
          : t("decision.confirm.confirmAmount", { amount: money }),
      tone: decision === "REJECT" ? "danger" : "primary",
    });
    if (!ok) return;
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
            {DECISIONS.map((d, i) => (
              <label
                key={d}
                className="flex min-h-[44px] items-center gap-2 text-sm text-gray-800 sm:min-h-0"
              >
                <input
                  ref={i === 0 ? firstRadioRef : undefined}
                  type="radio"
                  name={`${fid}-decision`}
                  value={d}
                  required
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
              ref={amountRef}
              id={`${fid}-amount`}
              inputMode="decimal"
              autoComplete="off"
              className={inputClass}
              value={amount}
              required
              aria-invalid={amountInvalid || undefined}
              onChange={(e) => {
                setAmount(e.target.value);
                setAmountInvalid(false);
              }}
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
        <Button type="submit" variant={decision === "REJECT" ? "danger" : "primary"} busy={busy}>
          {busy ? t("decision.submitting") : t("decision.submit")}
        </Button>
        <Status error={feedback.error} message={feedback.message} />
      </form>
      {confirmDialog}
    </Card>
  );
}
