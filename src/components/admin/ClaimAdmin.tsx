"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
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

/** Yöneticinin iş kuyruğu: taraflarca çözülemeyip yöneticiye aktarılan talepler. */
const DEFAULT_STATUS: ClaimStatus = "ESCALATED";
/** URL'de "Tümü" filtresi; `status` parametresi yoksa varsayılan filtre uygulanır. */
const ALL_STATUSES_PARAM = "all";

/**
 * `?status=&claim=` sorgusunu okur (paylaşılabilir bağlantı, yenileme, e-postadan gelen talep).
 * ClaimAdmin yalnız istemcide, RoleGate oturumu yükledikten sonra render edilir.
 */
function readClaimQuery(): { status: ClaimStatus | ""; claim: string | null } {
  if (typeof window === "undefined") return { status: DEFAULT_STATUS, claim: null };
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("status");
  const status =
    raw === ALL_STATUSES_PARAM ? "" : (CLAIM_STATUSES.find((s) => s === raw) ?? DEFAULT_STATUS);
  return { status, claim: params.get("claim")?.trim() || null };
}

/** `counts` (filtreden bağımsız) varsa seçeneklerde gösterilir: "Yöneticiye aktarıldı (4)". */
interface ClaimQueueResponse {
  claims: ClaimSummary[];
  counts?: Partial<Record<ClaimStatus, number>>;
}

