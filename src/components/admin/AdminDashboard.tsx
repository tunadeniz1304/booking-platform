"use client";

import { Fragment, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
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
  inputClass,
  useLoader,
} from "@/components/ui/ui";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { isStaleRecord, useAdminErrorText } from "@/components/admin/admin-error-text";

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

/** Son satır eyleminin sonucu: hangi kayıt (`id`), listedeki sırası ve mesaj. */
interface RowFeedback {
  id: string;
  index: number;
  error?: string;
  message?: string;
}

interface Loaded<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** Son başarılı yüklemenin zamanı. */
  updatedAt: Date | null;
  reload: () => void;
}

/** Uçların sunucu tarafı satır sınırları (`take`/`QUEUE_LIMIT`); API toplam sayı döndürmüyor. */
const SERVER_LIMITS = { fraud: 100, moderation: 50, events: 100, dead: 50 } as const;
const AUTO_REFRESH_MS = 60_000;

/**
 * `useLoader` + son yükleme zamanı. `autoRefresh`: sekme görünür ve çevrimiçiyken veri dakikada
 * bir sessizce yenilenir (başka yöneticinin işlediği kayıtlar kuyruktan düşer).
 */
function useAdminLoader<T>(path: string, autoRefresh = false): Loaded<T> {
  const { data, error, loading, reload } = useLoader(async () => ({
    value: await apiFetch<T>(path),
    at: new Date(),
  }));
  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine !== false) reload();
    }, AUTO_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [autoRefresh, reload]);
  return { data: data?.value ?? null, updatedAt: data?.at ?? null, error, loading, reload };
}

/** Kart verisinin yaşı ve elle yenileme; otomatik yenileme sessizdir (duyurulmaz). */
function RefreshBar({
  loader,
  name,
}: {
  loader: Pick<Loaded<unknown>, "loading" | "updatedAt" | "reload">;
  name: string;
}) {
  const t = useTranslations("admin");
  const f = useFormat();
  return (
    <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-gray-600">
      {loader.updatedAt && (
        <span>{t("refresh.updatedAt", { time: f.time(loader.updatedAt) })}</span>
      )}
      <Button
        variant="secondary"
        busy={loader.loading}
        aria-label={t("rowAction", { action: t("refresh.button"), name })}
        onClick={loader.reload}
      >
        {t("refresh.button")}
      </Button>
    </div>
  );
}

/** Liste sunucu sınırına ulaştıysa görünmeyen kayıtlar olabileceğini söyler. */
function LimitNote({ shown, limit }: { shown: number; limit: number }) {
  const t = useTranslations("admin");
  if (shown < limit) return null;
  return (
    <p className="mb-2 text-sm font-medium text-gray-900">{t("limitNote", { count: limit })}</p>
  );
}

/** Uzun kimlik: kısaltılmış görünür, tam değer `title`da; düğme tam değeri panoya kopyalar. */
function IdText({ id, label }: { id: string; label: (short: string) => string }) {
  const t = useTranslations("admin");
  const [copied, setCopied] = useState(false);
  const short = id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
  async function copy() {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Pano erişimi yok: tam değer `title` ipucunda duruyor.
    }
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span title={id}>{label(short)}</span>
      <button
        type="button"
        onClick={copy}
        aria-label={t("ids.copyLabel", { name: label(short) })}
        className={`rounded text-xs font-semibold text-[#003580] underline ${focusRing}`}
      >
        {copied ? t("ids.copied") : t("ids.copy")}
      </button>
      <span role="status" className="sr-only">
        {copied ? t("ids.copied") : ""}
      </span>
    </span>
  );
}

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

/** Satır kimliğiyle eylem kilidi: aynı kayıtta ikinci istek, ilki bitene kadar gönderilmez. */
function useRowBusy() {
  const [ids, setIds] = useState<ReadonlySet<string>>(() => new Set());
  return {
    isBusy: (id: string) => ids.has(id),
    start: (id: string) => setIds((s) => new Set(s).add(id)),
    end: (id: string) =>
      setIds((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      }),
  };
}

/** Veri gelene kadar kartın boş görünmemesi için yükleniyor notu. */
function LoadingNote({ loading }: { loading: boolean }) {
  const tc = useTranslations("common");
  if (!loading) return null;
  return (
    <p aria-live="polite" className="text-sm text-gray-600">
      {tc("loading")}
    </p>
  );
}

/** Satır eyleminin görünür sonucu; ekran okuyucuya `RowAnnouncer` duyurur. */
function RowNotice({ fb }: { fb: RowFeedback }) {
  return (
    <p className={`mt-1 w-full text-sm ${fb.error ? "text-red-700" : "text-green-800"}`}>
      {fb.error ?? fb.message}
    </p>
  );
}

