"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api-client";
import { useFormat } from "@/i18n/use-format";
import {
  Button,
  Card,
  Field,
  focusRing,
  LlmBadge,
  Status,
  errorMessage,
  inputClass,
  useLoader,
} from "@/components/ui/ui";
import { useConfirm } from "@/components/ui/ConfirmDialog";

interface OutboxState {
  counts: Record<string, number>;
  dead: Array<{
    id: string;
    eventType: string;
    aggregateId: string;
    attempts: number;
    lastError: string | null;
    createdAt: string;
  }>;
}

interface DemandEvent {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  impact: number;
  status: "PROPOSED" | "APPROVED" | "REJECTED" | "ROLLED_BACK";
  category: string | null;
  rationale: string | null;
  source: string | null;
  location: { city: string };
}

interface FraudCheck {
  id: string;
  bookingId: string;
  userId: string;
  score: number;
  decision: string;
  reasons: unknown;
  createdAt: string;
}

interface LlmStatus {
  mode: string;
  effectiveMode: string;
  model: string;
  baseUrlHost: string;
  hasKey: boolean;
  jsonModeSupported: boolean | null;
  lastError: string | null;
}

interface ExperimentResult {
  flagKey: string;
  enabled: boolean;
  variants: Array<{
    variant: string;
    exposures: number;
    users: number;
    conversions: number;
    rate: number;
    ci: { low: number; high: number };
  }>;
}

type Feedback = { error?: string; message?: string };

/**
 * Satır eylemi sonrası odak kurtarma: eylem başarılı olunca `mark(index)` çağrılır;
 * yeniden yüklenen veride odaklı düğme DOM'dan kalktıysa (odak <body>'ye düştüyse)
 * aynı sıradaki (yoksa son) satırın ilk denetimine, liste boşaldıysa kart başlığına odaklanır.
 * Satırlar `data-row` özniteliği taşımalıdır.
 */
export function useRowFocusRecovery(data: unknown, cardId: string): (index: number) => void {
  const pending = useRef<number | null>(null);
  useEffect(() => {
    const index = pending.current;
    if (index === null || !data) return;
    pending.current = null;
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    const card = document.getElementById(cardId);
    if (!card) return;
    const rows = card.querySelectorAll<HTMLElement>("[data-row]");
    const row = rows.length > 0 ? rows[Math.min(index, rows.length - 1)] : null;
    const target =
      row?.querySelector<HTMLElement>("button, a[href], input, textarea, select") ??
      card.querySelector<HTMLElement>("h2");
    if (!target) return;
    if (target.tagName === "H2") target.setAttribute("tabindex", "-1");
    target.focus();
  }, [data, cardId]);
  return (index: number) => {
    pending.current = index;
  };
}

/** Sunucu/LLM kaynaklı Türkçe metni, arayüz dili Türkçe değilse `lang="tr"` ile işaretler. */
function TrText({ children }: { children: ReactNode }) {
  const locale = useLocale();
  return locale === "tr" ? <>{children}</> : <span lang="tr">{children}</span>;
}

export default function AdminDashboard() {
  return (
    <div className="space-y-6">
      <LlmStatusCard />
      <OutboxCard />
      <EventsCard />
      <FraudCard />
      <ReviewModerationCard />
      <ExperimentsCard />
      <RoleCard />
    </div>
  );
}

function LlmStatusCard() {
  const t = useTranslations("admin");
  const { data, error } = useLoader(() => apiFetch<LlmStatus>("/api/llm/status"));
  return (
    <Card title={t("llm.title")} id="llm-status">
      <Status error={error} />
      {data && (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-gray-800 md:grid-cols-4">
          <dt className="font-medium">{t("llm.setting")}</dt>
          <dd>{data.mode}</dd>
          <dt className="font-medium">{t("llm.effectiveMode")}</dt>
          <dd>
            <LlmBadge mode={data.effectiveMode} />
          </dd>
          <dt className="font-medium">{t("llm.model")}</dt>
          <dd>{data.model}</dd>
          <dt className="font-medium">{t("llm.server")}</dt>
          <dd>{data.baseUrlHost || "—"}</dd>
          <dt className="font-medium">{t("llm.hasKey")}</dt>
          <dd>{data.hasKey ? t("llm.yes") : t("llm.no")}</dd>
          <dt className="font-medium">{t("llm.jsonMode")}</dt>
          <dd>
            {data.jsonModeSupported === null
              ? t("llm.unknown")
              : data.jsonModeSupported
                ? t("llm.supported")
                : t("llm.unsupported")}
          </dd>
          <dt className="font-medium">{t("llm.lastError")}</dt>
          <dd className="col-span-1 md:col-span-3">{data.lastError ?? "—"}</dd>
        </dl>
      )}
    </Card>
  );
}

