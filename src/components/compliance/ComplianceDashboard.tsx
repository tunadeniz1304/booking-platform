"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api-client";
import { Button, Card, Field, Status, useErrorText, useLoader } from "@/components/ui/ui";
import { useConfirm } from "@/components/ui/ConfirmDialog";

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
type Result = { error?: string; message?: string };
type PropertyPreview =
  | { state: "loading" }
  | { state: "found"; title: string; city: string | null }
  | { state: "missing" };

const input =
  "mt-1 w-full rounded-md border border-gray-500 px-3 py-2 text-sm focus:border-[#003580] focus:outline-none focus:ring-1 focus:ring-[#003580]";

/** Kaldırılan öğeden sonra odağı listedeki komşu öğeye (yoksa kart başlığına) taşır. */
function focusById(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
  el.focus();
}

/** Minimal uyum paneli (ADMIN): kaldırma talebi kaydı/kapatma, DSA kararı, rapor export. */
export default function ComplianceDashboard() {
  const t = useTranslations("compliance.admin");
  const tc = useTranslations("common");
  const errorText = useErrorText();
  const { confirm, confirmDialog } = useConfirm();
  const [results, setResults] = useState<Record<string, Result>>({});
  const [pending, setPending] = useState<string | null>(null);
  const pendingRef = useRef<string | null>(null);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<PropertyPreview | null>(null);
  const focusAfterReload = useRef<string | null>(null);
  const takedowns = useLoader(() =>
    apiFetch<{ takedowns: Takedown[] }>("/api/admin/takedowns").then((r) => r.takedowns)
  );
  const notices = useLoader(() =>
    apiFetch<{ notices: NoticeRow[] }>("/api/admin/notices?status=RECEIVED").then((r) => r.notices)
  );

  useEffect(() => {
    const target = focusAfterReload.current;
    if (!target) return;
    focusAfterReload.current = null;
    focusById(target);
  }, [notices.data, takedowns.data]);

  const setResult = (key: string, r: Result) => setResults((prev) => ({ ...prev, [key]: r }));

  /** Tek eylem aynı anda: istek sürerken ikinci gönderim yok sayılır (çift kayıt yok). */
  const run = async (key: string, fn: () => Promise<unknown>, ok: string): Promise<boolean> => {
    if (pendingRef.current) return false;
    pendingRef.current = key;
    setPending(key);
    setResult(key, {});
    try {
      await fn();
      setResult(key, { message: ok });
      return true;
    } catch (e) {
      setResult(key, { error: errorText(e) });
      return false;
    } finally {
      pendingRef.current = null;
      setPending(null);
    }
  };

  const lookupProperty = (raw: string) => {
    const id = raw.trim();
    if (!id) {
      setPreview(null);
      return;
    }
    setPreview({ state: "loading" });
    apiFetch<{ title: string; location?: { city?: string | null } | null }>(
      `/api/properties/${encodeURIComponent(id)}`
    )
      .then((p) => setPreview({ state: "found", title: p.title, city: p.location?.city ?? null }))
      .catch(() => setPreview({ state: "missing" }));
  };

  const createTakedown = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pendingRef.current) return;
    const form = e.currentTarget;
    const f = new FormData(form);
    const propertyId = String(f.get("propertyId") ?? "").trim();
    const listing =
      preview?.state === "found"
        ? preview.city
          ? `${preview.title} (${preview.city})`
          : preview.title
        : propertyId;
    const ok = await confirm({
      title: t("confirmTakedown.title"),
      body: t("confirmTakedown.body", { listing }),
      confirmLabel: t("confirmTakedown.confirm"),
      tone: "danger",
    });
    if (!ok) return;
    const done = await run(
      "create",
      () =>
        apiFetch("/api/admin/takedowns", {
          method: "POST",
          body: JSON.stringify({
            source: f.get("source"),
            propertyId,
            referenceNo: String(f.get("referenceNo") ?? "").trim() || undefined,
            reason: f.get("reason"),
          }),
        }),
      t("takedownCreated")
    );
    if (done) {
      form.reset();
      setPreview(null);
      takedowns.reload();
    }
  };

  const closeTakedown = async (id: string, e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const resolution = String(new FormData(e.currentTarget).get("resolution") ?? "").trim();
    const done = await run(
      `td-${id}`,
      () =>
        apiFetch(`/api/admin/takedowns/${id}`, {
          method: "POST",
          body: JSON.stringify({ resolution }),
        }),
      t("takedownClosed")
    );
    if (done) {
      setClosingId(null);
      focusAfterReload.current = `td-${id}-state`;
      takedowns.reload();
    }
  };

  const decide = (n: NoticeRow) => async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pendingRef.current) return;
    const f = new FormData(e.currentTarget);
    const decision = String(f.get("decision") ?? "");
    const ground = decision === "REMOVED" ? String(f.get("ground") ?? "") : "";
    const ok = await confirm({
      title: t("confirmDecision.title"),
      body: (
        <>
          <span className="block">
            {t("confirmDecision.summary", {
              decision: t(`decisions.${decision}`),
              url: n.contentUrl,
            })}
          </span>
          {ground && (
            <span className="mt-1 block">
              {t("ground")}: {t(`grounds.${ground}`)}
            </span>
          )}
          <span className="mt-1 block">
            {decision === "REMOVED"
              ? t("confirmDecision.removedEffect")
              : t("confirmDecision.noActionEffect")}
          </span>
          <span className="mt-1 block font-semibold">{t("confirmDecision.final")}</span>
        </>
      ),
      confirmLabel: t("confirmDecision.confirm"),
      tone: decision === "REMOVED" ? "danger" : "primary",
    });
    if (!ok) return;
    const list = notices.data ?? [];
    const index = list.findIndex((x) => x.id === n.id);
    const next = list[index + 1] ?? list[index - 1];
    const done = await run(
      `n-${n.id}`,
      () =>
        apiFetch(`/api/admin/notices/${n.id}`, {
          method: "POST",
          body: JSON.stringify({
            decision,
            ground: ground || undefined,
            facts: f.get("facts"),
            legalReference: String(f.get("legalReference") ?? "").trim() || undefined,
          }),
        }),
      t("noticeDecided")
    );
    if (done) {
      setResult("notices", { message: t("noticeDecided") });
      focusAfterReload.current = next ? `notice-${next.id}-title` : "notices-title";
      notices.reload();
    }
  };

  const now = new Date();
  const from = `${now.getUTCFullYear()}-01-01`;
  const to = new Date(now.getTime() + 86_400_000).toISOString().slice(0, 10);
  const reportUrl = `/api/admin/compliance/transparency?from=${from}&to=${to}`;
  const pendingNotices = notices.data ?? [];

  return (
    <div className="space-y-6">
      {confirmDialog}

      <Card title={t("takedowns")} id="takedowns">
        <form onSubmit={createTakedown} className="grid gap-3 sm:grid-cols-2">
          <Field id="td-source" label={t("source")}>
            <select id="td-source" name="source" className={input} defaultValue="MINISTRY_7565">
              <option value="MINISTRY_7565">{t("sources.MINISTRY_7565")}</option>
              <option value="COURT_ORDER">{t("sources.COURT_ORDER")}</option>
              <option value="OTHER_AUTHORITY">{t("sources.OTHER_AUTHORITY")}</option>
            </select>
          </Field>
          <Field id="td-property" label={t("propertyId")} hint={t("propertyIdHint")}>
            <input
              id="td-property"
              name="propertyId"
              required
              autoComplete="off"
              spellCheck={false}
              onBlur={(e) => lookupProperty(e.currentTarget.value)}
              onChange={() => setPreview(null)}
              className={input}
            />
          </Field>
          <Field id="td-ref" label={t("referenceNo")}>
            <input
              id="td-ref"
              name="referenceNo"
              autoComplete="off"
              spellCheck={false}
              className={input}
            />
          </Field>
          <Field id="td-reason" label={t("reason")}>
            <input id="td-reason" name="reason" required minLength={3} className={input} />
          </Field>
          <p aria-live="polite" className="text-sm text-gray-700 sm:col-span-2">
            {preview?.state === "loading" && t("preview.loading")}
            {preview?.state === "found" &&
              t("preview.found", { title: preview.title, city: preview.city ?? "-" })}
            {preview?.state === "missing" && t("preview.missing")}
          </p>
          <div className="space-y-2 sm:col-span-2">
            <Button type="submit" busy={pending === "create"}>
              {pending === "create" ? t("saving") : t("createTakedown")}
            </Button>
            <Status error={results.create?.error} message={results.create?.message} />
          </div>
        </form>

        {takedowns.error ? (
          <div className="mt-4 space-y-2">
            <Status error={takedowns.error} />
            <Button variant="secondary" onClick={() => takedowns.reload()}>
              {t("retry")}
            </Button>
          </div>
        ) : takedowns.data === null ? (
          <p role="status" className="mt-4 text-sm text-gray-600">
            {tc("loading")}
          </p>
        ) : takedowns.data.length === 0 ? (
          <p className="mt-4 text-sm text-gray-600">{t("noTakedowns")}</p>
        ) : (
          <ul className="mt-4 divide-y divide-gray-100 text-sm">
            {takedowns.data.map((td) => {
              const key = `td-${td.id}`;
              return (
                <li key={td.id} className="py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span id={`td-${td.id}-state`} className="min-w-0 break-words">
                      <strong>{td.referenceNo ?? td.id}</strong> — {td.propertyId} —{" "}
                      {t(`status.${td.status}`)} ·{" "}
                      {t("slaDue", { at: td.slaDueAt.slice(0, 16).replace("T", " ") })}
                      {td.slaBreachedAt && (
                        <strong className="ml-2 text-red-700">{t("breached")}</strong>
                      )}
                    </span>
                    {td.status !== "CLOSED" && closingId !== td.id && (
                      <Button variant="secondary" onClick={() => setClosingId(td.id)}>
                        {t("close")}
                      </Button>
                    )}
                  </div>
                  {td.status !== "CLOSED" && closingId === td.id && (
                    <form
                      id={`td-${td.id}-close`}
                      onSubmit={(e) => void closeTakedown(td.id, e)}
                      className="mt-2 space-y-2 rounded-md border border-gray-200 p-3"
                    >
                      <Field
                        id={`td-${td.id}-resolution`}
                        label={t("closeForm.resolution")}
                        hint={t("closeForm.warning")}
                      >
                        <textarea
                          id={`td-${td.id}-resolution`}
                          name="resolution"
                          required
                          minLength={3}
                          maxLength={2000}
                          rows={2}
                          autoFocus
                          className={input}
                        />
                      </Field>
                      <div className="flex flex-wrap gap-2">
                        <Button type="submit" variant="danger" busy={pending === key}>
                          {pending === key ? t("saving") : t("closeForm.confirm")}
                        </Button>
                        <Button variant="secondary" onClick={() => setClosingId(null)}>
                          {tc("confirm.cancel")}
                        </Button>
                      </div>
                    </form>
                  )}
                  <Status error={results[key]?.error} message={results[key]?.message} />
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card title={t("notices")} id="notices">
        <Status error={results.notices?.error} message={results.notices?.message} />
        {notices.error ? (
          <div className="space-y-2">
            <Status error={notices.error} />
            <Button variant="secondary" onClick={() => notices.reload()}>
              {t("retry")}
            </Button>
          </div>
        ) : notices.data === null ? (
          <p role="status" className="text-sm text-gray-600">
            {tc("loading")}
          </p>
        ) : (
          pendingNotices.length === 0 && <p className="text-sm text-gray-600">{t("noNotices")}</p>
        )}
        <ul className="space-y-4">
          {pendingNotices.map((n) => {
            const key = `n-${n.id}`;
            const decision = decisions[n.id] ?? "";
            return (
              <li key={n.id} className="rounded-md border border-gray-200 p-3 text-sm">
                <h3 id={`notice-${n.id}-title`} tabIndex={-1} className="min-w-0">
                  <strong>{n.category}</strong> —{" "}
                  <a className="break-all text-[#003580] underline" href={n.contentUrl}>
                    {n.contentUrl}
                  </a>
                </h3>
                <p className="mt-1 whitespace-pre-line break-words text-gray-700">
                  {n.explanation}
                </p>
                <form onSubmit={decide(n)} className="mt-2 grid gap-2 sm:grid-cols-2">
                  <Field id={`d-${n.id}`} label={t("decision")}>
                    <select
                      id={`d-${n.id}`}
                      name="decision"
                      required
                      className={input}
                      value={decision}
                      onChange={(e) =>
                        setDecisions((prev) => ({ ...prev, [n.id]: e.target.value }))
                      }
                    >
                      <option value="" disabled>
                        {t("choose")}
                      </option>
                      <option value="REMOVED">{t("decisions.REMOVED")}</option>
                      <option value="NO_ACTION">{t("decisions.NO_ACTION")}</option>
                    </select>
                  </Field>
                  {decision === "REMOVED" && (
                    <Field id={`g-${n.id}`} label={t("ground")}>
                      <select
                        id={`g-${n.id}`}
                        name="ground"
                        required
                        className={input}
                        defaultValue=""
                      >
                        <option value="" disabled>
                          {t("choose")}
                        </option>
                        <option value="ILLEGAL_CONTENT">{t("grounds.ILLEGAL_CONTENT")}</option>
                        <option value="TERMS_OF_SERVICE">{t("grounds.TERMS_OF_SERVICE")}</option>
                      </select>
                    </Field>
                  )}
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
                  <div className="space-y-2 sm:col-span-2">
                    <Button type="submit" busy={pending === key}>
                      {pending === key ? t("saving") : t("decide")}
                    </Button>
                    <Status error={results[key]?.error} />
                  </div>
                </form>
              </li>
            );
          })}
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