/** Kart düzeyinde, görünmez canlı bölge: satır eyleminin sonucunu kayıt adıyla duyurur. */
function RowAnnouncer({ fb }: { fb: RowFeedback | null }) {
  return (
    <div className="sr-only">
      <Status error={fb?.error} message={fb?.message} />
    </div>
  );
}

/**
 * Kuyruk listesi: son eylemin sonucu tıklanan satırın içinde gösterilir. Kayıt listeden
 * çıktıysa (karar verildi ya da filtre dışında kaldı) mesaj aynı sıraya yerleşir.
 */
function QueueList<T extends { id: string }>({
  items,
  feedback,
  className = "space-y-2",
  renderRow,
}: {
  items: T[];
  feedback: RowFeedback | null;
  className?: string;
  renderRow: (item: T, index: number, notice: ReactNode) => ReactNode;
}) {
  const orphan = feedback && !items.some((i) => i.id === feedback.id) ? feedback : null;
  if (items.length === 0 && !orphan) return null;
  const at = orphan ? Math.min(orphan.index, items.length) : -1;
  const orphanRow = orphan && (
    <li>
      <RowNotice fb={orphan} />
    </li>
  );
  return (
    <ul className={className}>
      {items.map((item, index) => (
        <Fragment key={item.id}>
          {index === at && orphanRow}
          {renderRow(
            item,
            index,
            feedback && feedback.id === item.id ? <RowNotice fb={feedback} /> : null
          )}
        </Fragment>
      ))}
      {at === items.length && orphanRow}
    </ul>
  );
}

/**
 * Pano: karar bekleyen kuyruklar (dolandırıcılık, moderasyon, olay önerileri, rol) önce,
 * tanılama kartları (outbox, deneyler, LLM) sonra. Üstteki bölüm gezintisi bekleyen iş
 * sayılarını gösterir; sayılar kartlarla aynı yükleyiciden gelir (çift istek yok).
 */