function OutboxCard() {
  const t = useTranslations("admin");
  const f = useFormat();
  const { data, error, reload } = useLoader(() => apiFetch<OutboxState>("/api/admin/outbox"));
  const [feedback, setFeedback] = useState<Feedback>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const markFocus = useRowFocusRecovery(data, "outbox");

  async function requeue(id: string, index: number) {
    setFeedback({});
    setBusyId(id);
    try {
      await apiFetch("/api/admin/outbox", { method: "POST", body: JSON.stringify({ id }) });
      setFeedback({ message: t("outbox.requeued") });
      markFocus(index);
      reload();
    } catch (e) {
      setFeedback({ error: errorMessage(e) });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card title={t("outbox.title")} id="outbox">
      <Status error={error ?? feedback.error} message={feedback.message} />
      {data && (
        <>
          <ul className="flex flex-wrap gap-3 text-sm">
            {Object.entries(data.counts).map(([status, count]) => (
              <li key={status} className="rounded-md bg-gray-100 px-3 py-1 text-gray-900">
                {status}: <strong>{count}</strong>
              </li>
            ))}
            {Object.keys(data.counts).length === 0 && <li>{t("outbox.empty")}</li>}
          </ul>
          <h3 className="mt-4 text-base font-semibold text-gray-900">{t("outbox.deadTitle")}</h3>
          {data.dead.length === 0 ? (
            <p className="text-sm text-gray-700">{t("outbox.deadEmpty")}</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {data.dead.map((m, index) => (
                <li
                  key={m.id}
                  data-row
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
                >
                  <span>
                    <strong>{m.eventType}</strong> · {m.aggregateId} ·{" "}
                    {t("outbox.attempts", { count: m.attempts })} · {f.date(m.createdAt, "short")}
                    {m.lastError && (
                      <span className="block text-xs text-red-800">{m.lastError}</span>
                    )}
                  </span>
                  <Button
                    variant="secondary"
                    busy={busyId === m.id}
                    onClick={() => requeue(m.id, index)}
                  >
                    {t("outbox.requeue")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}

function EventsCard() {
  const t = useTranslations("admin");
  const f = useFormat();
  const { data, error, reload } = useLoader(() => apiFetch<DemandEvent[]>("/api/admin/events"));
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>({});
  const [lastMode, setLastMode] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirm();
  const markFocus = useRowFocusRecovery(data, "events");

  async function propose(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFeedback({});
    try {
      const res = await apiFetch<{ event: DemandEvent; llmMode: string }>("/api/admin/events", {
        method: "POST",
        body: JSON.stringify({ text }),
      });
      setLastMode(res.llmMode);
      setFeedback({ message: t("events.created", { title: res.event.title }) });
      setText("");
      reload();
    } catch (err) {
      setFeedback({ error: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  async function act(ev: DemandEvent, index: number, action: "approve" | "reject" | "rollback") {
    if (action !== "approve") {
      const key = action === "reject" ? "confirmReject" : "confirmRollback";
      const ok = await confirm({
        title: t(`events.${key}.title`, { title: ev.title }),
        body: t(`events.${key}.body`),
        confirmLabel: t(`events.${key}.confirm`),
        tone: "danger",
      });
      if (!ok) return;
    }
    setFeedback({});
    setBusyId(ev.id);
    try {
      await apiFetch(`/api/admin/events/${ev.id}/${action}`, { method: "POST", body: "{}" });
      setFeedback({ message: t("events.applied") });
      markFocus(index);
      reload();
    } catch (err) {
      setFeedback({ error: errorMessage(err) });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card title={t("events.title")} id="events">
      <form onSubmit={propose} className="space-y-2">
        <Field label={t("events.textLabel")} id="event-text" hint={t("events.textHint")}>
          <textarea
            id="event-text"
            rows={3}
            className={inputClass}
            value={text}
            minLength={10}
            maxLength={2000}
            required
            onChange={(e) => setText(e.target.value)}
          />
        </Field>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={busy}>
            {busy ? t("events.extracting") : t("events.create")}
          </Button>
          <LlmBadge mode={lastMode} />
        </div>
      </form>
      <div className="mt-3">
        <Status error={error ?? feedback.error} message={feedback.message} />
      </div>
      {data && data.length === 0 && <p className="text-sm text-gray-700">{t("events.empty")}</p>}
      {data && data.length > 0 && (
        <ul className="mt-2 space-y-2">
          {data.map((ev, index) => (
            <li key={ev.id} data-row className="rounded-md border p-3 text-sm text-gray-900">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <strong>{ev.title}</strong> · {ev.location.city} · {f.date(ev.startsAt, "short")}–
                  {f.date(ev.endsAt, "short")} · {t("events.impact", { impact: ev.impact })} ·{" "}
                  {t(`events.status.${ev.status}`)}
                </span>
                <span className="flex gap-2">
                  {ev.status === "PROPOSED" && (
                    <>
                      <Button busy={busyId === ev.id} onClick={() => act(ev, index, "approve")}>
                        {t("events.approve")}
                      </Button>
                      <Button
                        variant="secondary"
                        busy={busyId === ev.id}
                        onClick={() => act(ev, index, "reject")}
                      >
                        {t("events.reject")}
                      </Button>
                    </>
                  )}
                  {ev.status === "APPROVED" && (
                    <Button
                      variant="danger"
                      busy={busyId === ev.id}
                      onClick={() => act(ev, index, "rollback")}
                    >
                      {t("events.rollback")}
                    </Button>
                  )}
                </span>
              </div>
              {ev.rationale && (
                <p className="mt-1 text-xs text-gray-700">
                  <TrText>{ev.rationale}</TrText>
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {confirmDialog}
    </Card>
  );
}

interface FraudReason {
  code: string;
  points: number | null;
  detail: string;
}

/** Kural isabetlerini (`{rule, points, detail}`) okunur sebep listesine çevirir. */
function fraudReasons(reasons: unknown): FraudReason[] {
  if (!Array.isArray(reasons)) return [];
  return reasons.map((r) => {
    if (typeof r === "string") return { code: r, points: null, detail: "" };
    const o = (r ?? {}) as Record<string, unknown>;
    return {
      code: String(o.rule ?? o.code ?? "?"),
      points: typeof o.points === "number" ? o.points : null,
      detail: typeof o.detail === "string" ? o.detail : "",
    };
  });
}

function FraudCard() {
  const t = useTranslations("admin");
  const { data, error, reload } = useLoader(() => apiFetch<FraudCheck[]>("/api/admin/fraud"));
  const [feedback, setFeedback] = useState<Feedback>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirm();
  const markFocus = useRowFocusRecovery(data, "fraud");

  async function resolve(check: FraudCheck, index: number, resolution: "legit" | "fraud") {
    if (resolution === "fraud") {
      const ok = await confirm({
        title: t("fraud.confirm.title", { booking: check.bookingId }),
        body: t("fraud.confirm.body", { user: check.userId }),
        confirmLabel: t("fraud.confirm.confirm"),
        tone: "danger",
      });
      if (!ok) return;
    }
    setFeedback({});
    setBusyId(check.id);
    try {
      await apiFetch("/api/admin/fraud", {
        method: "POST",
        body: JSON.stringify({ id: check.id, resolution }),
      });
      setFeedback({ message: t("decisionSaved") });
      markFocus(index);
      reload();
    } catch (e) {
      setFeedback({ error: errorMessage(e) });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card title={t("fraud.title")} id="fraud">
      <Status error={error ?? feedback.error} message={feedback.message} />
      {data?.length === 0 && <p className="text-sm text-gray-700">{t("fraud.empty")}</p>}
      {data && data.length > 0 && (
        <ul className="space-y-2">
          {data.map((f, index) => (
            <li
              key={f.id}
              data-row
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
            >
              <span>
                {t("fraud.booking", { id: f.bookingId })} · {t("fraud.user", { id: f.userId })} ·{" "}
                {t("fraud.score")} <strong>{f.score}</strong> · {f.decision}
                <ul
                  className="mt-1 list-disc pl-5 text-xs text-gray-700"
                  aria-label={t("fraud.reasonsLabel")}
                >
                  {fraudReasons(f.reasons).map((r, i) => (
                    <li key={`${r.code}-${i}`}>
                      <code>{r.code}</code>
                      {r.points !== null && ` (+${r.points})`}
                      {r.detail && (
                        <>
                          {" — "}
                          <TrText>{r.detail}</TrText>
                        </>
                      )}
                    </li>
                  ))}
                  {fraudReasons(f.reasons).length === 0 && <li>{t("fraud.noReasons")}</li>}
                </ul>
              </span>
              <span className="flex gap-2">
                <Button
                  variant="secondary"
                  busy={busyId === f.id}
                  onClick={() => resolve(f, index, "legit")}
                >
                  {t("fraud.legit")}
                </Button>
                <Button
                  variant="danger"
                  busy={busyId === f.id}
                  onClick={() => resolve(f, index, "fraud")}
                >
                  {t("fraud.fraud")}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {confirmDialog}
    </Card>
  );
}

interface ModerationItem {
  id: string;
  propertyTitle: string;
  rating: number;
  comment: string | null;
  status: "PENDING_REVIEW" | "HIDDEN";
  reportCount: number;
  reasons: { code: string; detail: string }[];
  explanation: string;
}

/** P1-7 yorum moderasyon kuyruğu: karar yöneticinin; açıklama yalnızca bilgi amaçlı. */
function ReviewModerationCard() {
  const t = useTranslations("admin");
  const { data, error, reload } = useLoader(() => apiFetch<ModerationItem[]>("/api/admin/reviews"));
  const [feedback, setFeedback] = useState<Feedback>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirm();
  const markFocus = useRowFocusRecovery(data, "review-moderation");

  async function decide(item: ModerationItem, index: number, action: "publish" | "remove") {
    if (action === "remove") {
      const ok = await confirm({
        title: t("moderation.confirmRemove.title", { property: item.propertyTitle }),
        body: t("moderation.confirmRemove.body"),
        confirmLabel: t("moderation.confirmRemove.confirm"),
        tone: "danger",
      });
      if (!ok) return;
    }
    setFeedback({});
    setBusyId(item.id);
    try {
      await apiFetch("/api/admin/reviews", {
        method: "POST",
        body: JSON.stringify({ id: item.id, action }),
      });
      setFeedback({ message: t("decisionSaved") });
      markFocus(index);
      reload();
    } catch (e) {
      setFeedback({ error: errorMessage(e) });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card title={t("moderation.title")} id="review-moderation">
      <Status error={error ?? feedback.error} message={feedback.message} />
      {data?.length === 0 && <p className="text-sm text-gray-700">{t("moderation.empty")}</p>}
      {data && data.length > 0 && (
        <ul className="space-y-2">
          {data.map((r, index) => (
            <li key={r.id} data-row className="rounded-md border p-3 text-sm">
              <p>
                <strong>{r.propertyTitle}</strong> · {r.rating}/5 ·{" "}
                {r.status === "HIDDEN" ? t("moderation.hidden") : t("moderation.preReview")} ·{" "}
                {t("moderation.reports", { count: r.reportCount })}
              </p>
              {r.comment && <p className="mt-1 text-gray-800">{r.comment}</p>}
              <p className="mt-1 text-xs text-gray-700">
                {t("moderation.whyFlagged")} <TrText>{r.explanation}</TrText>{" "}
                {r.reasons.map((x) => (
                  <code key={x.code} className="mr-1">
                    {x.code}
                  </code>
                ))}
              </p>
              <span className="mt-2 flex gap-2">
                <Button
                  variant="secondary"
                  busy={busyId === r.id}
                  onClick={() => decide(r, index, "publish")}
                >
                  {t("moderation.publish")}
                </Button>
                <Button
                  variant="danger"
                  busy={busyId === r.id}
                  onClick={() => decide(r, index, "remove")}
                >
                  {t("moderation.remove")}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {confirmDialog}
    </Card>
  );
}

function ExperimentsCard() {
  const t = useTranslations("admin");
  const pct = (v: number) => t("percent", { value: (v * 100).toFixed(1) });
  const { data, error } = useLoader(() => apiFetch<ExperimentResult[]>("/api/admin/experiments"));
  return (
    <Card title={t("experiments.title")} id="experiments">
      <Status error={error} />
      {data?.length === 0 && <p className="text-sm text-gray-700">{t("experiments.empty")}</p>}
      {data?.map((exp) => (
        <div
          key={exp.flagKey}
          className={`overflow-x-auto rounded-md ${focusRing}`}
          tabIndex={0}
          role="region"
          aria-label={t("experiments.tableLabel", { flag: exp.flagKey })}
        >
          <p className="mb-2 text-sm font-medium">
            {exp.flagKey} · {exp.enabled ? t("experiments.on") : t("experiments.off")}
          </p>
          <table className="w-full text-left text-sm">
            <caption className="sr-only">
              {t("experiments.tableLabel", { flag: exp.flagKey })}
            </caption>
            <thead>
              <tr className="border-b">
                <th scope="col" className="py-1 pr-3">
                  {t("experiments.columns.arm")}
                </th>
                <th scope="col" className="py-1 pr-3">
                  {t("experiments.columns.exposures")}
                </th>
                <th scope="col" className="py-1 pr-3">
                  {t("experiments.columns.users")}
                </th>
                <th scope="col" className="py-1 pr-3">
                  {t("experiments.columns.conversions")}
                </th>
                <th scope="col" className="py-1 pr-3">
                  {t("experiments.columns.rate")}
                </th>
                <th scope="col" className="py-1">
                  {t("experiments.columns.ci")}
                </th>
              </tr>
            </thead>
            <tbody>
              {exp.variants.map((v) => (
                <tr key={v.variant} className="border-b last:border-0">
                  <th scope="row" className="py-1 pr-3 font-normal">
                    {v.variant}
                  </th>
                  <td className="py-1 pr-3">{v.exposures}</td>
                  <td className="py-1 pr-3">{v.users}</td>
                  <td className="py-1 pr-3">{v.conversions}</td>
                  <td className="py-1 pr-3">{pct(v.rate)}</td>
                  <td className="py-1">
                    {pct(v.ci.low)} – {pct(v.ci.high)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </Card>
  );
}

const ROLES = ["USER", "HOST", "ADMIN"] as const;
type Role = (typeof ROLES)[number];

function RoleCard() {
  const t = useTranslations("admin");
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<Role>("HOST");
  const [feedback, setFeedback] = useState<Feedback>({});
  const [busy, setBusy] = useState(false);
  const { confirm, confirmDialog } = useConfirm();
  const roleLabel = (r: string) =>
    (ROLES as readonly string[]).includes(r) ? t(`roles.options.${r as Role}`) : r;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const target = userId.trim();
    const ok = await confirm({
      title: t("roles.confirm.title", { user: target }),
      body:
        role === "ADMIN"
          ? t("roles.confirm.adminBody", { role: roleLabel(role) })
          : t("roles.confirm.body", { role: roleLabel(role) }),
      confirmLabel: t("roles.confirm.confirm"),
      tone: role === "ADMIN" ? "danger" : "primary",
    });
    if (!ok) return;
    setFeedback({});
    setBusy(true);
    try {
      const res = await apiFetch<{ id: string; role: string }>(
        `/api/admin/users/${encodeURIComponent(target)}/role`,
        { method: "PATCH", body: JSON.stringify({ role }) }
      );
      setFeedback({ message: t("roles.updated", { role: roleLabel(res.role) }) });
    } catch (err) {
      setFeedback({ error: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={t("roles.title")} id="roles">
      <form onSubmit={submit} className="grid gap-3 md:grid-cols-3">
        <Field label={t("roles.userId")} id="role-user" hint={t("roles.userIdHint")}>
          <input
            id="role-user"
            className={inputClass}
            value={userId}
            required
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            onChange={(e) => setUserId(e.target.value)}
          />
        </Field>
        <Field label={t("roles.newRole")} id="role-value">
          <select
            id="role-value"
            className={inputClass}
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {t(`roles.options.${r}`)}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex items-end">
          <Button type="submit" busy={busy}>
            {busy ? t("roles.submitting") : t("roles.submit")}
          </Button>
        </div>
      </form>
      <div className="mt-2">
        <Status error={feedback.error} message={feedback.message} />
      </div>
      {confirmDialog}
    </Card>
  );
}
