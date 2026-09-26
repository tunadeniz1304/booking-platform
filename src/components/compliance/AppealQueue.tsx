"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api-client";
import { useFormat } from "@/i18n/use-format";
import {
  Button,
  Card,
  Field,
  Status,
  errorMessage,
  focusRing,
  inputClass,
  useLoader,
} from "@/components/ui/ui";

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
  const f = useFormat();
  const appeals = useLoader(() =>
    apiFetch<{ appeals: AppealRow[] }>("/api/admin/notice-appeals?status=PENDING").then(
      (r) => r.appeals
    )
  );
  const [status, setStatus] = useState<{ error?: string; message?: string }>({});
  const [outcomes, setOutcomes] = useState<Record<string, "UPHELD" | "REJECTED">>({});

  const decide = (row: AppealRow) => (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const outcome = outcomes[row.id] ?? "REJECTED";
    const needsGround = outcome === "UPHELD" && row.notice?.decision === "NO_ACTION";
    setStatus({});
    apiFetch(`/api/admin/notice-appeals/${row.id}`, {
      method: "POST",
      body: JSON.stringify({
        outcome,
        response: form.get("response"),
        ...(needsGround ? { ground: form.get("ground") } : {}),
      }),
    })
      .then(() => {
        setStatus({ message: t("decided") });
        appeals.reload();
      })
      .catch((err: unknown) => setStatus({ error: errorMessage(err) }));
  };

  const rows = appeals.data ?? [];
  return (
    <Card title={t("title")} id="appeals">
      <p className="mb-3 text-sm text-gray-700">{t("intro")}</p>
      <Status error={status.error ?? appeals.error} message={status.message} />
      {appeals.data && rows.length === 0 && <p className="text-sm text-gray-600">{t("empty")}</p>}
      <ul className="space-y-4">
        {rows.map((row) => {
          const outcome = outcomes[row.id] ?? "REJECTED";
          const needsGround = outcome === "UPHELD" && row.notice?.decision === "NO_ACTION";
          return (
            <li key={row.id} className="rounded-md border border-gray-200 p-3 text-sm">
              <p className="font-semibold text-gray-900">
                {t(`roles.${row.appellantRole}`)} ·{" "}
                {row.notice?.decision ? ta(`decisions.${row.notice.decision}`) : "-"} ·{" "}
                {f.date(row.createdAt, "medium")}
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
              <p className="mt-2 whitespace-pre-line text-gray-800">{row.reason}</p>
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
              <form onSubmit={decide(row)} className="mt-3 grid gap-2 sm:grid-cols-2">
                <fieldset className="sm:col-span-2">
                  <legend className="text-sm font-medium text-gray-800">{t("outcome")}</legend>
                  <div className="mt-1 flex flex-wrap gap-4">
                    {(["UPHELD", "REJECTED"] as const).map((o) => (
                      <label key={o} className="inline-flex min-h-[1.5rem] items-center gap-2">
                        <input
                          type="radio"
                          name={`outcome-${row.id}`}
                          value={o}
                          checked={outcome === o}
                          onChange={() => setOutcomes((prev) => ({ ...prev, [row.id]: o }))}
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
                      defaultValue="ILLEGAL_CONTENT"
                    >
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
                <div className="sm:col-span-2">
                  <Button type="submit">{t("submit")}</Button>
                </div>
              </form>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
