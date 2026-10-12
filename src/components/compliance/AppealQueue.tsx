"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api-client";
import { useFormat } from "@/i18n/use-format";
import {
  Button,
  Card,
  Field,
  Status,
  focusRing,
  inputClass,
  useErrorText,
  useLoader,
} from "@/components/ui/ui";
import { useConfirm } from "@/components/ui/ConfirmDialog";

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

/** DSA md. 20 itiraz kuyruğu (ADMIN, P2-1a): kabul (karar geri alınır) / ret + gerekçe. */
export default function AppealQueue() {
  const t = useTranslations("compliance.appeal.admin");
  const ta = useTranslations("compliance.admin");
  const tp = useTranslations("compliance.appeal");
  const tc = useTranslations("common");
  const f = useFormat();
  const errorText = useErrorText();
  const { confirm, confirmDialog } = useConfirm();
  const appeals = useLoader(() =>
    apiFetch<{ appeals: AppealRow[] }>("/api/admin/notice-appeals?status=PENDING").then(
      (r) => r.appeals
    )
  );
  const [message, setMessage] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [outcomes, setOutcomes] = useState<Record<string, "UPHELD" | "REJECTED">>({});
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

  const decide = (row: AppealRow) => async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pendingRef.current) return;
    const form = new FormData(e.currentTarget);
    const outcome = outcomes[row.id];
    if (!outcome) {
      setRowErrors((prev) => ({ ...prev, [row.id]: t("chooseOutcome") }));
      document.getElementById(`outcome-${row.id}-UPHELD`)?.focus();
      return;
    }
    const needsGround = outcome === "UPHELD" && row.notice?.decision === "NO_ACTION";
    const ok = await confirm({
      title: t("confirm.title"),
      body: (
        <>
          <span className="block">{t(`outcomes.${outcome}`)}</span>
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
    pendingRef.current = row.id;
    setPending(row.id);
    setMessage(null);
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
      setMessage(t("decided"));
      focusAfterReload.current = next ? `appeal-${next.id}-title` : "appeals-title";
      appeals.reload();
    } catch (err: unknown) {
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
      <Status error={appeals.error} message={message} />
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
          return (
            <li key={row.id} className="rounded-md border border-gray-200 p-3 text-sm">
              <h3
                id={`appeal-${row.id}-title`}
                tabIndex={-1}
                className="font-semibold text-gray-900"
              >
                {t("rowTitle", {
                  role: t(`roles.${row.appellantRole}`),
                  decision: row.notice?.decision
                    ? tp(`decisions.${row.notice.decision}`)
                    : t("noDecision"),
                })}
              </h3>
              <p className="text-gray-700">
                {t("appealedAt", { date: f.date(row.createdAt, "medium") })}
              </p>
              {row.notice && (
                <p className="mt-1">
                  <a
                    className={`break-all text-[#003580] underline ${focusRing}`}
                    href={row.notice.contentUrl}
                  >
                    {row.notice.contentUrl}
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
                className="mt-3 grid gap-2 sm:grid-cols-2"
              >
                <fieldset className="sm:col-span-2" aria-describedby={`outcome-${row.id}-hint`}>
                  <legend className="text-sm font-medium text-gray-800">{t("outcome")}</legend>
                  <p id={`outcome-${row.id}-hint`} className="text-xs text-gray-600">
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
                          }}
                          className="h-4 w-4"
                        />
                        {t(`outcomes.${o}`)}
                      </label>
                    ))}
                  </div>
                </fieldset>
                {needsGround && (
                  <Field id={`ag-${row.id}`} label={ta("ground")} hint={t("groundHint")}>
                    <select
                      id={`ag-${row.id}`}
                      name="ground"
                      className={inputClass}
                      required
                      defaultValue=""
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
                  <Field id={`ar-${row.id}`} label={t("response")}>
                    <textarea
                      id={`ar-${row.id}`}
                      name="response"
                      required
                      minLength={10}
                      maxLength={5000}
                      rows={2}
                      className={inputClass}
                    />
                  </Field>
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Button type="submit" busy={pending === row.id}>
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