/** Yönetici talep kuyruğu: durum filtresi, liste ve seçili talebin ayrıntısı + karar formu. */
export default function ClaimAdmin() {
  const t = useTranslations("resolution");
  const [initialQuery] = useState(readClaimQuery);
  const [status, setStatus] = useState<ClaimStatus | "">(initialQuery.status);
  const [selectedId, setSelectedId] = useState<string | null>(initialQuery.claim);
  // Her seçimde (ve ?claim= ile açılışta) artar: odak ve kaydırma ayrıntı başlığına taşınır.
  const [detailFocusTick, setDetailFocusTick] = useState(initialQuery.claim ? 1 : 0);
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);
  // "Ayrıntıyı göster" tetikleyicisi: ayrıntı kapanınca odak oraya döner.
  const openerRef = useRef<HTMLElement | null>(null);
  const select = (id: string | null) => {
    const active = document.activeElement;
    if (id && active instanceof HTMLElement && active !== document.body) openerRef.current = active;
    setSelectedId(id);
    if (id) setDetailFocusTick((n) => n + 1);
  };
  const closeDetail = () => {
    // Önce seçili satırın düğmesi (liste yeniden yüklenmiş olabilir), yoksa tetikleyici.
    const rowButton = document.querySelector<HTMLElement>('#claim-admin [aria-pressed="true"]');
    const opener = rowButton ?? openerRef.current;
    setSelectedId(null);
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
  const showAll = () => {
    setStatus("");
    document.getElementById("claim-status-filter")?.focus();
  };

  // Seçilen talebin başlığı görünümde değilse oraya kaydırılır ve odaklanır (WCAG 2.4.3).
  useEffect(() => {
    const heading = detailHeadingRef.current;
    if (detailFocusTick === 0 || !heading) return;
    const { top, bottom } = heading.getBoundingClientRect();
    if (top < 0 || bottom > window.innerHeight) heading.scrollIntoView({ block: "start" });
    heading.focus({ preventScroll: true });
  }, [detailFocusTick]);

  // Filtre ve seçim URL'de tutulur; geçmişe yeni kayıt eklenmez.
  useEffect(() => {
    const { pathname, search, hash } = window.location;
    const params = new URLSearchParams(search);
    params.set("status", status || ALL_STATUSES_PARAM);
    if (selectedId) params.set("claim", selectedId);
    else params.delete("claim");
    const next = `${pathname}?${params.toString()}${hash}`;
    if (next !== `${pathname}${search}${hash}`) window.history.replaceState(null, "", next);
  }, [status, selectedId]);

  const { data, error, reload } = useLoader(async () => {
    const res = await apiFetch<ClaimQueueResponse>(
      `/api/admin/claims${status ? `?status=${encodeURIComponent(status)}` : ""}`
    );
    return { ...res, filter: status };
  }, [status]);
  // Filtre değişince önceki sonuç yeni filtrenin (boş) sonucu gibi gösterilmez.
  const list = data && data.filter === status ? data.claims : null;
  const counts = data?.counts;
  const withCount = (label: string, count: number) =>
    counts ? t("admin.optionCount", { label, count }) : label;
  const total = counts ? Object.values(counts).reduce<number>((a, n) => a + (n ?? 0), 0) : 0;

  return (
    <div className="space-y-6 lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:items-start lg:gap-6 lg:space-y-0">
      <Card title={t("admin.title")} id="claim-admin">
        <div className="mb-4 max-w-xs">
          <Field label={t("admin.filter")} id="claim-status-filter">
            <select
              id="claim-status-filter"
              className={inputClass}
              value={status}
              onChange={(e) => setStatus(e.target.value as ClaimStatus | "")}
            >
              <option value="">{withCount(t("admin.all"), total)}</option>
              {CLAIM_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {withCount(t(`status.${s}`), counts?.[s] ?? 0)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Status error={error} />
        {!list && !error && (
          <p aria-live="polite" className="text-sm text-gray-600">
            {t("loading")}
          </p>
        )}
        {list &&
          (list.length === 0 ? (
            <div className="space-y-2">
              <p className="text-sm text-gray-700">
                {status === ""
                  ? t("admin.empty")
                  : t("admin.emptyFiltered", { status: t(`status.${status}`) })}
              </p>
              {status !== "" && (
                <Button variant="secondary" onClick={showAll}>
                  {t("admin.showAll")}
                </Button>
              )}
            </div>
          ) : (
            <ClaimList claims={list} selectedId={selectedId} onSelect={select} showRole={false} />
          ))}
      </Card>

      {selectedId ? (
        <section aria-labelledby="claim-admin-selected" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2
              ref={detailHeadingRef}
              id="claim-admin-selected"
              tabIndex={-1}
              className="text-lg font-semibold text-gray-900 focus:outline-none"
            >
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
      ) : (
        <p className="hidden rounded-xl border border-dashed border-gray-200 p-5 text-sm text-gray-700 lg:block">
          {t("admin.selectHint")}
        </p>
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

/** Karar kartı; "Seçili talep" (h2) bölümünün alt başlığı olduğu için h3 kullanır (WCAG 1.3.1). */
function DecisionCard({ children }: { children: ReactNode }) {
  const t = useTranslations("resolution");
  return (
    <Card>
      <h3 className="mb-3 text-lg font-semibold text-gray-900">{t("decision.title")}</h3>
      {children}
    </Card>
  );
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
  const { claim, deposit } = detail;
  const fid = `decision-${claim.id}`;
  // Varsayılan karar yok: en ağır sonuçlu seçenek önceden işaretli gelmesin.
  const [decision, setDecision] = useState<Decision | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ error?: string; message?: string }>({});
  const [amountError, setAmountError] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirm();
  const closedRef = useRef<HTMLDivElement>(null);
  const firstRadioRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const isClosed = !ACTIVE_STATUSES.includes(claim.status);

  // Karar kaydedilince form "sonuçlandı" görünümüne geçer; odak, başarı mesajını da içeren
  // alana taşınır (ekran okuyucu kararın sonucunu ve formun kapandığını birlikte okur).
  useEffect(() => {
    if (isClosed && feedback.message) closedRef.current?.focus();
  }, [isClosed, feedback.message]);

  if (claim.type === "CHARGEBACK") {
    return (
      <DecisionCard>
        <p className="text-sm text-gray-700">{t("decision.pspManaged")}</p>
      </DecisionCard>
    );
  }
  if (isClosed) {
    return (
      <DecisionCard>
        <div ref={closedRef} tabIndex={-1} className="space-y-1 focus:outline-none">
          {feedback.message && <Status message={feedback.message} />}
          <p className="text-sm text-gray-700">{t("decision.closed")}</p>
        </div>
      </DecisionCard>
    );
  }

  const requestedMoney = f.money(claim.amountRequestedMinor, claim.currency);
  // Misafir iadesinde karar (tam ya da kısmi) iade edilebilir tutarı aşamaz; sunucu da reddeder.
  const refundableMinor =
    claim.type === "GUEST_REFUND" ? (detail.booking?.refundableMinor ?? null) : null;
  const refundableText =
    refundableMinor !== null
      ? t("decision.refundableMax", { amount: f.money(refundableMinor, claim.currency) })
      : null;
  // Hasar talebinde yalnız geçerli provizyondan tahsil edilir; aşan kısım kayda geçer.
  const limitText =
    claim.type === "GUEST_REFUND"
      ? refundableText
      : deposit?.status === "AUTHORIZED"
        ? t("decision.depositAvailable", {
            amount: f.money(deposit.amountMinor - deposit.capturedMinor, deposit.currency),
          })
        : t("decision.depositNone");
  const parsedAmount =
    decision === "PARTIAL" ? parseAmountToMinor(amount, currencyDigits(claim.currency)) : null;
  const previewMoney =
    parsedAmount !== null && parsedAmount > 0 ? f.money(parsedAmount, claim.currency) : null;
  const amountHint = t("decision.amountHint", { amount: requestedMoney });
  const submitLabel =
    decision === "APPROVE"
      ? t("decision.submitApprove", { amount: requestedMoney })
      : decision === "PARTIAL"
        ? previewMoney
          ? t("decision.submitPartialAmount", { amount: previewMoney })
          : t("decision.submitPartial")
        : decision === "REJECT"
          ? t("decision.submitReject")
          : t("decision.submit");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setFeedback({});
    setAmountError(null);
    if (!decision) {
      setFeedback({ error: t("decision.chooseFirst") });
      firstRadioRef.current?.focus();
      return;
    }
    if (
      decision === "APPROVE" &&
      refundableMinor !== null &&
      claim.amountRequestedMinor > refundableMinor
    ) {
      setFeedback({
        error: t("decision.exceedsRefundable", {
          requested: requestedMoney,
          refundable: f.money(refundableMinor, claim.currency),
        }),
      });
      return;
    }
    let amountMinor: number | undefined;
    if (decision === "PARTIAL") {
      const parsed = parsedAmount;
      if (parsed === null || parsed <= 0 || parsed >= claim.amountRequestedMinor) {
        // Hata alana bağlanır (aria-invalid + describedby); odak, hata DOM'a yazıldıktan sonra.
        setAmountError(
          parsed === null
            ? t("open.invalidAmount")
            : t("decision.invalidAmount", { amount: requestedMoney })
        );
        requestAnimationFrame(() => amountRef.current?.focus());
        return;
      }
      if (refundableMinor !== null && parsed > refundableMinor) {
        setAmountError(
          t("decision.amountOverRefundable", { amount: f.money(refundableMinor, claim.currency) })
        );
        requestAnimationFrame(() => amountRef.current?.focus());
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
    <DecisionCard>
      <p className="mb-3 text-sm text-gray-700">
        {claim.type === "GUEST_REFUND" ? t("decision.explainRefund") : t("decision.explainDamage")}
      </p>
      {limitText && <p className="mb-3 text-sm font-medium text-gray-800">{limitText}</p>}
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
                {t(`decision.${d}`, { amount: requestedMoney })}
              </label>
            ))}
          </div>
        </fieldset>
        {decision === "PARTIAL" && (
          <div>
            <Field
              label={t("decision.amount", { currency: claim.currency })}
              id={`${fid}-amount`}
              hint={refundableText ? `${refundableText} ${amountHint}` : amountHint}
              error={amountError}
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
                  setAmountError(null);
                }}
              />
            </Field>
            {/* Girilen metnin nasıl yorumlandığı (ör. "1.250" → 1.250,00 ₺) yazarken duyurulur. */}
            <p aria-live="polite" className="mt-1 text-sm text-gray-700">
              {previewMoney ? t("decision.amountPreview", { amount: previewMoney }) : null}
            </p>
          </div>
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
          {busy ? t("decision.submitting") : submitLabel}
        </Button>
        <Status error={feedback.error} message={feedback.message} />
      </form>
      {confirmDialog}
    </DecisionCard>
  );
}