export default function AdminDashboard() {
  const t = useTranslations("admin");
  const fraud = useAdminLoader<FraudCheck[]>("/api/admin/fraud", true);
  const reviews = useAdminLoader<ModerationItem[]>("/api/admin/reviews", true);
  const events = useAdminLoader<DemandEvent[]>("/api/admin/events", true);
  const outbox = useAdminLoader<OutboxState>("/api/admin/outbox", true);
  // Kuyruktaki kullanıcı kimliğinden rol formunu doldurma (her tıklama yeni nesne).
  const [roleTarget, setRoleTarget] = useState<{ id: string } | null>(null);
  function pickUserForRole(id: string) {
    setRoleTarget({ id });
    // Alan yeni değerle çizildikten sonra odaklanır (ekran okuyucu kimliği okusun).
    window.requestAnimationFrame(() => document.getElementById("role-user")?.focus());
  }
  const counted = (label: string, count: number | undefined, key: "pending" | "failed") =>
    count === undefined ? label : t(`nav.${key}`, { label, count });
  const titles = {
    fraud: counted(t("fraud.title"), fraud.data?.length, "pending"),
    moderation: counted(t("moderation.title"), reviews.data?.length, "pending"),
    events: counted(
      t("events.title"),
      events.data?.filter((ev) => ev.status === "PROPOSED").length,
      "pending"
    ),
    outbox: counted(t("outbox.title"), outbox.data?.dead.length, "failed"),
  };
  const sections = [
    { id: "fraud", label: titles.fraud },
    { id: "review-moderation", label: titles.moderation },
    { id: "events", label: titles.events },
    { id: "roles", label: t("roles.title") },
    { id: "outbox", label: titles.outbox },
    { id: "experiments", label: t("experiments.title") },
    { id: "llm-status", label: t("llm.title") },
  ];
  return (
    <div className="space-y-6">
      <nav
        aria-label={t("nav.label")}
        className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
      >
        <ul className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
          {sections.map((s) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                className={`rounded font-semibold text-[#003580] underline ${focusRing}`}
              >
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <FraudCard title={titles.fraud} loader={fraud} onPickUser={pickUserForRole} />
      <ReviewModerationCard title={titles.moderation} loader={reviews} />
      <EventsCard title={titles.events} loader={events} />
      <RoleCard prefill={roleTarget} />
      <OutboxCard title={titles.outbox} loader={outbox} />
      <ExperimentsCard />
      <LlmStatusCard />
    </div>
  );
}

function LlmStatusCard() {
  const t = useTranslations("admin");
  const loader = useAdminLoader<LlmStatus>("/api/llm/status");
  const { data, error } = loader;
  const modeLabel = (m: string) => (t.has(`llm.modes.${m}`) ? t(`llm.modes.${m}`) : m);
  return (
    <Card title={t("llm.title")} id="llm-status">
      <RefreshBar loader={loader} name={t("llm.title")} />
      <Status error={error} />
      <LoadingNote loading={!data && !error} />
      {data && (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-gray-800 md:grid-cols-4">
          <dt className="font-medium">{t("llm.setting")}</dt>
          <dd>{modeLabel(data.mode)}</dd>
          <dt className="font-medium">{t("llm.effectiveMode")}</dt>
          {/* Bir ayar değeri, AI çıktısı değil: "AI tarafından üretildi" rozeti burada yok. */}
          <dd>{modeLabel(data.effectiveMode)}</dd>
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

function OutboxCard({ title, loader }: { title: string; loader: Loaded<OutboxState> }) {
  const t = useTranslations("admin");
  const f = useFormat();
  const errorText = useAdminErrorText();
  const { data, error, reload } = loader;
  const [rowFb, setRowFb] = useState<RowFeedback | null>(null);
  const rowBusy = useRowBusy();
  const markFocus = useRowFocusRecovery(data, "outbox");
  const statusLabel = (s: string) => (t.has(`outbox.status.${s}`) ? t(`outbox.status.${s}`) : s);

  async function requeue(m: OutboxState["dead"][number], index: number) {
    if (rowBusy.isBusy(m.id)) return;
    const name = `${m.eventType} · ${m.aggregateId}`;
    setRowFb(null);
    rowBusy.start(m.id);
    try {
      await apiFetch("/api/admin/outbox", { method: "POST", body: JSON.stringify({ id: m.id }) });
      setRowFb({ id: m.id, index, message: t("outbox.requeuedNamed", { name }) });
      markFocus(index);
      reload();
    } catch (e) {
      const stale = isStaleRecord(e);
      const reason = stale ? t("staleRecord") : errorText(e);
      setRowFb({ id: m.id, index, error: t("rowError", { name, error: reason }) });
      if (stale) {
        markFocus(index);
        reload();
      }
    } finally {
      rowBusy.end(m.id);
    }
  }

  return (
    <Card title={title} id="outbox">
      <RefreshBar loader={loader} name={t("outbox.title")} />
      <Status error={error} />
      <RowAnnouncer fb={rowFb} />
      <LoadingNote loading={!data && !error} />
      {data && (
        <>
          <ul className="flex flex-wrap gap-3 text-sm">
            {Object.entries(data.counts).map(([status, count]) => (
              <li key={status} className="rounded-md bg-gray-100 px-3 py-1 text-gray-900">
                {statusLabel(status)}: <strong>{f.number(count)}</strong>
              </li>
            ))}
            {Object.keys(data.counts).length === 0 && <li>{t("outbox.empty")}</li>}
          </ul>
          <h3 className="mt-4 text-base font-semibold text-gray-900">{t("outbox.deadTitle")}</h3>
          {data.dead.length === 0 && (
            <p className="text-sm text-gray-700">{t("outbox.deadEmpty")}</p>
          )}
          <LimitNote shown={data.dead.length} limit={SERVER_LIMITS.dead} />
          <QueueList
            items={data.dead}
            feedback={rowFb}
            className="mt-2 space-y-2"
            renderRow={(m, index, notice) => (
              <li
                data-row
                aria-busy={rowBusy.isBusy(m.id) || undefined}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
              >
                <span>
                  <strong>{m.eventType}</strong> · {m.aggregateId} ·{" "}
                  {t("outbox.attempts", { count: m.attempts })} · {f.date(m.createdAt, "short")}
                  {m.lastError && <span className="block text-xs text-red-800">{m.lastError}</span>}
                </span>
                <Button
                  variant="secondary"
                  busy={rowBusy.isBusy(m.id)}
                  aria-label={t("rowAction", {
                    action: t("outbox.requeue"),
                    name: `${m.eventType} · ${m.aggregateId}`,
                  })}
                  onClick={() => requeue(m, index)}
                >
                  {t("outbox.requeue")}
                </Button>
                {notice}
              </li>
            )}
          />
        </>
      )}
    </Card>
  );
}

const EVENT_STATUSES = ["PROPOSED", "APPROVED", "REJECTED", "ROLLED_BACK"] as const;
const EVENTS_PAGE_SIZE = 20;
/** Olay metni sınırları (API ile aynı); sayaç sınıra yaklaşınca ekran okuyucuya duyurulur. */
const EVENT_TEXT = { min: 10, max: 2000, announceFrom: 1900 } as const;

/** LLM önerileri `llm:<mod>` kaynağıyla kaydedilir; LLM kaynağı değilse null. */
function llmModeOf(source: string | null): string | null {
  return source?.startsWith("llm:") ? source.slice(4) : null;
}

/**
 * AI çıktısı rozeti: mod biliniyorsa (canlı/demo/yedek) gösterilir; bilinmiyorsa (API öğe
 * başına döndürmüyorsa) modsuz genel "AI tarafından üretildi · doğrulayın" rozeti.
 */
function AiOutputBadge({ mode }: { mode?: string | null }) {
  return mode ? <LlmBadge mode={mode} audience="staff" /> : <LlmBadge mode="unknown" />;
}

/** Olay gerekçesi; LLM çıkarımıysa (başlık, etki, gerekçe) AI rozetiyle işaretlenir. */
function EventRationale({
  rationale,
  source,
}: {
  rationale: string | null;
  source: string | null;
}) {
  const mode = llmModeOf(source);
  if (!rationale && mode === null) return null;
  return (
    <p className="mt-1 text-xs text-gray-700">
      {rationale && (
        <>
          <TrText>{rationale}</TrText>{" "}
        </>
      )}
      {mode !== null && <AiOutputBadge mode={mode} />}
    </p>
  );
}

function EventsCard({ title, loader }: { title: string; loader: Loaded<DemandEvent[]> }) {
  const t = useTranslations("admin");
  const f = useFormat();
  const locale = useLocale();
  const errorText = useAdminErrorText();
  const { data, error, reload } = loader;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>({});
  const [rowFb, setRowFb] = useState<RowFeedback | null>(null);
  const [lastMode, setLastMode] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<DemandEvent["status"]>("PROPOSED");
  const [city, setCity] = useState("");
  const [limit, setLimit] = useState(EVENTS_PAGE_SIZE);
  const rowBusy = useRowBusy();
  const { confirm, confirmDialog } = useConfirm();
  const markFocus = useRowFocusRecovery(data, "events");

  const all = data ?? [];
  const cities = [...new Set(all.map((ev) => ev.location.city))].sort((a, b) =>
    a.localeCompare(b, locale)
  );
  const inCity = all.filter((ev) => !city || ev.location.city === city);
  const matching = inCity
    .filter((ev) => ev.status === statusFilter)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const visible = matching.slice(0, limit);
  const textCount = t("events.textCount", { count: text.length, max: EVENT_TEXT.max });
  const categoryLabel = (c: string) =>
    t.has(`events.categories.${c}`) ? t(`events.categories.${c}`) : c;
  // LLM dışındaki kaynaklar olduğu gibi gösterilir.
  const sourceLabel = (s: string) => {
    const mode = llmModeOf(s);
    if (mode === null) return s;
    return t("events.sources.llm", {
      mode: t.has(`llm.modes.${mode}`) ? t(`llm.modes.${mode}`) : mode,
    });
  };

  function changeFilter(next: { status?: DemandEvent["status"]; city?: string }) {
    if (next.status) setStatusFilter(next.status);
    if (next.city !== undefined) setCity(next.city);
    setLimit(EVENTS_PAGE_SIZE);
    setRowFb(null);
  }

  async function propose(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
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
      changeFilter({ status: "PROPOSED", city: "" });
      reload();
    } catch (err) {
      setFeedback({ error: errorText(err) });
    } finally {
      setBusy(false);
    }
  }

  async function act(ev: DemandEvent, index: number, action: "approve" | "reject" | "rollback") {
    if (rowBusy.isBusy(ev.id)) return;
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
    setRowFb(null);
    rowBusy.start(ev.id);
    try {
      const res = await apiFetch<{ repriced?: number }>(`/api/admin/events/${ev.id}/${action}`, {
        method: "POST",
        body: "{}",
      });
      // Onay/geri alma yanıtı yeniden fiyatlanan gece sayısını döndürür.
      const message =
        action !== "reject" && typeof res?.repriced === "number"
          ? t(`events.doneRepriced.${action}`, { title: ev.title, count: res.repriced })
          : t(`events.done.${action}`, { title: ev.title });
      setRowFb({ id: ev.id, index, message });
      markFocus(index);
      reload();
    } catch (err) {
      const stale = isStaleRecord(err);
      setRowFb({
        id: ev.id,
        index,
        error: t("rowError", {
          name: ev.title,
          error: stale ? t("staleRecord") : errorText(err),
        }),
      });
      if (stale) {
        markFocus(index);
        reload();
      }
    } finally {
      rowBusy.end(ev.id);
    }
  }

  return (
    <Card title={title} id="events">
      <RefreshBar loader={loader} name={t("events.title")} />
      <form onSubmit={propose} className="space-y-2">
        <Field
          label={t("events.textLabel")}
          id="event-text"
          hint={t("events.textHint", { min: EVENT_TEXT.min, max: EVENT_TEXT.max })}
        >
          <textarea
            id="event-text"
            rows={3}
            className={inputClass}
            value={text}
            minLength={EVENT_TEXT.min}
            maxLength={EVENT_TEXT.max}
            required
            onChange={(e) => setText(e.target.value)}
          />
        </Field>
        <p aria-hidden="true" className="text-xs text-gray-600">
          {textCount}
        </p>
        <p role="status" className="sr-only">
          {text.length >= EVENT_TEXT.announceFrom ? textCount : ""}
        </p>
        <div className="flex items-center gap-3">
          <Button type="submit" busy={busy}>
            {busy ? t("events.extracting") : t("events.create")}
          </Button>
          <LlmBadge mode={lastMode} audience="staff" />
        </div>
      </form>
      <div className="mt-3">
        <Status error={error ?? feedback.error} message={feedback.message} />
      </div>
      <RowAnnouncer fb={rowFb} />
      <LoadingNote loading={!data && !error} />
      {data && data.length === 0 && <p className="text-sm text-gray-700">{t("events.empty")}</p>}
      {data && data.length > 0 && (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <div
              role="group"
              aria-label={t("events.filter.label")}
              className="flex flex-wrap gap-2"
            >
              {EVENT_STATUSES.map((s) => (
                <Button
                  key={s}
                  variant={statusFilter === s ? "primary" : "secondary"}
                  aria-pressed={statusFilter === s}
                  onClick={() => changeFilter({ status: s })}
                >
                  {t("events.filter.option", {
                    label: t(`events.status.${s}`),
                    count: inCity.filter((ev) => ev.status === s).length,
                  })}
                </Button>
              ))}
            </div>
            {cities.length > 1 && (
              <div className="w-48">
                <Field label={t("events.cityLabel")} id="event-city">
                  <select
                    id="event-city"
                    className={inputClass}
                    value={city}
                    onChange={(e) => changeFilter({ city: e.target.value })}
                  >
                    <option value="">{t("events.allCities")}</option>
                    {cities.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            )}
          </div>
          <p className="mt-2 text-xs text-gray-600">{t("events.sortedNote")}</p>
          <LimitNote shown={data.length} limit={SERVER_LIMITS.events} />
          {matching.length === 0 && (
            <p className="mt-2 text-sm text-gray-700">{t("events.emptyFiltered")}</p>
          )}
          <QueueList
            items={visible}
            feedback={rowFb}
            className="mt-2 space-y-2"
            renderRow={(ev, index, notice) => (
              <li
                data-row
                aria-busy={rowBusy.isBusy(ev.id) || undefined}
                className="rounded-md border p-3 text-sm text-gray-900"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    <strong>{ev.title}</strong> · {ev.location.city} ·{" "}
                    {f.date(ev.startsAt, "short")}–{f.date(ev.endsAt, "short")} ·{" "}
                    {t("events.impact", { impact: ev.impact })}
                    {ev.category && <> · {categoryLabel(ev.category)}</>} ·{" "}
                    {t(`events.status.${ev.status}`)}
                  </span>
                  <span className="flex gap-2">
                    {ev.status === "PROPOSED" && (
                      <>
                        <Button
                          busy={rowBusy.isBusy(ev.id)}
                          aria-label={t("rowAction", {
                            action: t("events.approve"),
                            name: ev.title,
                          })}
                          aria-describedby={`event-${ev.id}-effect`}
                          onClick={() => act(ev, index, "approve")}
                        >
                          {t("events.approve")}
                        </Button>
                        <Button
                          variant="secondary"
                          busy={rowBusy.isBusy(ev.id)}
                          aria-label={t("rowAction", {
                            action: t("events.reject"),
                            name: ev.title,
                          })}
                          onClick={() => act(ev, index, "reject")}
                        >
                          {t("events.reject")}
                        </Button>
                      </>
                    )}
                    {ev.status === "APPROVED" && (
                      <Button
                        variant="danger"
                        busy={rowBusy.isBusy(ev.id)}
                        aria-label={t("rowAction", {
                          action: t("events.rollback"),
                          name: ev.title,
                        })}
                        onClick={() => act(ev, index, "rollback")}
                      >
                        {t("events.rollback")}
                      </Button>
                    )}
                  </span>
                </div>
                {ev.status === "PROPOSED" && (
                  <p id={`event-${ev.id}-effect`} className="mt-1 text-xs text-gray-700">
                    {t("events.approveEffect", {
                      city: ev.location.city,
                      start: f.date(ev.startsAt, "short"),
                      end: f.date(ev.endsAt, "short"),
                    })}
                  </p>
                )}
                <EventRationale rationale={ev.rationale} source={ev.source} />
                {ev.source && (
                  <p className="mt-1 text-xs text-gray-600">
                    {t("events.sourceLabel", { source: sourceLabel(ev.source) })}
                  </p>
                )}
                {notice}
              </li>
            )}
          />
          {matching.length > visible.length && (
            <Button
              variant="secondary"
              className="mt-3"
              onClick={() => setLimit((l) => l + EVENTS_PAGE_SIZE)}
            >
              {t("events.showMore", { count: matching.length - visible.length })}
            </Button>
          )}
        </>
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

function FraudCard({
  title,
  loader,
  onPickUser,
}: {
  title: string;
  loader: Loaded<FraudCheck[]>;
  onPickUser?: (userId: string) => void;
}) {
  const t = useTranslations("admin");
  const fmt = useFormat();
  const errorText = useAdminErrorText();
  const { data, error, reload } = loader;
  const [rowFb, setRowFb] = useState<RowFeedback | null>(null);
  const rowBusy = useRowBusy();
  const { confirm, confirmDialog } = useConfirm();
  const markFocus = useRowFocusRecovery(data, "fraud");
  const label = (group: "decisions" | "rules", code: string) =>
    t.has(`fraud.${group}.${code}`) ? t(`fraud.${group}.${code}`) : code;

  async function resolve(check: FraudCheck, index: number, resolution: "legit" | "fraud") {
    if (rowBusy.isBusy(check.id)) return;
    if (resolution === "fraud") {
      const ok = await confirm({
        title: t("fraud.confirm.title", { booking: check.bookingId }),
        body: t("fraud.confirm.body", { user: check.userId }),
        confirmLabel: t("fraud.confirm.confirm"),
        tone: "danger",
      });
      if (!ok) return;
    }
    const name = t("fraud.booking", { id: check.bookingId });
    setRowFb(null);
    rowBusy.start(check.id);
    try {
      await apiFetch("/api/admin/fraud", {
        method: "POST",
        body: JSON.stringify({ id: check.id, resolution }),
      });
      setRowFb({ id: check.id, index, message: t(`fraud.done.${resolution}`, { booking: name }) });
      markFocus(index);
      reload();
    } catch (e) {
      const stale = isStaleRecord(e);
      const reason = stale ? t("staleRecord") : errorText(e);
      setRowFb({ id: check.id, index, error: t("rowError", { name, error: reason }) });
      if (stale) {
        markFocus(index);
        reload();
      }
    } finally {
      rowBusy.end(check.id);
    }
  }

  return (
    <Card title={title} id="fraud">
      <RefreshBar loader={loader} name={t("fraud.title")} />
      <p className="mb-3 text-xs text-gray-700">{t("fraud.effectHint")}</p>
      <Status error={error} />
      <RowAnnouncer fb={rowFb} />
      <LoadingNote loading={!data && !error} />
      {data?.length === 0 && <p className="text-sm text-gray-700">{t("fraud.empty")}</p>}
      {data && <LimitNote shown={data.length} limit={SERVER_LIMITS.fraud} />}
      {data && (
        <QueueList
          items={data}
          feedback={rowFb}
          renderRow={(f, index, notice) => {
            const booking = t("fraud.booking", { id: f.bookingId });
            const reasons = fraudReasons(f.reasons);
            return (
              <li
                data-row
                aria-busy={rowBusy.isBusy(f.id) || undefined}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
              >
                <div className="min-w-0">
                  <IdText id={f.bookingId} label={(id) => t("fraud.booking", { id })} /> ·{" "}
                  <IdText id={f.userId} label={(id) => t("fraud.user", { id })} />
                  {onPickUser && (
                    <>
                      {" "}
                      <button
                        type="button"
                        onClick={() => onPickUser(f.userId)}
                        aria-label={t("rowAction", {
                          action: t("fraud.changeRole"),
                          name: t("fraud.user", { id: f.userId }),
                        })}
                        className={`rounded text-xs font-semibold text-[#003580] underline ${focusRing}`}
                      >
                        {t("fraud.changeRole")}
                      </button>
                    </>
                  )}{" "}
                  · {fmt.dateTime(f.createdAt)} · {t("fraud.score")}{" "}
                  <strong>{t("fraud.scoreValue", { score: f.score })}</strong> ·{" "}
                  <strong>{label("decisions", f.decision)}</strong>
                  <ul
                    className="mt-1 list-disc pl-5 text-xs text-gray-700"
                    aria-label={t("fraud.reasonsLabel")}
                  >
                    {reasons.map((r, i) => (
                      <li key={`${r.code}-${i}`}>
                        {label("rules", r.code)}
                        {r.points !== null && ` (${t("fraud.points", { points: r.points })})`}
                        {r.detail && (
                          <>
                            {" — "}
                            <TrText>{r.detail}</TrText>
                          </>
                        )}
                      </li>
                    ))}
                    {reasons.length === 0 && <li>{t("fraud.noReasons")}</li>}
                  </ul>
                </div>
                <span className="flex gap-2">
                  <Button
                    variant="secondary"
                    busy={rowBusy.isBusy(f.id)}
                    aria-label={t("rowAction", { action: t("fraud.legit"), name: booking })}
                    onClick={() => resolve(f, index, "legit")}
                  >
                    {t("fraud.legit")}
                  </Button>
                  <Button
                    variant="danger"
                    busy={rowBusy.isBusy(f.id)}
                    aria-label={t("rowAction", { action: t("fraud.fraud"), name: booking })}
                    onClick={() => resolve(f, index, "fraud")}
                  >
                    {t("fraud.fraud")}
                  </Button>
                </span>
                {notice}
              </li>
            );
          }}
        />
      )}
      {confirmDialog}
    </Card>
  );
}

interface ModerationItem {
  id: string;
  propertyId: string;
  createdAt: string;
  propertyTitle: string;
  rating: number;
  comment: string | null;
  status: "PENDING_REVIEW" | "HIDDEN";
  reportCount: number;
  reasons: { code: string; detail: string }[];
  /** LLM açıklaması (`ai_generated`); demo/hata durumunda deterministik metin. */
  explanation: string;
  /** Açıklamanın üretim modu; API henüz döndürmüyor (yoksa modsuz AI rozeti). */
  llmMode?: string | null;
}

/** P1-7 yorum moderasyon kuyruğu: karar yöneticinin; açıklama yalnızca bilgi amaçlı. */
function ReviewModerationCard({
  title,
  loader,
}: {
  title: string;
  loader: Loaded<ModerationItem[]>;
}) {
  const t = useTranslations("admin");
  const f = useFormat();
  const errorText = useAdminErrorText();
  const { data, error, reload } = loader;
  const [rowFb, setRowFb] = useState<RowFeedback | null>(null);
  const rowBusy = useRowBusy();
  const { confirm, confirmDialog } = useConfirm();
  const markFocus = useRowFocusRecovery(data, "review-moderation");
  const codeLabel = (code: string) =>
    t.has(`moderation.codes.${code}`) ? t(`moderation.codes.${code}`) : code;

  async function decide(item: ModerationItem, index: number, action: "publish" | "remove") {
    if (rowBusy.isBusy(item.id)) return;
    if (action === "remove") {
      const ok = await confirm({
        title: t("moderation.confirmRemove.title", { property: item.propertyTitle }),
        body: t("moderation.confirmRemove.body"),
        confirmLabel: t("moderation.confirmRemove.confirm"),
        tone: "danger",
      });
      if (!ok) return;
    }
    const name = t("moderation.reviewOf", { property: item.propertyTitle });
    setRowFb(null);
    rowBusy.start(item.id);
    try {
      await apiFetch("/api/admin/reviews", {
        method: "POST",
        body: JSON.stringify({ id: item.id, action }),
      });
      setRowFb({
        id: item.id,
        index,
        message: t(`moderation.done.${action}`, { property: item.propertyTitle }),
      });
      markFocus(index);
      reload();
    } catch (e) {
      const stale = isStaleRecord(e);
      const reason = stale ? t("staleRecord") : errorText(e);
      setRowFb({ id: item.id, index, error: t("rowError", { name, error: reason }) });
      if (stale) {
        markFocus(index);
        reload();
      }
    } finally {
      rowBusy.end(item.id);
    }
  }

  return (
    <Card title={title} id="review-moderation">
      <RefreshBar loader={loader} name={t("moderation.title")} />
      <Status error={error} />
      <RowAnnouncer fb={rowFb} />
      <LoadingNote loading={!data && !error} />
      {data?.length === 0 && <p className="text-sm text-gray-700">{t("moderation.empty")}</p>}
      {data && <LimitNote shown={data.length} limit={SERVER_LIMITS.moderation} />}
      {data && (
        <QueueList
          items={data}
          feedback={rowFb}
          renderRow={(r, index, notice) => {
            const name = t("moderation.reviewOf", { property: r.propertyTitle });
            return (
              <li
                data-row
                aria-busy={rowBusy.isBusy(r.id) || undefined}
                className="rounded-md border p-3 text-sm"
              >
                <p>
                  <Link
                    href={`/property/${r.propertyId}`}
                    className={`rounded font-semibold text-[#003580] underline ${focusRing}`}
                  >
                    {r.propertyTitle}
                  </Link>{" "}
                  · {r.rating}/5 ·{" "}
                  {r.status === "HIDDEN" ? t("moderation.hidden") : t("moderation.preReview")} ·{" "}
                  {t("moderation.reports", { count: r.reportCount })} ·{" "}
                  {t("moderation.writtenAt", { date: f.date(r.createdAt, "short") })}
                </p>
                {r.comment && <p className="mt-1 text-gray-800">{r.comment}</p>}
                <p className="mt-1 text-xs text-gray-700">
                  {t("moderation.whyFlagged")} <TrText>{r.explanation}</TrText>{" "}
                  <AiOutputBadge mode={r.llmMode} />{" "}
                  {r.reasons.map((x) => (
                    <span key={x.code} className="mr-1 rounded bg-gray-100 px-1.5 py-0.5">
                      {codeLabel(x.code)}
                    </span>
                  ))}
                </p>
                <div className="mt-2 flex gap-2">
                  <Button
                    variant="secondary"
                    busy={rowBusy.isBusy(r.id)}
                    aria-label={t("rowAction", { action: t("moderation.publish"), name })}
                    onClick={() => decide(r, index, "publish")}
                  >
                    {t("moderation.publish")}
                  </Button>
                  <Button
                    variant="danger"
                    busy={rowBusy.isBusy(r.id)}
                    aria-label={t("rowAction", { action: t("moderation.remove"), name })}
                    onClick={() => decide(r, index, "remove")}
                  >
                    {t("moderation.remove")}
                  </Button>
                </div>
                {notice}
              </li>
            );
          }}
        />
      )}
      {confirmDialog}
    </Card>
  );
}

function ExperimentsCard() {
  const t = useTranslations("admin");
  const f = useFormat();
  // Yerel biçim: TR "%12,3", EN "12.3%"; sayımlar binlik ayırıcıyla.
  const pct = (v: number) =>
    f.number(v, { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const loader = useAdminLoader<ExperimentResult[]>("/api/admin/experiments");
  const { data, error } = loader;
  return (
    <Card title={t("experiments.title")} id="experiments">
      <RefreshBar loader={loader} name={t("experiments.title")} />
      <Status error={error} />
      <LoadingNote loading={!data && !error} />
      {data?.length === 0 && <p className="text-sm text-gray-700">{t("experiments.empty")}</p>}
      {data?.map((exp) => (
        <div
          key={exp.flagKey}
          className={`overflow-x-auto rounded-md ${focusRing}`}
          tabIndex={0}
          role="region"
          aria-label={t("experiments.tableLabel", { flag: exp.flagKey })}
        >
          <table className="w-full text-left text-sm">
            {/* Görünür başlık tablonun adı: ekran okuyucu tablo listesinde ayırt edilir. */}
            <caption className="mb-2 text-left text-sm font-medium">
              {exp.flagKey} · {exp.enabled ? t("experiments.on") : t("experiments.off")}
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
                  <td className="py-1 pr-3">{f.number(v.exposures)}</td>
                  <td className="py-1 pr-3">{f.number(v.users)}</td>
                  <td className="py-1 pr-3">{f.number(v.conversions)}</td>
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

function RoleCard({ prefill = null }: { prefill?: { id: string } | null }) {
  const t = useTranslations("admin");
  const errorText = useAdminErrorText();
  const [userId, setUserId] = useState("");
  // Kuyruktaki "Rolü değiştir" kısayolu: yeni `prefill` nesnesi kimlik alanını doldurur.
  const [seenPrefill, setSeenPrefill] = useState(prefill);
  if (prefill !== seenPrefill) {
    setSeenPrefill(prefill);
    if (prefill) setUserId(prefill.id);
  }
  // Varsayılan rol yok: yönetici rolü bilinçli olarak seçmeli.
  const [role, setRole] = useState<Role | "">("");
  const [feedback, setFeedback] = useState<Feedback>({});
  const [busy, setBusy] = useState(false);
  const { confirm, confirmDialog } = useConfirm();
  const roleLabel = (r: string) =>
    (ROLES as readonly string[]).includes(r) ? t(`roles.options.${r as Role}`) : r;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !role) return;
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
      const res = await apiFetch<{ id: string; role: string; previousRole?: string }>(
        `/api/admin/users/${encodeURIComponent(target)}/role`,
        { method: "PATCH", body: JSON.stringify({ role }) }
      );
      setFeedback({
        message: res.previousRole
          ? t("roles.updatedFromTo", {
              user: res.id,
              from: roleLabel(res.previousRole),
              to: roleLabel(res.role),
            })
          : t("roles.updatedFor", { user: res.id, role: roleLabel(res.role) }),
      });
      setUserId("");
      setRole("");
    } catch (err) {
      setFeedback({
        error: errorText(err, {
          NOT_FOUND: t("roles.errors.notFound"),
          FORBIDDEN: t("roles.errors.forbidden"),
        }),
      });
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
            required
            onChange={(e) => setRole(e.target.value as Role | "")}
          >
            <option value="">{t("roles.choose")}</option>
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
