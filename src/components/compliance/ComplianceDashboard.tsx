"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api-client";
import { Button, Card, Field, Status, errorMessage, useLoader } from "@/components/ui/ui";

interface Takedown {
  id: string;
  source: string;
  referenceNo: string | null;
  propertyId: string;
  status: "RECEIVED" | "ACTIONED" | "CLOSED";
  slaDueAt: string;
  slaBreachedAt: string | null;
}
interface NoticeRow {
  id: string;
  contentUrl: string;
  category: string;
  explanation: string;
}

const input =
  "mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#003580] focus:outline-none focus:ring-1 focus:ring-[#003580]";

/** Minimal uyum paneli (ADMIN): kaldırma talebi kaydı/kapatma, DSA kararı, rapor export. */
export default function ComplianceDashboard() {
  const t = useTranslations("compliance.admin");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const takedowns = useLoader(() =>
    apiFetch<{ takedowns: Takedown[] }>("/api/admin/takedowns").then((r) => r.takedowns)
  );
  const notices = useLoader(() =>
    apiFetch<{ notices: NoticeRow[] }>("/api/admin/notices?status=RECEIVED").then((r) => r.notices)
  );

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setError(null);
    setMessage(null);
    try {
      await fn();
      setMessage(ok);
      takedowns.reload();
      notices.reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const createTakedown = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void run(
      () =>
        apiFetch("/api/admin/takedowns", {
          method: "POST",
          body: JSON.stringify({
            source: f.get("source"),
            propertyId: f.get("propertyId"),
            referenceNo: String(f.get("referenceNo") ?? "") || undefined,
            reason: f.get("reason"),
          }),
        }),
      t("takedownCreated")
    );
  };

  const closeTakedown = (id: string) =>
    void run(
      () =>
        apiFetch(`/api/admin/takedowns/${id}`, {
          method: "POST",
          body: JSON.stringify({ resolution: t("defaultResolution") }),
        }),
      t("takedownClosed")
    );

  const decide = (id: string) => (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const decision = String(f.get("decision"));
    void run(
      () =>
        apiFetch(`/api/admin/notices/${id}`, {
          method: "POST",
          body: JSON.stringify({
            decision,
            ground: decision === "REMOVED" ? f.get("ground") : undefined,
            facts: f.get("facts"),
            legalReference: String(f.get("legalReference") ?? "") || undefined,
          }),
        }),
      t("noticeDecided")
    );
  };

  const now = new Date();
  const from = `${now.getUTCFullYear()}-01-01`;
  const to = new Date(now.getTime() + 86_400_000).toISOString().slice(0, 10);
  const reportUrl = `/api/admin/compliance/transparency?from=${from}&to=${to}`;
  const pending = notices.data ?? [];

  return (
    <div className="space-y-6">
      <Status error={error ?? takedowns.error ?? notices.error} message={message} />

      <Card title={t("takedowns")} id="takedowns">
        <form onSubmit={createTakedown} className="grid gap-3 sm:grid-cols-2">
          <Field id="td-source" label={t("source")}>
            <select id="td-source" name="source" className={input} defaultValue="MINISTRY_7565">
              <option value="MINISTRY_7565">{t("sources.MINISTRY_7565")}</option>
              <option value="COURT_ORDER">{t("sources.COURT_ORDER")}</option>
              <option value="OTHER_AUTHORITY">{t("sources.OTHER_AUTHORITY")}</option>
            </select>
          </Field>
          <Field id="td-property" label={t("propertyId")}>
            <input id="td-property" name="propertyId" required className={input} />
          </Field>
          <Field id="td-ref" label={t("referenceNo")}>
            <input id="td-ref" name="referenceNo" className={input} />
          </Field>
          <Field id="td-reason" label={t("reason")}>
            <input id="td-reason" name="reason" required minLength={3} className={input} />
          </Field>
          <div className="sm:col-span-2">
            <Button type="submit">{t("createTakedown")}</Button>
          </div>
        </form>
        <ul className="mt-4 divide-y divide-gray-100 text-sm">
          {(takedowns.data ?? []).map((td) => (
            <li key={td.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <strong>{td.referenceNo ?? td.id}</strong> — {td.propertyId} —{" "}
                {t(`status.${td.status}`)} ·{" "}
                {t("slaDue", { at: td.slaDueAt.slice(0, 16).replace("T", " ") })}
                {td.slaBreachedAt && <strong className="ml-2 text-red-700">{t("breached")}</strong>}
              </span>
              {td.status !== "CLOSED" && (
                <Button variant="secondary" onClick={() => closeTakedown(td.id)}>
                  {t("close")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <Card title={t("notices")} id="notices">
        {pending.length === 0 && <p className="text-sm text-gray-600">{t("noNotices")}</p>}
        <ul className="space-y-4">
          {pending.map((n) => (
            <li key={n.id} className="rounded-md border border-gray-200 p-3 text-sm">
              <p>
                <strong>{n.category}</strong> —{" "}
                <a className="text-[#003580] underline" href={n.contentUrl}>
                  {n.contentUrl}
                </a>
              </p>
              <p className="mt-1 whitespace-pre-line text-gray-700">{n.explanation}</p>
              <form onSubmit={decide(n.id)} className="mt-2 grid gap-2 sm:grid-cols-2">
                <Field id={`d-${n.id}`} label={t("decision")}>
                  <select
                    id={`d-${n.id}`}
                    name="decision"
                    className={input}
                    defaultValue="NO_ACTION"
                  >
                    <option value="REMOVED">{t("decisions.REMOVED")}</option>
                    <option value="NO_ACTION">{t("decisions.NO_ACTION")}</option>
                  </select>
                </Field>
                <Field id={`g-${n.id}`} label={t("ground")}>
                  <select
                    id={`g-${n.id}`}
                    name="ground"
                    className={input}
                    defaultValue="TERMS_OF_SERVICE"
                  >
                    <option value="ILLEGAL_CONTENT">{t("grounds.ILLEGAL_CONTENT")}</option>
                    <option value="TERMS_OF_SERVICE">{t("grounds.TERMS_OF_SERVICE")}</option>
                  </select>
                </Field>
                <Field id={`f-${n.id}`} label={t("facts")}>
                  <textarea
                    id={`f-${n.id}`}
                    name="facts"
                    required
                    minLength={10}
                    rows={2}
                    className={input}
                  />
                </Field>
                <Field id={`l-${n.id}`} label={t("legalReference")}>
                  <input id={`l-${n.id}`} name="legalReference" className={input} />
                </Field>
                <div className="sm:col-span-2">
                  <Button type="submit">{t("decide")}</Button>
                </div>
              </form>
            </li>
          ))}
        </ul>
      </Card>

      <Card title={t("transparency")} id="transparency">
        <p className="text-sm">
          <a className="font-semibold text-[#003580] underline" href={`${reportUrl}&format=csv`}>
            {t("exportCsv")}
          </a>
          {" · "}
          <a className="font-semibold text-[#003580] underline" href={reportUrl}>
            {t("exportJson")}
          </a>
        </p>
      </Card>
    </div>
  );
}
