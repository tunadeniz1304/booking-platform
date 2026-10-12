"use client";

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from "react";
import { useTranslations } from "next-intl";
import { ApiError, apiFetch } from "@/lib/api-client";
import { useFormat } from "@/i18n/use-format";
import {
  Button,
  Card,
  Field,
  RequiredLegend,
  Status,
  focusFirstInvalid,
  focusRing,
  inputClass,
  useErrorText,
  useLoader,
} from "@/components/ui/ui";
import { useConfirm } from "@/components/ui/ConfirmDialog";

interface Takedown {
  id: string;
  source: string;
  referenceNo: string | null;
  propertyId: string;
  /** Sunucu ilan başlığını eklerse gösterilir; yoksa yalnız kimlik. */
  property?: { title: string } | null;
  status: "RECEIVED" | "ACTIONED" | "CLOSED";
  receivedAt: string;
  slaDueAt: string;
  slaBreachedAt: string | null;
}
interface NoticeRow {
  id: string;
  contentUrl: string;
  category: string;
  explanation: string;
  /** Bildirim bir ilana bağlı değilse `null`: kaldırma kararı uygulanamaz. */
  propertyId: string | null;
  reporterName: string | null;
  createdAt: string;
  /** Sunucu ilan başlığını eklerse gösterilir; yoksa yalnız kimlik. */
  property?: { title: string } | null;
}
/** Karar taslağı: içerik yeni sekmede incelenirken ya da sayfa yenilenince kaybolmaz. */
type NoticeDraft = { facts: string; legalReference: string };
type Result = { error?: string; message?: string };
type RunOutcome = { ok: true } | { ok: false; error: unknown };
type PropertyPreview =
  | { state: "loading" }
  | { state: "found"; title: string; city: string | null }
  | { state: "missing" };
type TakedownFilter = "open" | "closed" | "all";
/** Rapor dönemi; `to` bitiş günüdür (dahil), ikisi de YYYY-MM-DD (UTC). */
type Period = { from: string; to: string };
type ReportPreset = "thisYear" | "lastYear" | "last6Months";

const TAKEDOWN_FILTERS: TakedownFilter[] = ["open", "closed", "all"];
const REPORT_PRESETS: ReportPreset[] = ["thisYear", "lastYear", "last6Months"];

/** 7565 süreleri Türkiye saatine göre izlenir; TSİ 2016'dan beri yaz saatsiz, sabit UTC+3. */
const TR_TIME_ZONE = "Europe/Istanbul";
const TR_OFFSET_MS = 3 * 3_600_000;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
/** SLA bitişine bu süreden az kaldıysa metinle uyarılır (yalnız renk değil). */
const SLA_WARNING_MS = 4 * HOUR_MS;

/** Sunucu şemalarındaki üst sınırlar (takedown.ts, dsa.ts). */
const MAX = {
  propertyId: 64,
  referenceNo: 120,
  reason: 2000,
  resolution: 2000,
  facts: 5000,
  legalReference: 300,
} as const;

const NOTICE_DRAFT_PREFIX = "compliance.noticeDraft.";

function readNoticeDraft(id: string): NoticeDraft {
  try {
    const raw = window.sessionStorage.getItem(NOTICE_DRAFT_PREFIX + id);
    const d = raw ? (JSON.parse(raw) as Partial<NoticeDraft> | null) : null;
    return {
      facts: typeof d?.facts === "string" ? d.facts : "",
      legalReference: typeof d?.legalReference === "string" ? d.legalReference : "",
    };
  } catch {
    return { facts: "", legalReference: "" };
  }
}

/** Taslağı sekme oturumunda saklar; boş ya da `null` ise siler. */
function writeNoticeDraft(id: string, draft: NoticeDraft | null) {
  try {
    const key = NOTICE_DRAFT_PREFIX + id;
    if (draft && (draft.facts || draft.legalReference)) {
      window.sessionStorage.setItem(key, JSON.stringify(draft));
    } else {
      window.sessionStorage.removeItem(key);
    }
  } catch {
    // Depolama kapalıysa taslak yalnız bellekte kalır.
  }
}

/** Sınırın %90'ında ve sınırda bir kez duyurulur (her tuş vuruşunda değil). */
function CharLimitStatus({ length, max }: { length: number; max: number }) {
  const t = useTranslations("compliance.admin.fieldLimits");
  const text = length >= max ? t("reached") : length >= max * 0.9 ? t("near") : "";
  return (
    <p aria-live="polite" className="sr-only">
      {text}
    </p>
  );
}

/** `datetime-local` değeri (TSİ) olarak verilen an. */
function trInputValue(d: Date): string {
  return new Date(d.getTime() + TR_OFFSET_MS).toISOString().slice(0, 16);
}

