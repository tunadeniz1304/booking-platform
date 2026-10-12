"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { ApiError, apiFetch } from "@/lib/api-client";
import { useFormat } from "@/i18n/use-format";
import {
  Button,
  Card,
  Field,
  Status,
  focusFirstInvalid,
  focusRing,
  inputClass,
  useErrorText,
  useLoader,
} from "@/components/ui/ui";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { AppealCharLimitStatus, useAppealCountHint } from "@/components/compliance/AppealCharLimit";

interface AppealRow {
  id: string;
  noticeId: string;
  appellantRole: "REPORTER" | "HOST";
  reason: string;
  createdAt: string;
  notice: {
    id: string;
    contentUrl: string;
    category: string;
    decision: "REMOVED" | "NO_ACTION" | null;
    statementOfReasons: string | null;
  } | null;
}

type DecisionField = "outcome" | "ground" | "response";
type RowFieldErrors = Partial<Record<DecisionField, string>>;

const RESPONSE_MIN = 10;
const RESPONSE_MAX = 5000;
const ERROR_ICON = "\u26A0\uFE0E";
const RESPONSE_DRAFT_PREFIX = "compliance.appealResponseDraft.";

/** Gerekçe taslağı (sekme oturumu); depolama kapalıysa boş. */
function readResponseDraft(id: string): string {
  try {
    return window.sessionStorage.getItem(RESPONSE_DRAFT_PREFIX + id) ?? "";
  } catch {
    return "";
  }
}

/** Taslağı sekme oturumunda saklar; boşsa siler. */
function writeResponseDraft(id: string, value: string) {
  try {
    const key = RESPONSE_DRAFT_PREFIX + id;
    if (value) window.sessionStorage.setItem(key, value);
    else window.sessionStorage.removeItem(key);
  } catch {
    // Depolama kapalıysa taslak yalnız bellekte kalır.
  }
}

/** Başlık için kısaltılmış içerik adresi (protokolsüz, en çok 48 karakter). */
function shortUrl(url: string): string {
  const bare = url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return bare.length > 48 ? `${bare.slice(0, 47)}…` : bare;
}

/** VALIDATION_ERROR yanıtındaki (`details.fieldErrors`, zod flatten) hatalı alan adları. */
function invalidFields(error: unknown): string[] {
  if (!(error instanceof ApiError) || error.code !== "VALIDATION_ERROR") return [];
  const details = error.details as { fieldErrors?: Record<string, unknown> } | undefined;
  const fields = details?.fieldErrors;
  if (!fields || typeof fields !== "object") return [];
  return Object.keys(fields).filter((name) => {
    const messages = fields[name];
    return Array.isArray(messages) && messages.length > 0;
  });
}