/** TSİ `datetime-local` değerini ISO zamana çevirir; boş/geçersizse `undefined`. */
function trInputToIso(value: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(`${value.length === 16 ? `${value}:00` : value}+03:00`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** Alınma alanını şimdiye (TSİ) çeker; yönetici değeri değiştirdiyse yalnız üst sınırı yeniler. */
function syncReceivedAt(el: HTMLInputElement | null, edited: boolean) {
  if (!el) return;
  const now = trInputValue(new Date());
  el.max = now;
  if (!edited) el.value = now;
}

/** YYYY-MM-DD gününün ertesi günü (rapor API'sinde `to` hariçtir). */
function nextDay(day: string): string {
  return new Date(Date.parse(day) + DAY_MS).toISOString().slice(0, 10);
}

function presetPeriod(key: ReportPreset, now: Date): Period {
  const year = now.getUTCFullYear();
  const today = now.toISOString().slice(0, 10);
  if (key === "lastYear") return { from: `${year - 1}-01-01`, to: `${year - 1}-12-31` };
  if (key === "last6Months") {
    const start = new Date(Date.UTC(year, now.getUTCMonth() - 6, now.getUTCDate()));
    return { from: start.toISOString().slice(0, 10), to: today };
  }
  return { from: `${year}-01-01`, to: today };
}

/** Kalan süre için dakikada bir yenilenen saat (sunucuda 0). */
function subscribeClock(onChange: () => void) {
  const id = window.setInterval(onChange, 30_000);
  return () => window.clearInterval(id);
}
const clockSnapshot = () => Math.floor(Date.now() / 60_000) * 60_000;
const serverClock = () => 0;

const errorCode = (error: unknown) => (error instanceof ApiError ? error.code : undefined);

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

/**
 * `noValidate` formlarda tarayıcı balonu yerine: boş zorunlu alan, (kırpılmış) en az uzunluk
 * altı ya da geçersiz/aralık dışı tarih içeren alan adları, formdaki sırayla.
 */
function clientInvalidFields(form: HTMLFormElement): string[] {
  const names: string[] = [];
  for (const el of Array.from(form.elements)) {
    if (
      !(
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement
      ) ||
      !el.name ||
      el.disabled
    ) {
      continue;
    }
    const value = el.value.trim();
    const minLength = el instanceof HTMLSelectElement ? 0 : el.minLength;
    const invalid =
      (el.required && !value) ||
      (value.length > 0 && minLength > 0 && value.length < minLength) ||
      el.validity.badInput ||
      el.validity.rangeOverflow ||
      el.validity.rangeUnderflow;
    if (invalid && !names.includes(el.name)) names.push(el.name);
  }
  return names;
}

const fetchTakedowns = (status?: Takedown["status"]) =>
  apiFetch<{ takedowns: Takedown[] }>(
    `/api/admin/takedowns${status ? `?status=${status}` : ""}`
  ).then((r) => r.takedowns);

/** Açık talepler SLA bitişine göre (en acil önce), kapalılar sunucu sırasıyla (en yeni önce). */
async function loadTakedowns(filter: TakedownFilter): Promise<Takedown[]> {
  if (filter === "closed") return fetchTakedowns("CLOSED");
  const rows =
    filter === "open"
      ? (await Promise.all([fetchTakedowns("RECEIVED"), fetchTakedowns("ACTIONED")])).flat()
      : await fetchTakedowns();
  const open = rows
    .filter((r) => r.status !== "CLOSED")
    .sort((a, b) => a.slaDueAt.localeCompare(b.slaDueAt));
  return [...open, ...rows.filter((r) => r.status === "CLOSED")];
}

/** Kaldırılan öğeden sonra odağı listedeki komşu öğeye (yoksa liste başlığına) taşır. */
function focusById(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
  el.focus();
}

/**
 * Minimal uyum paneli (ADMIN): kaldırma talebi kaydı/kapatma, DSA kararı, rapor export.
 * `afterNotices`: bildirimlerle şeffaflık raporu arasına konan bölümler (ör. itiraz kuyrukları).
 */
export default function ComplianceDashboard({ afterNotices }: { afterNotices?: ReactNode } = {}) {
  const t = useTranslations("compliance.admin");
  const tr = useTranslations("compliance.report");
  const tc = useTranslations("common");
  const fmt = useFormat();
  const errorText = useErrorText();
  const { confirm, confirmDialog } = useConfirm();
  const [results, setResults] = useState<Record<string, Result>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, Record<string, string>>>({});
  const [pending, setPending] = useState<string | null>(null);
  const pendingRef = useRef<string | null>(null);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<PropertyPreview | null>(null);
  const [drafts, setDrafts] = useState<Record<string, NoticeDraft>>({});
  const [reasonLength, setReasonLength] = useState(0);
  const [resolutionLength, setResolutionLength] = useState(0);
  const [takedownFilter, setTakedownFilter] = useState<TakedownFilter>("open");
  const [reportNow] = useState(() => new Date());
  const [period, setPeriod] = useState<Period>(() => presetPeriod("thisYear", reportNow));
  const focusAfterReload = useRef<string | null>(null);
  const receivedRef = useRef<HTMLInputElement>(null);
  const lookupRef = useRef<{ id: string; result: Promise<PropertyPreview | null> } | null>(null);
  const receivedEdited = useRef(false);
  const nowMs = useSyncExternalStore(subscribeClock, clockSnapshot, serverClock);
  const takedowns = useLoader(
    () => loadTakedowns(takedownFilter).then((rows) => ({ filter: takedownFilter, rows })),
    [takedownFilter]
  );
  // En uzun süredir bekleyen önce (DSA: gecikmeksizin işlem).
  const notices = useLoader(() =>
    apiFetch<{ notices: NoticeRow[] }>("/api/admin/notices?status=RECEIVED").then((r) =>
      [...r.notices].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    )
  );
  // Filtre değişince önceki filtrenin satırları gösterilmez (yükleniyor durumu).
  const takedownRows = takedowns.data?.filter === takedownFilter ? takedowns.data.rows : null;

  useEffect(() => {
    const target = focusAfterReload.current;
    if (!target) return;
    focusAfterReload.current = null;
    focusById(target);
  }, [notices.data, takedowns.data]);

  useEffect(() => syncReceivedAt(receivedRef.current, false), []);

  const setResult = (key: string, r: Result) => setResults((prev) => ({ ...prev, [key]: r }));
  const fieldError = (key: string, name: string) => fieldErrors[key]?.[name];

  /** Tek eylem aynı anda: istek sürerken ikinci gönderim yok sayılır (`null`, çift kayıt yok). */
  const run = async (key: string, fn: () => Promise<unknown>): Promise<RunOutcome | null> => {
    if (pendingRef.current) return null;
    pendingRef.current = key;
    setPending(key);
    setResult(key, {});
    setFieldErrors((prev) => ({ ...prev, [key]: {} }));
    try {
      await fn();
      return { ok: true };
    } catch (error) {
      return { ok: false, error };
    } finally {
      pendingRef.current = null;
      setPending(null);
    }
  };

  /** Hatalı alanları ilgili `Field` altında gösterir, özet hatayı yazar ve ilk alana odaklanır. */
  const markInvalid = (key: string, names: string[], form: HTMLFormElement) => {
    const fields: Record<string, string> = {};
    for (const name of names) {
      fields[name] = t.has(`errors.fields.${name}`)
        ? t(`errors.fields.${name}`)
        : t("errors.fields.other");
    }
    setFieldErrors((prev) => ({ ...prev, [key]: fields }));
    setResult(key, { error: t("errors.validation") });
    focusFirstInvalid(form);
  };

  /** Sunucu hatasını arayüz dilinde gösterir; doğrulama hatalarını ilgili alanlara dağıtır. */
  const showError = (key: string, error: unknown, form: HTMLFormElement) => {
    const names = invalidFields(error);
    if (names.length === 0) {
      setResult(key, { error: errorText(error) });
      return;
    }
    markInvalid(key, names, form);
  };

  /** İstemci denetimi (onay penceresinden önce); geçerse önceki hatalar temizlenir. */
  const validate = (key: string, form: HTMLFormElement) => {
    const names = clientInvalidFields(form);
    if (names.length > 0) {
      markInvalid(key, names, form);
      return false;
    }
    setFieldErrors((prev) => ({ ...prev, [key]: {} }));
    setResult(key, {});
    return true;
  };

  const itemLabel = (td: Takedown) =>
    t("takedownList.item", {
      source: t(`sources.${td.source}`),
      ref: td.referenceNo ?? fmt.dateTime(td.receivedAt, TR_TIME_ZONE),
    });

  const slaLeft = (due: string) => {
    const ms = Date.parse(due) - nowMs;
    if (ms <= 0) return t("takedownList.overdue");
    return t("takedownList.remaining", {
      hours: Math.floor(ms / HOUR_MS),
      minutes: Math.floor((ms % HOUR_MS) / 60_000),
    });
  };

  const slaDueSoon = (due: string) => {
    const ms = Date.parse(due) - nowMs;
    return nowMs > 0 && ms > 0 && ms <= SLA_WARNING_MS;
  };

  const waited = (since: string) => {
    const ms = Math.max(0, nowMs - Date.parse(since));
    if (ms >= DAY_MS) {
      return t("noticeQueue.waitedDays", {
        days: Math.floor(ms / DAY_MS),
        hours: Math.floor((ms % DAY_MS) / HOUR_MS),
      });
    }
    return t("noticeQueue.waitedHours", {
      hours: Math.floor(ms / HOUR_MS),
      minutes: Math.floor((ms % HOUR_MS) / 60_000),
    });
  };

  const categoryLabel = (code: string) =>
    tr.has(`categories.${code}`) ? tr(`categories.${code}`) : code;

  /** Alan ipucuna "n/max karakter" sayacı ekler (aria-describedby ile okunur). */
  const withCount = (hint: string | null, length: number, max: number) => {
    const count = t("fieldLimits.count", { count: length, max });
    return hint ? `${hint} · ${count}` : count;
  };

  const draftOf = (id: string) => drafts[id] ?? readNoticeDraft(id);
  const editDraft = (id: string, patch: Partial<NoticeDraft>) => {
    const next = { ...draftOf(id), ...patch };
    setDrafts((prev) => ({ ...prev, [id]: next }));
    writeNoticeDraft(id, next);
  };
  const dropDraft = (id: string) => {
    writeNoticeDraft(id, null);
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  /** İlan önizlemesi; aynı kimlik için süren sorguyu yeniden kullanır. Ağ hatasında `null`. */
  const lookupProperty = (raw: string): Promise<PropertyPreview | null> => {
    const id = raw.trim();
    if (!id) {
      lookupRef.current = null;
      setPreview(null);
      return Promise.resolve(null);
    }
    if (lookupRef.current?.id === id) return lookupRef.current.result;
    setPreview({ state: "loading" });
    const result = apiFetch<{ title: string; location?: { city?: string | null } | null }>(
      `/api/properties/${encodeURIComponent(id)}`
    )
      .then((p): PropertyPreview => ({
        state: "found",
        title: p.title,
        city: p.location?.city ?? null,
      }))
      .catch((error: unknown): PropertyPreview | null =>
        error instanceof ApiError && error.status === 404 ? { state: "missing" } : null
      )
      .then((next) => {
        if (lookupRef.current?.result === result) setPreview(next);
        return next;
      });
    lookupRef.current = { id, result };
    return result;
  };

  const markPropertyMissing = (form: HTMLFormElement) => {
    setFieldErrors((prev) => ({
      ...prev,
      create: { propertyId: t("errors.propertyNotFound") },
    }));
    setResult("create", { error: t("errors.propertyNotFound") });
    focusFirstInvalid(form);
  };

  const createTakedown = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pendingRef.current) return;
    const form = e.currentTarget;
    syncReceivedAt(receivedRef.current, receivedEdited.current);
    if (!validate("create", form)) return;
    const data = new FormData(form);
    const propertyId = String(data.get("propertyId") ?? "").trim();
    // Bulunamayan ilan için talep gönderilmez; önizleme sürüyorsa ya da hiç yapılmadıysa beklenir.
    let checked = preview;
    if (checked?.state !== "found" && checked?.state !== "missing") {
      pendingRef.current = "create";
      try {
        checked = await lookupProperty(propertyId);
      } finally {
        pendingRef.current = null;
      }
    }
    if (checked?.state === "missing") {
      markPropertyMissing(form);
      return;
    }
    const listing =
      checked?.state === "found"
        ? checked.city
          ? `${checked.title} (${checked.city})`
          : checked.title
        : propertyId;
    const ok = await confirm({
      title: t("confirmTakedown.title"),
      body: t("confirmTakedown.body", { listing }),
      confirmLabel: t("confirmTakedown.confirm"),
      tone: "danger",
    });
    if (!ok) return;
    const res = await run("create", () =>
      apiFetch("/api/admin/takedowns", {
        method: "POST",
        body: JSON.stringify({
          source: data.get("source"),
          propertyId,
          referenceNo: String(data.get("referenceNo") ?? "").trim() || undefined,
          reason: data.get("reason"),
          receivedAt: trInputToIso(String(data.get("receivedAt") ?? "")),
        }),
      })
    );
    if (!res) return;
    if (!res.ok) {
      const code = errorCode(res.error);
      if (code === "NOT_FOUND") {
        markPropertyMissing(form);
      } else if (code === "TAKEDOWN_DUPLICATE") {
        setResult("create", { error: t("errors.takedownDuplicate") });
      } else {
        showError("create", res.error, form);
      }
      return;
    }
    setResult("create", { message: t("takedownCreated", { listing }) });
    form.reset();
    receivedEdited.current = false;
    syncReceivedAt(receivedRef.current, false);
    lookupRef.current = null;
    setPreview(null);
    setReasonLength(0);
    takedowns.reload();
    document.getElementById("td-source")?.focus();
  };

  const closeTakedown = async (td: Takedown, e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pendingRef.current) return;
    const form = e.currentTarget;
    const key = `td-${td.id}`;
    if (!validate(key, form)) return;
    const resolution = String(new FormData(form).get("resolution") ?? "").trim();
    const item = itemLabel(td);
    const rows = takedownRows ?? [];
    const index = rows.findIndex((r) => r.id === td.id);
    const next = rows[index + 1] ?? rows[index - 1];
    const res = await run(key, () =>
      apiFetch(`/api/admin/takedowns/${td.id}`, {
        method: "POST",
        body: JSON.stringify({ resolution }),
      })
    );
    if (!res) return;
    const code = res.ok ? undefined : errorCode(res.error);
    if (!res.ok && code !== "TAKEDOWN_CLOSED" && code !== "NOT_FOUND") {
      showError(key, res.error, form);
      return;
    }
    // Açık filtresinde (ya da silinmişse) satır listeden düşer: sonuç liste düzeyinde gösterilir.
    const vanishes = takedownFilter !== "all" || code === "NOT_FOUND";
    const errorKey = code === "NOT_FOUND" ? "errors.takedownNotFound" : "errors.takedownClosed";
    setResult(
      vanishes ? "takedown-list" : key,
      res.ok ? { message: t("takedownClosed", { item }) } : { error: t(errorKey, { item }) }
    );
    setClosingId(null);
    const neighbour = next ? `td-${next.id}-title` : "takedown-list-title";
    focusAfterReload.current = vanishes ? neighbour : `td-${td.id}-title`;
    takedowns.reload();
  };

  const decide = (n: NoticeRow) => async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pendingRef.current) return;
    const form = e.currentTarget;
    const key = `n-${n.id}`;
    if (!validate(key, form)) return;
    const data = new FormData(form);
    const decision = String(data.get("decision") ?? "");
    const ground = decision === "REMOVED" ? String(data.get("ground") ?? "") : "";
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
    const res = await run(key, () =>
      apiFetch(`/api/admin/notices/${n.id}`, {
        method: "POST",
        body: JSON.stringify({
          decision,
          ground: ground || undefined,
          facts: data.get("facts"),
          legalReference: String(data.get("legalReference") ?? "").trim() || undefined,
        }),
      })
    );
    if (!res) return;
    const code = res.ok ? undefined : errorCode(res.error);
    if (!res.ok && code !== "NOTICE_DECIDED" && code !== "NOT_FOUND") {
      showError(key, res.error, form);
      return;
    }
    // Karar verilen bildirim listeden düşer: sonuç kart düzeyinde, içerik adresiyle gösterilir.
    dropDraft(n.id);
    const url = n.contentUrl;
    const errorKey = code === "NOT_FOUND" ? "errors.noticeNotFound" : "errors.noticeDecided";
    setResult(
      "notices",
      res.ok ? { message: t("noticeDecided", { url }) } : { error: t(errorKey, { url }) }
    );
    focusAfterReload.current = next ? `notice-${next.id}-title` : "notices-title";
    notices.reload();
  };

  const pendingNotices = notices.data ?? [];
  const fromError = period.from ? null : t("report.dateRequired");
  let toError: string | null = null;
  if (!period.to) toError = t("report.dateRequired");
  else if (period.from && period.from > period.to) toError = t("report.invalidRange");
  const reportUrl =
    fromError || toError
      ? null
      : `/api/admin/compliance/transparency?from=${period.from}&to=${nextDay(period.to)}`;

  return (
    <div className="space-y-6">
      {confirmDialog}
      {/* Başlık metnine girmeden (karar düğmesi adları) bağlantılara "yeni sekme" açıklaması. */}
      <span id="compliance-new-tab" hidden>
        {t("noticeQueue.newTab")}
      </span>

      <Card title={t("takedowns")} id="takedowns">
        <RequiredLegend className="mb-3" />
        <form
          noValidate
          onSubmit={createTakedown}
          onFocus={() => syncReceivedAt(receivedRef.current, receivedEdited.current)}
          className="grid gap-3 sm:grid-cols-2"
        >
          <Field id="td-source" label={t("source")} error={fieldError("create", "source")}>
            <select
              id="td-source"
              name="source"
              className={inputClass}
              defaultValue="MINISTRY_7565"
            >
              <option value="MINISTRY_7565">{t("sources.MINISTRY_7565")}</option>
              <option value="COURT_ORDER">{t("sources.COURT_ORDER")}</option>
              <option value="OTHER_AUTHORITY">{t("sources.OTHER_AUTHORITY")}</option>
            </select>
          </Field>
          <Field
            id="td-property"
            label={t("propertyId")}
            hint={t("propertyIdHint")}
            error={fieldError("create", "propertyId")}
            required
          >
            <input
              id="td-property"
              name="propertyId"
              maxLength={MAX.propertyId}
              autoComplete="off"
              spellCheck={false}
              onBlur={(e) => void lookupProperty(e.currentTarget.value)}
              onChange={() => {
                lookupRef.current = null;
                setPreview(null);
              }}
              className={inputClass}
            />
          </Field>
          <Field
            id="td-ref"
            label={t("referenceNoOptional")}
            error={fieldError("create", "referenceNo")}
          >
            <input
              id="td-ref"
              name="referenceNo"
              maxLength={MAX.referenceNo}
              autoComplete="off"
              spellCheck={false}
              className={inputClass}
            />
          </Field>
          <Field
            id="td-received"
            label={t("receivedAt")}
            hint={t("receivedAtHint")}
            error={fieldError("create", "receivedAt")}
            required
          >
            <input
              ref={receivedRef}
              id="td-received"
              name="receivedAt"
              type="datetime-local"
              onChange={() => {
                receivedEdited.current = true;
              }}
              className={inputClass}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field
              id="td-reason"
              label={t("reason")}
              hint={withCount(t("reasonHint"), reasonLength, MAX.reason)}
              error={fieldError("create", "reason")}
              required
            >
              <textarea
                id="td-reason"
                name="reason"
                minLength={3}
                maxLength={MAX.reason}
                rows={3}
                onChange={(e) => setReasonLength(e.currentTarget.value.length)}
                className={inputClass}
              />
            </Field>
            <CharLimitStatus length={reasonLength} max={MAX.reason} />
          </div>
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

        <h3
          id="takedown-list-title"
          tabIndex={-1}
          className="mt-6 text-base font-semibold text-gray-900"
        >
          {t("takedownList.title")}
        </h3>
        <div
          role="group"
          aria-label={t("takedownList.filter")}
          className="mt-2 flex flex-wrap gap-2"
        >
          {TAKEDOWN_FILTERS.map((key) => (
            <Button
              key={key}
              variant={takedownFilter === key ? "primary" : "secondary"}
              aria-pressed={takedownFilter === key}
              onClick={() => setTakedownFilter(key)}
            >
              {t(`takedownList.filters.${key}`)}
            </Button>
          ))}
        </div>
        <div className="mt-2">
          <Status
            error={results["takedown-list"]?.error}
            message={results["takedown-list"]?.message}
          />
        </div>

        {takedowns.error ? (
          <div className="mt-2 space-y-2">
            <Status error={takedowns.error} />
            <Button variant="secondary" onClick={() => takedowns.reload()}>
              {t("retry")}
            </Button>
          </div>
        ) : takedownRows === null ? (
          <p role="status" className="mt-2 text-sm text-gray-600">
            {tc("loading")}
          </p>
        ) : takedownRows.length === 0 ? (
          <p className="mt-2 text-sm text-gray-600">
            {takedownFilter === "all"
              ? t("noTakedowns")
              : t(`takedownList.empty.${takedownFilter}`)}
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-gray-100 text-sm">
            {takedownRows.map((td) => {
              const key = `td-${td.id}`;
              const titleId = `${key}-title`;
              const open = td.status !== "CLOSED";
              return (
                <li key={td.id} className="py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h4 id={titleId} tabIndex={-1} className="break-words font-semibold">
                        {itemLabel(td)}
                      </h4>
                      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                        <dt>{t("takedownList.listing")}</dt>
                        <dd className="min-w-0 break-words">
                          <a
                            className={`text-[#003580] underline ${focusRing}`}
                            href={`/property/${encodeURIComponent(td.propertyId)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-describedby="compliance-new-tab"
                          >
                            {td.property?.title ?? (
                              <span className="break-all font-mono text-xs">{td.propertyId}</span>
                            )}
                          </a>
                          {td.property?.title && (
                            <>
                              {" "}
                              <span className="break-all font-mono text-xs">{td.propertyId}</span>
                            </>
                          )}
                        </dd>
                        <dt>{t("referenceNo")}</dt>
                        <dd className="min-w-0 break-words">
                          {td.referenceNo ?? t("takedownList.none")}
                        </dd>
                        <dt>{t("takedownList.statusLabel")}</dt>
                        <dd>{t(`status.${td.status}`)}</dd>
                        <dt>{t("takedownList.received")}</dt>
                        <dd>
                          {t("takedownList.at", { at: fmt.dateTime(td.receivedAt, TR_TIME_ZONE) })}
                        </dd>
                        <dt>{t("slaDue")}</dt>
                        <dd>
                          {t("takedownList.at", { at: fmt.dateTime(td.slaDueAt, TR_TIME_ZONE) })}
                          {open && !td.slaBreachedAt && nowMs > 0 && <> · {slaLeft(td.slaDueAt)}</>}
                          {open && !td.slaBreachedAt && slaDueSoon(td.slaDueAt) && (
                            <strong className="ml-2">{t("slaWarning.dueSoon")}</strong>
                          )}
                          {td.slaBreachedAt && (
                            <strong className="ml-2 text-red-700">{t("breached")}</strong>
                          )}
                        </dd>
                      </dl>
                    </div>
                    {open && closingId !== td.id && (
                      <Button
                        id={`${key}-open-close`}
                        variant="secondary"
                        aria-labelledby={`${key}-open-close ${titleId}`}
                        onClick={() => {
                          setResolutionLength(0);
                          setClosingId(td.id);
                        }}
                      >
                        {t("close")}
                      </Button>
                    )}
                  </div>
                  {open && closingId === td.id && (
                    <form
                      id={`${key}-close`}
                      noValidate
                      aria-labelledby={titleId}
                      onSubmit={(e) => void closeTakedown(td, e)}
                      className="mt-2 space-y-2 rounded-md border border-gray-200 p-3"
                    >
                      <Field
                        id={`${key}-resolution`}
                        label={t("closeForm.resolution")}
                        hint={withCount(
                          `${t("closeForm.warning")} ${t("reasonHint")}`,
                          resolutionLength,
                          MAX.resolution
                        )}
                        error={fieldError(key, "resolution")}
                        required
                      >
                        <textarea
                          id={`${key}-resolution`}
                          name="resolution"
                          minLength={3}
                          maxLength={MAX.resolution}
                          rows={3}
                          autoFocus
                          onChange={(e) => setResolutionLength(e.currentTarget.value.length)}
                          className={inputClass}
                        />
                      </Field>
                      <CharLimitStatus length={resolutionLength} max={MAX.resolution} />
                      <div className="flex flex-wrap gap-2">
                        <Button
                          id={`${key}-submit`}
                          type="submit"
                          variant="danger"
                          busy={pending === key}
                          aria-labelledby={`${key}-submit ${titleId}`}
                        >
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

      <Card
        title={
          notices.data ? t("noticeQueue.title", { count: pendingNotices.length }) : t("notices")
        }
        id="notices"
      >
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
        ) : pendingNotices.length === 0 ? (
          <p className="text-sm text-gray-600">{t("noNotices")}</p>
        ) : (
          <>
            <p className="mb-2 text-sm text-gray-600">{t("noticeQueue.order")}</p>
            <RequiredLegend className="mb-2" />
          </>
        )}
        <ul className="space-y-4">
          {pendingNotices.map((n) => {
            const key = `n-${n.id}`;
            const titleId = `notice-${n.id}-title`;
            const decision = decisions[n.id] ?? "";
            const draft = draftOf(n.id);
            return (
              <li key={n.id} className="rounded-md border border-gray-200 p-3 text-sm">
                <h3 id={titleId} tabIndex={-1} className="min-w-0">
                  <strong>{categoryLabel(n.category)}</strong> —{" "}
                  <a
                    className={`break-all text-[#003580] underline ${focusRing}`}
                    href={n.contentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-describedby="compliance-new-tab"
                  >
                    {n.contentUrl}
                  </a>
                </h3>
                <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                  <dt>{t("noticeQueue.received")}</dt>
                  <dd>
                    {t("takedownList.at", { at: fmt.dateTime(n.createdAt, TR_TIME_ZONE) })}
                    {nowMs > 0 && <> · {waited(n.createdAt)}</>}
                  </dd>
                  <dt>{t("takedownList.listing")}</dt>
                  <dd className="min-w-0 break-words">
                    {n.propertyId ? (
                      <a
                        className={`text-[#003580] underline ${focusRing}`}
                        href={`/property/${encodeURIComponent(n.propertyId)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-describedby="compliance-new-tab"
                      >
                        {n.property?.title ?? (
                          <span className="break-all font-mono text-xs">{n.propertyId}</span>
                        )}
                      </a>
                    ) : (
                      t("noticeQueue.noListing")
                    )}
                  </dd>
                  <dt>{t("noticeQueue.reporter")}</dt>
                  <dd className="min-w-0 break-words">
                    {n.reporterName?.trim() || t("noticeQueue.reporterUnknown")}
                  </dd>
                </dl>
                <p className="mt-1 whitespace-pre-line break-words text-gray-700">
                  {n.explanation}
                </p>
                <form
                  noValidate
                  aria-labelledby={titleId}
                  onSubmit={decide(n)}
                  className="mt-2 grid gap-2 sm:grid-cols-2"
                >
                  <Field
                    id={`d-${n.id}`}
                    label={t("decision")}
                    hint={n.propertyId ? undefined : t("noticeQueue.removeUnavailable")}
                    error={fieldError(key, "decision")}
                    required
                  >
                    <select
                      id={`d-${n.id}`}
                      name="decision"
                      className={inputClass}
                      value={decision}
                      onChange={(e) =>
                        setDecisions((prev) => ({ ...prev, [n.id]: e.target.value }))
                      }
                    >
                      <option value="" disabled>
                        {t("choose")}
                      </option>
                      <option value="REMOVED" disabled={!n.propertyId}>
                        {t("decisions.REMOVED")}
                      </option>
                      <option value="NO_ACTION">{t("decisions.NO_ACTION")}</option>
                    </select>
                  </Field>
                  {decision === "REMOVED" && (
                    <Field
                      id={`g-${n.id}`}
                      label={t("ground")}
                      error={fieldError(key, "ground")}
                      required
                    >
                      <select id={`g-${n.id}`} name="ground" className={inputClass} defaultValue="">
                        <option value="" disabled>
                          {t("choose")}
                        </option>
                        <option value="ILLEGAL_CONTENT">{t("grounds.ILLEGAL_CONTENT")}</option>
                        <option value="TERMS_OF_SERVICE">{t("grounds.TERMS_OF_SERVICE")}</option>
                      </select>
                    </Field>
                  )}
                  <div>
                    <Field
                      id={`f-${n.id}`}
                      label={t("facts")}
                      hint={withCount(t("factsHint"), draft.facts.length, MAX.facts)}
                      error={fieldError(key, "facts")}
                      required
                    >
                      <textarea
                        id={`f-${n.id}`}
                        name="facts"
                        minLength={10}
                        maxLength={MAX.facts}
                        rows={4}
                        value={draft.facts}
                        onChange={(e) => editDraft(n.id, { facts: e.target.value })}
                        className={inputClass}
                      />
                    </Field>
                    <CharLimitStatus length={draft.facts.length} max={MAX.facts} />
                  </div>
                  <div>
                    <Field
                      id={`l-${n.id}`}
                      label={t("legalReferenceOptional")}
                      hint={withCount(null, draft.legalReference.length, MAX.legalReference)}
                      error={fieldError(key, "legalReference")}
                    >
                      <input
                        id={`l-${n.id}`}
                        name="legalReference"
                        maxLength={MAX.legalReference}
                        value={draft.legalReference}
                        onChange={(e) => editDraft(n.id, { legalReference: e.target.value })}
                        className={inputClass}
                      />
                    </Field>
                    <CharLimitStatus
                      length={draft.legalReference.length}
                      max={MAX.legalReference}
                    />
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Button
                      id={`${key}-submit`}
                      type="submit"
                      busy={pending === key}
                      aria-labelledby={`${key}-submit ${titleId}`}
                    >
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

      {afterNotices}

      <Card title={t("transparency")} id="transparency">
        <fieldset>
          <legend className="text-sm font-medium text-gray-800">{t("report.period")}</legend>
          <div role="group" aria-label={t("report.presets")} className="mt-2 flex flex-wrap gap-2">
            {REPORT_PRESETS.map((key) => {
              const preset = presetPeriod(key, reportNow);
              const active = preset.from === period.from && preset.to === period.to;
              return (
                <Button
                  key={key}
                  variant={active ? "primary" : "secondary"}
                  aria-pressed={active}
                  onClick={() => setPeriod(preset)}
                >
                  {t(`report.${key}`)}
                </Button>
              );
            })}
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field id="report-from" label={t("report.from")} error={fromError}>
              <input
                id="report-from"
                type="date"
                value={period.from}
                onChange={(e) => {
                  const from = e.target.value;
                  setPeriod((p) => ({ ...p, from }));
                }}
                className={inputClass}
              />
            </Field>
            <Field id="report-to" label={t("report.to")} error={toError}>
              <input
                id="report-to"
                type="date"
                value={period.to}
                onChange={(e) => {
                  const to = e.target.value;
                  setPeriod((p) => ({ ...p, to }));
                }}
                className={inputClass}
              />
            </Field>
          </div>
        </fieldset>
        {reportUrl && (
          <p className="mt-3 text-sm">
            <a
              className={`font-semibold text-[#003580] underline ${focusRing}`}
              href={`${reportUrl}&format=csv`}
              download
            >
              {t("exportCsv")}
            </a>
            {" · "}
            <a
              className={`font-semibold text-[#003580] underline ${focusRing}`}
              href={reportUrl}
              target="_blank"
              rel="noopener"
            >
              {t("exportJson")}
            </a>
          </p>
        )}
      </Card>
    </div>
  );
}