/** DSA md. 20 itiraz kuyruğu (ADMIN, P2-1a): kabul (karar geri alınır) / ret + gerekçe. */
export default function AppealQueue() {
  const t = useTranslations("compliance.appeal.admin");
  const ta = useTranslations("compliance.admin");
  const tp = useTranslations("compliance.appeal");
  const tc = useTranslations("common");
  const f = useFormat();
  const errorText = useErrorText();
  const countHint = useAppealCountHint();
  const { confirm, confirmDialog } = useConfirm();
  const appeals = useLoader(() =>
    apiFetch<{ appeals: AppealRow[] }>("/api/admin/notice-appeals?status=PENDING").then(
      (r) => r.appeals
    )
  );
  const [message, setMessage] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, RowFieldErrors>>({});
  const [outcomes, setOutcomes] = useState<Record<string, "UPHELD" | "REJECTED">>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<string | null>(null);
  const pendingRef = useRef<string | null>(null);
  const focusAfterReload = useRef<string | null>(null);

  // Karar verilen öğe listeden kalkınca odak sonraki öğeye (yoksa kart başlığına) taşınır.
  useEffect(() => {
    const target = focusAfterReload.current;
    if (!target) return;
    focusAfterReload.current = null;
    const el = document.getElementById(target);
    if (!el) return;
    if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
    el.focus();
  }, [appeals.data]);

  // F2-07: aynı rollü satırlar ayırt edilsin diye başlıkta içerik ve itiraz tarihi de var.
  const rowTitle = (row: AppealRow) =>
    t("rowTitle", {
      content: row.notice ? shortUrl(row.notice.contentUrl) : t("noContent"),
      role: t(`roles.${row.appellantRole}`),
      decision: row.notice?.decision ? tp(`decisions.${row.notice.decision}`) : t("noDecision"),
      date: f.date(row.createdAt, "medium"),
    });
  /** Satır listeden kalktığında duyurularda öğeyi tanıtan metin. */
  const itemLabel = (row: AppealRow) => row.notice?.contentUrl ?? rowTitle(row);

  const draftOf = (id: string) => drafts[id] ?? readResponseDraft(id);
  const setDraft = (id: string, value: string) => {
    setDrafts((prev) => ({ ...prev, [id]: value }));
    writeResponseDraft(id, value);
  };
  const clearFieldError = (id: string, name: DecisionField) =>
    setFieldErrors((prev) =>
      prev[id]?.[name] ? { ...prev, [id]: { ...prev[id], [name]: undefined } } : prev
    );

  const fieldMessage = (name: string) =>
    name === "outcome"
      ? t("chooseOutcome")
      : name === "ground"
        ? ta("errors.fields.ground")
        : name === "response"
          ? t("errors.response")
          : ta("errors.fields.other");

  const decide = (row: AppealRow) => async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pendingRef.current) return;
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    const outcome = outcomes[row.id];
    const needsGround = outcome === "UPHELD" && row.notice?.decision === "NO_ACTION";
    const errors: RowFieldErrors = {};
    if (!outcome) errors.outcome = fieldMessage("outcome");
    if (needsGround && !form.get("ground")) errors.ground = fieldMessage("ground");
    if (String(form.get("response") ?? "").trim().length < RESPONSE_MIN) {
      errors.response = fieldMessage("response");
    }
    setFieldErrors((prev) => ({ ...prev, [row.id]: errors }));
    if (!outcome || Object.keys(errors).length > 0) {
      setRowErrors((prev) => ({ ...prev, [row.id]: "" }));
      focusFirstInvalid(formEl);
      return;
    }
    const ok = await confirm({
      title: t("confirm.title"),
      body: (
        <>
          <span className="block break-all">
            {t("confirm.summary", {
              url: row.notice?.contentUrl ?? t("noContent"),
              role: t(`roles.${row.appellantRole}`),
              date: f.date(row.createdAt, "medium"),
            })}
          </span>
          <span className="mt-1 block">{t(`outcomes.${outcome}`)}</span>
          <span className="mt-1 block">
            {outcome === "UPHELD"
              ? row.notice?.decision === "NO_ACTION"
                ? t("confirm.upheldRemove")
                : t("confirm.upheldRestore")
              : t("confirm.rejected")}
          </span>
          <span className="mt-1 block font-semibold">{t("confirm.final")}</span>
        </>
      ),
      confirmLabel: t("confirm.confirm"),
      tone: outcome === "UPHELD" ? "danger" : "primary",
    });
    if (!ok) return;
    const list = appeals.data ?? [];
    const index = list.findIndex((x) => x.id === row.id);
    const next = list[index + 1] ?? list[index - 1];
    const leaveRow = () => {
      setDraft(row.id, "");
      focusAfterReload.current = next ? `appeal-${next.id}-title` : "appeals-title";
      appeals.reload();
    };
    pendingRef.current = row.id;
    setPending(row.id);
    setMessage(null);
    setListError(null);
    setRowErrors((prev) => ({ ...prev, [row.id]: "" }));
    try {
      await apiFetch(`/api/admin/notice-appeals/${row.id}`, {
        method: "POST",
        body: JSON.stringify({
          outcome,
          response: form.get("response"),
          ...(needsGround ? { ground: form.get("ground") } : {}),
        }),
      });
      setMessage(t("decided", { item: itemLabel(row) }));
      leaveRow();
    } catch (err: unknown) {
      const code = err instanceof ApiError ? err.code : undefined;
      if (code === "APPEAL_DECIDED" || code === "NOT_FOUND") {
        // Başkası karar verdi ya da itiraz silindi: satır kalkar, sonuç liste düzeyinde okunur.
        const key = code === "APPEAL_DECIDED" ? "errors.decided" : "errors.notFound";
        setListError(t(key, { item: itemLabel(row) }));
        leaveRow();
        return;
      }
      const names = invalidFields(err);
      if (names.length > 0) {
        const fields: RowFieldErrors = {};
        for (const name of names) fields[name as DecisionField] = fieldMessage(name);
        setFieldErrors((prev) => ({ ...prev, [row.id]: fields }));
        setRowErrors((prev) => ({ ...prev, [row.id]: ta("errors.validation") }));
        focusFirstInvalid(formEl);
        return;
      }
      setRowErrors((prev) => ({ ...prev, [row.id]: errorText(err) }));
    } finally {
      pendingRef.current = null;
      setPending(null);
    }
  };

  const rows = appeals.data ?? [];
  return (
    <Card title={t("title")} id="appeals">
      <p className="mb-3 text-sm text-gray-700">{t("intro")}</p>
      {confirmDialog}
      <Status error={appeals.error ?? listError} message={message} />
      {!appeals.data && !appeals.error && (
        <p role="status" className="text-sm text-gray-600">
          {tc("loading")}
        </p>
      )}
      {appeals.data && rows.length === 0 && <p className="text-sm text-gray-600">{t("empty")}</p>}
      <ul className="space-y-4">
        {rows.map((row) => {
          const outcome = outcomes[row.id];
          const needsGround = outcome === "UPHELD" && row.notice?.decision === "NO_ACTION";
          const errors = fieldErrors[row.id] ?? {};
          const titleId = `appeal-${row.id}-title`;
          const submitId = `appeal-${row.id}-submit`;
          const outcomeHintId = `outcome-${row.id}-hint`;
          const outcomeErrorId = `outcome-${row.id}-error`;
          const outcomeDescribedBy = errors.outcome
            ? `${outcomeHintId} ${outcomeErrorId}`
            : outcomeHintId;
          const response = draftOf(row.id);
          return (
            <li key={row.id} className="rounded-md border border-gray-200 p-3 text-sm">
              <h3 id={titleId} tabIndex={-1} className="font-semibold text-gray-900">
                {rowTitle(row)}
              </h3>
              <p className="text-gray-700">
                {t("appealedAt", { date: f.date(row.createdAt, "medium") })}
              </p>
              {row.notice && (
                <p className="mt-1">
                  <a
                    className={`break-all text-[#003580] underline ${focusRing}`}
                    href={row.notice.contentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {row.notice.contentUrl}
                    <span className="sr-only"> {ta("noticeQueue.newTab")}</span>
                  </a>
                </p>
              )}
              <p className="mt-2 whitespace-pre-line break-words text-gray-800">{row.reason}</p>
              {row.notice?.statementOfReasons && (
                <details className="mt-2">
                  <summary className={`cursor-pointer text-gray-800 ${focusRing}`}>
                    {t("statement")}
                  </summary>
                  <pre className="mt-1 whitespace-pre-wrap font-sans text-xs text-gray-700">
                    {row.notice.statementOfReasons}
                  </pre>
                </details>
              )}
              <form
                onSubmit={(e) => void decide(row)(e)}
                aria-labelledby={titleId}
                noValidate
                className="mt-3 grid gap-2 sm:grid-cols-2"
              >
                <fieldset className="sm:col-span-2" aria-describedby={outcomeDescribedBy}>
                  <legend className="text-sm font-medium text-gray-800">{t("outcome")}</legend>
                  <p id={outcomeHintId} className="text-xs text-gray-600">
                    {t("chooseOutcome")}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-4">
                    {(["UPHELD", "REJECTED"] as const).map((o) => (
                      <label
                        key={o}
                        className="inline-flex min-h-[44px] items-center gap-2 sm:min-h-[1.5rem]"
                      >
                        <input
                          id={`outcome-${row.id}-${o}`}
                          type="radio"
                          required
                          name={`outcome-${row.id}`}
                          value={o}
                          checked={outcome === o}
                          onChange={() => {
                            setOutcomes((prev) => ({ ...prev, [row.id]: o }));
                            setRowErrors((prev) => ({ ...prev, [row.id]: "" }));
                            clearFieldError(row.id, "outcome");
                          }}
                          className="h-4 w-4"
                        />
                        {t(`outcomes.${o}`)}
                      </label>
                    ))}
                  </div>
                  {errors.outcome && (
                    <p id={outcomeErrorId} className="mt-1 text-xs font-medium text-red-700">
                      <span aria-hidden="true">{ERROR_ICON} </span>
                      <span className="sr-only">{tc("errorPrefix")} </span>
                      {errors.outcome}
                    </p>
                  )}
                </fieldset>
                {needsGround && (
                  <Field
                    id={`ag-${row.id}`}
                    label={ta("ground")}
                    hint={t("groundHint")}
                    error={errors.ground}
                  >
                    <select
                      id={`ag-${row.id}`}
                      name="ground"
                      className={inputClass}
                      required
                      defaultValue=""
                      onChange={() => clearFieldError(row.id, "ground")}
                    >
                      <option value="" disabled>
                        {ta("choose")}
                      </option>
                      <option value="ILLEGAL_CONTENT">{ta("grounds.ILLEGAL_CONTENT")}</option>
                      <option value="TERMS_OF_SERVICE">{ta("grounds.TERMS_OF_SERVICE")}</option>
                    </select>
                  </Field>
                )}
                <div className="sm:col-span-2">
                  <Field
                    id={`ar-${row.id}`}
                    label={t("response")}
                    hint={countHint(t("responseHint"), response.length, RESPONSE_MAX)}
                    error={errors.response}
                  >
                    <textarea
                      id={`ar-${row.id}`}
                      name="response"
                      required
                      minLength={RESPONSE_MIN}
                      maxLength={RESPONSE_MAX}
                      rows={4}
                      value={response}
                      onChange={(e) => {
                        const value = e.currentTarget.value;
                        setDraft(row.id, value);
                        if (value.trim().length >= RESPONSE_MIN) {
                          clearFieldError(row.id, "response");
                        }
                      }}
                      className={inputClass}
                    />
                  </Field>
                  <AppealCharLimitStatus length={response.length} max={RESPONSE_MAX} />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Button
                    id={submitId}
                    type="submit"
                    busy={pending === row.id}
                    aria-labelledby={`${submitId} ${titleId}`}
                  >
                    {pending === row.id ? ta("saving") : t("submit")}
                  </Button>
                  <Status error={rowErrors[row.id] || null} />
                </div>
              </form>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
