"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, apiFetch } from "@/lib/api-client";
import { useFormat } from "@/i18n/use-format";
import {
  Button,
  ButtonLink,
  Card,
  LlmBadge,
  Status,
  focusRing,
  inputClass,
  loginHref,
  useErrorText,
  useLoader,
} from "@/components/ui/ui";
import { useConfirm } from "@/components/ui/ConfirmDialog";

interface Contribution {
  factor: "occupancy" | "lead_time" | "holiday" | "event" | "clamp";
  label: string;
  /** `revenue.factorDetail.<key>` ile çevrilir; eski kayıtlarda yoksa `label` gösterilir. */
  detail?: { key: string; params?: Record<string, string | number> };
  multiplier: number;
  amountMinor: number;
}

interface SuggestionView {
  id: string;
  roomId: string;
  roomName: string;
  date: string;
  currency: string;
  currentMinor: number;
  suggestedMinor: number;
  floorMinor: number;
  ceilingMinor: number;
  contributions: Contribution[];
  explanation: string;
  llmMode: string;
  status: "PENDING" | "ACCEPTED" | "REJECTED";
}

interface Overview {
  property: { id: string; title: string; currency: string };
  rooms: Array<{ id: string; name: string }>;
  kpis: {
    currency: string;
    from: string;
    to: string;
    availableRoomNights: number;
    soldRoomNights: number;
    revenueMinor: number;
    occupancy: number;
    adrMinor: number;
    revparMinor: number;
  };
  pickup: Array<{ date: string; pickup: number; onBooks: number }>;
  suggestions: SuggestionView[];
}

/** Çizim alanı (viewBox 0–100); `preserveAspectRatio="none"` ile kabın genişliğine yayılır. */
const PLOT = { top: 4, bottom: 96 } as const;
const SUGGESTIONS_EMPTY_ID = "revenue-suggestions-empty";
const suggestionTitleId = (id: string) => `suggestion-${id}-title`;
const DAY_MS = 86_400_000;

/** ISO günü (YYYY-MM-DD) UTC'de kaydırır; KPI penceresi bitişi hariç: son gece = to − 1. */
function shiftIsoDate(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Kabulde sunucu, öneriden sonra elle değişen fiyatı ezmek yerine PRICE_CHANGED döndürür. */
function isPriceChanged(e: unknown): boolean {
  return e instanceof ApiError && e.code === "PRICE_CHANGED";
}

/**
 * Pickup grafiği: penceredeki toplam oda-gece (çizgi) ve günlük giriş (çubuk) ayrı ölçeklerde.
 * Eksen metinleri HTML'dedir; grafik daralsa da yazı boyutu küçülmez.
 */
function PickupChart({ points }: { points: Overview["pickup"] }) {
  const t = useTranslations("revenue");
  const f = useFormat();
  if (points.length === 0) return <p className="text-sm text-gray-700">{t("pickup.noData")}</p>;
  if (points.every((p) => p.onBooks === 0))
    return <p className="text-sm text-gray-700">{t("pickup.empty")}</p>;
  const n = points.length;
  const max = Math.max(1, ...points.map((p) => p.onBooks));
  const dailyMax = Math.max(0, ...points.map((p) => p.pickup));
  const barMax = Math.max(1, dailyMax);
  // Kenar boşluğu, uçtaki çubukların yarısını çizim alanına sığdırır.
  const pad = n > 1 ? 30 / (n - 0.4) : 50;
  const step = n > 1 ? (100 - pad * 2) / (n - 1) : 0;
  const barW = n > 1 ? step * 0.6 : 10;
  const x = (i: number) => pad + i * step;
  const y = (v: number, scale: number) => PLOT.bottom - (v / scale) * (PLOT.bottom - PLOT.top);
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.onBooks, max)}`).join(" ");
  const last = points[n - 1];
  const labelRow = "flex flex-wrap justify-between gap-x-3 text-xs text-gray-700";
  return (
    <figure>
      <div role="img" aria-labelledby="pickup-title" aria-describedby="pickup-desc pickup-trend">
        <span id="pickup-title" hidden>
          {t("pickup.chartTitle")}
        </span>
        <span id="pickup-desc" hidden>
          {t("pickup.chartDesc", { count: n, last: last.onBooks })}
        </span>
        <p className={labelRow}>
          <span>{t("pickup.lineLabel")}</span>
          <span>{t("pickup.lineScale", { max, last: last.onBooks })}</span>
        </p>
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="mt-1 block h-24 w-full overflow-visible"
        >
          {[PLOT.top, (PLOT.top + PLOT.bottom) / 2].map((gy) => (
            <line
              key={gy}
              x1={0}
              x2={100}
              y1={gy}
              y2={gy}
              strokeDasharray="3 3"
              vectorEffect="non-scaling-stroke"
              className="stroke-gray-500"
            />
          ))}
          <line
            x1={0}
            x2={100}
            y1={PLOT.bottom}
            y2={PLOT.bottom}
            vectorEffect="non-scaling-stroke"
            className="stroke-gray-500"
          />
          <path
            d={line}
            fill="none"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            className="stroke-brand"
          />
        </svg>
        <p className={`mt-3 ${labelRow}`}>
          <span>{t("pickup.barLabel")}</span>
          <span>{t("pickup.barScale", { max: barMax })}</span>
        </p>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="mt-1 block h-12 w-full">
          <line
            x1={0}
            x2={100}
            y1={PLOT.bottom}
            y2={PLOT.bottom}
            vectorEffect="non-scaling-stroke"
            className="stroke-gray-500"
          />
          {points.map((p, i) =>
            p.pickup > 0 ? (
              <rect
                key={p.date}
                x={x(i) - barW / 2}
                y={y(p.pickup, barMax)}
                width={barW}
                height={PLOT.bottom - y(p.pickup, barMax)}
                className="fill-primary-500"
              >
                <title>{`${f.date(p.date, "short")}: +${p.pickup}`}</title>
              </rect>
            ) : null
          )}
        </svg>
        <p className={`mt-1 ${labelRow}`}>
          <span>{f.date(points[0].date, "short")}</span>
          <span>{f.date(last.date, "short")}</span>
        </p>
      </div>
      <figcaption className="mt-2 text-xs text-gray-700">
        {t("pickup.caption")}{" "}
        <span id="pickup-trend">
          {t("pickup.trend", {
            first: points[0].onBooks,
            last: last.onBooks,
            dailyMax,
          })}
        </span>
      </figcaption>
      {/* Grafiğin metin eşdeğeri (WCAG 1.1.1): günlük değerler fare olmadan da okunur. */}
      <details className="mt-2 text-sm">
        <summary className="inline-flex min-h-[44px] cursor-pointer items-center font-medium text-gray-900">
          {t("pickup.tableToggle")}
        </summary>
        <div
          className="max-h-80 overflow-auto"
          role="region"
          tabIndex={0}
          aria-label={t("pickup.tableCaption")}
        >
          <table className="min-w-full text-left text-sm">
            <caption className="sr-only">{t("pickup.tableCaption")}</caption>
            <thead className="border-b text-gray-700">
              <tr>
                <th scope="col" className="py-1 pr-4">
                  {t("pickup.columns.date")}
                </th>
                <th scope="col" className="py-1 pr-4 text-right">
                  {t("pickup.columns.pickup")}
                </th>
                <th scope="col" className="py-1 pr-4 text-right">
                  {t("pickup.columns.onBooks")}
                </th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.date} className="border-b last:border-0">
                  <th scope="row" className="py-1 pr-4 font-normal">
                    {f.date(p.date, "short")}
                  </th>
                  <td className="py-1 pr-4 text-right">{p.pickup}</td>
                  <td className="py-1 pr-4 text-right">{p.onBooks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <dt className="text-xs text-gray-700">{label}</dt>
      <dd className="text-lg font-semibold text-gray-900">{value}</dd>
      {hint && <dd className="mt-1 text-xs text-gray-700">{hint}</dd>}
    </div>
  );
}

/** useLoader + oturum düşmesi bilgisi: 401'de hata görünümü giriş bağlantısı da gösterir. */
function useRevenueLoader<T>(fetcher: () => Promise<T>, deps: ReadonlyArray<unknown> = []) {
  const [authLost, setAuthLost] = useState(false);
  const loader = useLoader(
    () =>
      fetcher().then(
        (d) => {
          setAuthLost(false);
          return d;
        },
        (e: unknown) => {
          setAuthLost(e instanceof ApiError && e.status === 401);
          throw e;
        }
      ),
    deps
  );
  return { ...loader, authLost };
}

/** Yükleme hatası: metin + "Tekrar dene"; oturum düştüyse dönüş adresli giriş bağlantısı. */
function LoadError({
  error,
  authLost,
  onRetry,
}: {
  error: string;
  authLost: boolean;
  onRetry: () => void;
}) {
  const t = useTranslations("revenue");
  const tc = useTranslations("common");
  return (
    <div className="space-y-2">
      <Status error={error} />
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" className="min-h-[44px]" onClick={onRetry}>
          {tc("errorPage.retry")}
        </Button>
        {authLost && (
          <ButtonLink href={loginHref()} variant="secondary" className="min-h-[44px]">
            {t("signInAgain")}
          </ButtonLink>
        )}
      </div>
    </div>
  );
}

function SuggestionRow({
  s,
  onDecided,
  locked = false,
}: {
  s: SuggestionView;
  onDecided: (message: string) => void;
  /** Toplu karar ya da yeniden üretim sürerken tekil karar düğmeleri kilitlenir. */
  locked?: boolean;
}) {
  const t = useTranslations("revenue");
  const f = useFormat();
  const locale = useLocale();
  const errorText = useErrorText();
  // Ayrıntı etiketleri ve açıklama sunucuda Türkçe üretilir (WCAG 3.1.2).
  const serverLang = locale === "tr" ? undefined : "tr";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirm();
  const noteId = `suggestion-${s.id}-note`;
  const change =
    s.currentMinor > 0
      ? f.number((s.suggestedMinor - s.currentMinor) / s.currentMinor, {
          style: "percent",
          signDisplay: "exceptZero",
          maximumFractionDigits: 1,
        })
      : null;
  const priceArgs = {
    room: s.roomName,
    date: f.date(s.date, "short"),
    from: f.money(s.currentMinor, s.currency),
    to: f.money(s.suggestedMinor, s.currency),
  };
  const decide = async (action: "accept" | "reject") => {
    if (busy || locked) return;
    if (
      action === "accept" &&
      !(await confirm({
        title: t("suggestions.acceptConfirmTitle", priceArgs),
        body: t("suggestions.acceptNote"),
        confirmLabel: t("suggestions.acceptConfirm"),
        tone: "primary",
      }))
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/host/revenue/suggestions/${s.id}/${action}`, { method: "POST" });
      onDecided(
        action === "accept"
          ? t("suggestions.accepted", priceArgs)
          : t("suggestions.rejected", priceArgs)
      );
    } catch (e) {
      setError(isPriceChanged(e) ? t("suggestions.priceChanged") : errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const caption = t("suggestions.captionFor", { room: priceArgs.room, date: priceArgs.date });
  const detailText = (c: Contribution) =>
    c.detail && t.has(`factorDetail.${c.detail.key}`)
      ? t(`factorDetail.${c.detail.key}`, c.detail.params)
      : null;
  // Düğme listesinde gezinirken hangi gecenin kararı olduğu duyulur; görünür etiket başta kalır.
  const context = <span className="sr-only">{`: ${priceArgs.room} · ${priceArgs.date}`}</span>;
  return (
    <li className="space-y-2 rounded-lg border border-gray-200 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        {/* Karar sonrası satır kalkınca odak sıradaki önerinin başlığına taşınır. */}
        <h3
          id={suggestionTitleId(s.id)}
          tabIndex={-1}
          className={`rounded font-medium text-gray-900 ${focusRing}`}
        >
          {priceArgs.room} · {priceArgs.date}
        </h3>
        <p className="text-sm text-gray-800">
          {/* Üretim anındaki anlık görüntü; takvimde sonradan değişmiş olabilir. */}
          <span className="text-xs text-gray-700">{t("suggestions.snapshotLabel")}</span>{" "}
          {priceArgs.from} <span aria-hidden="true">→</span>{" "}
          <span className="sr-only">{t("suggestions.suggestedLabel")} </span>
          <strong>{priceArgs.to}</strong>
          {change && (
            <span>
              {" "}
              (<span className="sr-only">{t("suggestions.changeLabel")} </span>
              {change})
            </span>
          )}
          <span className="ml-2 text-xs text-gray-700">
            {t("suggestions.bounds", {
              floor: f.money(s.floorMinor, s.currency),
              ceiling: f.money(s.ceilingMinor, s.currency),
            })}
          </span>
        </p>
      </div>
      {/* Katkı tablosu isteğe bağlı açılır; uzun listede her öneri kısa kalır. */}
      <details className="text-sm">
        <summary className="inline-flex min-h-[44px] cursor-pointer items-center font-medium text-gray-900">
          {t("suggestions.breakdownToggle")}
          {context}
        </summary>
        <div className="overflow-x-auto" role="region" tabIndex={0} aria-label={caption}>
          <table className="min-w-full text-left text-sm">
            <caption className="sr-only">{caption}</caption>
            <thead className="border-b text-gray-700">
              <tr>
                <th scope="col" className="py-1 pr-4">
                  {t("suggestions.columns.factor")}
                </th>
                <th scope="col" className="py-1 pr-4">
                  {t("suggestions.columns.detail")}
                </th>
                <th scope="col" className="py-1 pr-4">
                  {t("suggestions.columns.multiplier")}
                </th>
                <th scope="col" className="py-1 pr-4 text-right">
                  {t("suggestions.columns.contribution")}
                </th>
              </tr>
            </thead>
            <tbody>
              {s.contributions.map((c) => {
                const detail = detailText(c);
                return (
                  <tr key={c.factor} className="border-b last:border-0">
                    <th scope="row" className="py-1 pr-4 font-normal">
                      {t(`factor.${c.factor}`)}
                    </th>
                    <td
                      className="py-1 pr-4 text-gray-700"
                      // Tatil adı sunucuda Türkçe gelir; çevrilen diğer ayrıntılar arayüz dilinde.
                      lang={detail === null || c.detail?.key === "holiday" ? serverLang : undefined}
                    >
                      {detail ?? c.label}
                    </td>
                    <td className="py-1 pr-4">
                      ×
                      {f.number(c.multiplier, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </td>
                    <td className="py-1 pr-4 text-right">
                      {c.amountMinor > 0 ? "+" : ""}
                      {f.money(c.amountMinor, s.currency)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
      <p className="text-sm text-gray-800">
        <span lang={serverLang}>{s.explanation}</span>{" "}
        <LlmBadge mode={s.llmMode} audience="staff" />
      </p>
      <p id={noteId} className="text-xs text-gray-700">
        {t("suggestions.acceptNote")}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          className="min-h-[44px]"
          onClick={() => decide("accept")}
          busy={busy || locked}
          aria-describedby={noteId}
        >
          {t("suggestions.accept")}
          {context}
        </Button>
        <Button
          variant="secondary"
          className="min-h-[44px]"
          onClick={() => decide("reject")}
          busy={busy || locked}
        >
          {t("suggestions.reject")}
          {context}
        </Button>
      </div>
      <Status error={error} />
      {confirmDialog}
    </li>
  );
}

/** Yeniden yüklenen içerikte odağı taşır; başlık gibi odaklanamayan öğeye tabindex=-1 verir. */
function focusById(id: string, fallbackId?: string) {
  const el =
    document.getElementById(id) ?? (fallbackId ? document.getElementById(fallbackId) : null);
  if (!el) return;
  if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
  el.focus();
}

function PropertyRevenue({
  propertyId,
  onAnnounce,
}: {
  propertyId: string;
  onAnnounce: (text: string) => void;
}) {
  const t = useTranslations("revenue");
  const f = useFormat();
  const errorText = useErrorText();
  const { data, error, reload, authLost } = useRevenueLoader(
    () => apiFetch<Overview>(`/api/host/revenue?propertyId=${encodeURIComponent(propertyId)}`),
    [propertyId]
  );
  const [roomId, setRoomId] = useState("");
  // Üretim ya da seçili odanın önerileri için toplu karar sürüyor mu?
  const [busy, setBusy] = useState<null | "generate" | "accept" | "reject">(null);
  const [message, setMessage] = useState<string | null>(null);
  // Nötr bilgi (ilerleme ya da sonuçsuz üretim): başarı rengiyle gösterilmez.
  const [info, setInfo] = useState<null | "generating" | "none">(null);
  const [genError, setGenError] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirm();
  // Karar ya da yeniden deneme sonrası odak, yenilenen veride bu öğeye taşınır (WCAG 2.4.3).
  const focusAfterReload = useRef<string | null>(null);
  const loadedTitle = data?.property.title ?? null;

  useEffect(() => {
    if (loadedTitle !== null) onAnnounce(t("loaded", { title: loadedTitle }));
  }, [loadedTitle, onAnnounce, t]);

  useEffect(() => {
    const target = focusAfterReload.current;
    if (!data || !target) return;
    focusAfterReload.current = null;
    const room = roomId || data.rooms[0]?.id;
    const first = data.suggestions.find((s) => s.roomId === room);
    focusById(target, first ? suggestionTitleId(first.id) : SUGGESTIONS_EMPTY_ID);
  }, [data, roomId]);

  const retry = () => {
    if (!focusAfterReload.current) focusAfterReload.current = "revenue-kpis-title";
    reload();
  };

  if (error && !data) return <LoadError error={error} authLost={authLost} onRetry={retry} />;
  if (!data)
    return (
      <p aria-busy="true" className="text-sm text-gray-600">
        {t("loading")}
      </p>
    );
  const k = data.kpis;
  const selectedRoom = roomId || data.rooms[0]?.id || "";
  const selectedRoomName = data.rooms.find((r) => r.id === selectedRoom)?.name ?? "";
  // Liste "Oda" seçicisine göre süzülür; seçici hem listeyi hem üretimi belirler.
  const roomSuggestions = data.suggestions.filter((s) => s.roomId === selectedRoom);
  const pendingCount = (id: string) => data.suggestions.filter((s) => s.roomId === id).length;
  // Yeniden üretim, odanın bekleyen önerilerini yenileriyle değiştirir (sunucu siler).
  const pendingForRoom = roomSuggestions.length;
  const pendingElsewhere = data.suggestions.length - pendingForRoom;
  const replaceNoteId = "revenue-generate-replace-note";

  const generate = async () => {
    if (busy) return;
    if (
      pendingForRoom > 0 &&
      !(await confirm({
        title: t("suggestions.replaceConfirmTitle"),
        body: t("suggestions.replaceNote", { count: pendingForRoom }),
        confirmLabel: t("suggestions.replaceConfirm"),
        tone: "primary",
      }))
    )
      return;
    setBusy("generate");
    setGenError(null);
    setMessage(null);
    setInfo("generating");
    try {
      const res = await apiFetch<{ suggestions: SuggestionView[] }>(
        "/api/host/revenue/suggestions",
        { method: "POST", body: JSON.stringify({ roomId: selectedRoom }) }
      );
      // Açık envanter yoksa sunucu boş liste döndürür: başarı değil, yapılacak işi söyleyen bilgi.
      if (res.suggestions.length === 0) {
        setInfo("none");
      } else {
        setInfo(null);
        setMessage(t("suggestions.generated", { count: res.suggestions.length }));
      }
      reload();
    } catch (e) {
      setInfo(null);
      setGenError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  /** Seçili odanın tüm bekleyen önerileri için sırayla aynı karar; hata olursa durur. */
  const decideAll = async (action: "accept" | "reject") => {
    if (busy || roomSuggestions.length === 0) return;
    const total = roomSuggestions.length;
    const args = { count: total, room: selectedRoomName };
    // Toplu kararın kapsamı onayda özetlenir: tarih aralığı, uç değişimler, toplam fark (F2-27).
    const days = roomSuggestions.map((s) => s.date).sort();
    const ratios = roomSuggestions
      .filter((s) => s.currentMinor > 0)
      .map((s) => (s.suggestedMinor - s.currentMinor) / s.currentMinor);
    const maxUp = Math.max(0, ...ratios);
    const maxDown = Math.min(0, ...ratios);
    const pct = (r: number) =>
      f.number(r, { style: "percent", signDisplay: "exceptZero", maximumFractionDigits: 1 });
    const currency = roomSuggestions[0].currency;
    const sameCurrency = roomSuggestions.every((s) => s.currency === currency);
    const diffMinor = roomSuggestions.reduce(
      (sum, s) => sum + s.suggestedMinor - s.currentMinor,
      0
    );
    const lowerCount = roomSuggestions.filter((s) => s.suggestedMinor < s.currentMinor).length;
    const summary = [
      t("suggestions.allSummary.range", {
        from: f.date(days[0], "short"),
        to: f.date(days[days.length - 1], "short"),
      }),
      maxUp > 0 ? t("suggestions.allSummary.maxIncrease", { percent: pct(maxUp) }) : null,
      maxDown < 0 ? t("suggestions.allSummary.maxDecrease", { percent: pct(maxDown) }) : null,
      sameCurrency
        ? t("suggestions.allSummary.total", {
            amount: `${diffMinor > 0 ? "+" : ""}${f.money(diffMinor, currency)}`,
          })
        : null,
      t("suggestions.allSummary.lower", { count: lowerCount }),
    ].filter((line): line is string => line !== null);
    if (
      !(await confirm({
        title: t(`suggestions.${action}AllConfirmTitle`, args),
        body: (
          <>
            <ul className="list-disc space-y-1 pl-5">
              {summary.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className="mt-2">
              {t(action === "accept" ? "suggestions.acceptNote" : "suggestions.rejectAllNote")}
            </p>
          </>
        ),
        confirmLabel: t(`suggestions.${action}AllConfirm`, args),
        tone: "primary",
      }))
    )
      return;
    setBusy(action);
    setGenError(null);
    setMessage(null);
    setInfo(null);
    let done = 0;
    try {
      for (const s of roomSuggestions) {
        await apiFetch(`/api/host/revenue/suggestions/${s.id}/${action}`, { method: "POST" });
        done += 1;
      }
      // Liste boşalınca toplu düğmeler kalkar; odak boş durum metnine taşınır.
      focusAfterReload.current = SUGGESTIONS_EMPTY_ID;
      setMessage(t(`suggestions.${action}AllDone`, args));
    } catch (e) {
      // Kalan öneri tekse toplu düğmeler kalkar; odak düğmede kalamazsa ilk öneriye geçer.
      focusAfterReload.current = `revenue-bulk-${action}`;
      const reason = isPriceChanged(e) ? t("suggestions.priceChanged") : errorText(e);
      setGenError(t("suggestions.bulkFailed", { done, total, reason }));
    } finally {
      setBusy(null);
      reload();
    }
  };

  const lastNight = shiftIsoDate(k.to, -1);
  const period = { from: f.date(k.from, "short"), to: f.date(lastNight, "short") };
  const windowNights = Math.max(
    1,
    Math.round((Date.parse(`${k.to}T00:00:00Z`) - Date.parse(`${k.from}T00:00:00Z`)) / DAY_MS)
  );

  return (
    <div className="space-y-6">
      {error && <LoadError error={error} authLost={authLost} onRetry={retry} />}
      <Card title={t("kpis.title", { ...period, days: windowNights })} id="revenue-kpis">
        {k.availableRoomNights === 0 ? (
          <p className="text-sm text-gray-800">
            {t.rich("kpis.noInventory", {
              link: (chunks) => (
                <Link
                  href="/host#host-properties"
                  className={`font-semibold text-[#003580] underline ${focusRing}`}
                >
                  {chunks}
                </Link>
              ),
            })}
          </p>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Kpi
                label={t("kpis.occupancy")}
                value={f.number(k.occupancy, {
                  style: "percent",
                  minimumFractionDigits: 1,
                  maximumFractionDigits: 1,
                })}
                hint={t("kpis.occupancyHint")}
              />
              <Kpi
                label={t("kpis.adr")}
                value={f.money(k.adrMinor, k.currency)}
                hint={t("kpis.adrHint")}
              />
              <Kpi
                label={t("kpis.revpar")}
                value={f.money(k.revparMinor, k.currency)}
                hint={t("kpis.revparHint")}
              />
              <Kpi
                label={t("kpis.revenue")}
                value={f.money(k.revenueMinor, k.currency)}
                hint={t("kpis.revenueHint")}
              />
            </dl>
            <p className="mt-2 text-xs text-gray-700">
              {t("kpis.sold", { sold: k.soldRoomNights, available: k.availableRoomNights })}
            </p>
          </>
        )}
      </Card>

      <Card title={t("pickup.title")} id="revenue-pickup">
        {data.pickup.length > 0 && (
          <p className="mb-3 text-sm text-gray-700">
            {t("pickup.window", { ...period, days: data.pickup.length })}
          </p>
        )}
        <PickupChart points={data.pickup} />
      </Card>

      <Card title={t("suggestions.title")} id="revenue-suggestions">
        <p className="mb-3 text-sm text-gray-700">{t("suggestions.intro")}</p>
        <div className="mb-4 flex flex-wrap items-end gap-2">
          <label className="text-sm text-gray-800">
            {t("suggestions.room")}
            <select
              className={inputClass}
              value={selectedRoom}
              onChange={(e) => {
                setRoomId(e.target.value);
                setInfo(null);
              }}
            >
              {data.rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {t("suggestions.roomOption", { name: r.name, count: pendingCount(r.id) })}
                </option>
              ))}
            </select>
          </label>
          <Button
            className="min-h-[44px]"
            onClick={generate}
            disabled={!selectedRoom}
            busy={busy !== null}
            aria-describedby={pendingForRoom > 0 ? replaceNoteId : undefined}
          >
            {busy === "generate" ? t("suggestions.generating") : t("suggestions.generate")}
          </Button>
        </div>
        {pendingForRoom > 0 && (
          <p id={replaceNoteId} className="-mt-2 mb-3 text-xs text-gray-700">
            {t("suggestions.replaceNote", { count: pendingForRoom })}
          </p>
        )}
        {pendingElsewhere > 0 && (
          <p className="mb-3 text-xs text-gray-700">
            {t("suggestions.pendingElsewhere", { count: pendingElsewhere })}
          </p>
        )}
        {/* İlerleme ve sonuçsuz üretim için nötr canlı bölge (başarı/hata rengi yok). */}
        <p role="status" className="text-sm text-gray-700">
          {info === "generating" && t("suggestions.generatingStatus")}
          {info === "none" &&
            t.rich("suggestions.noneGenerated", {
              link: (chunks) => (
                <Link
                  href="/host#host-properties"
                  className={`font-semibold text-[#003580] underline ${focusRing}`}
                >
                  {chunks}
                </Link>
              ),
            })}
        </p>
        <Status error={genError} message={message} />
        {roomSuggestions.length === 0 ? (
          <p id={SUGGESTIONS_EMPTY_ID} tabIndex={-1} className="text-sm text-gray-700">
            {selectedRoomName
              ? t("suggestions.emptyForRoom", { room: selectedRoomName })
              : t("suggestions.empty")}
          </p>
        ) : (
          <>
            {roomSuggestions.length > 1 && (
              <div className="mb-3 flex flex-wrap gap-2">
                {(["accept", "reject"] as const).map((action) => (
                  <Button
                    key={action}
                    id={`revenue-bulk-${action}`}
                    variant="secondary"
                    className="min-h-[44px]"
                    onClick={() => decideAll(action)}
                    busy={busy !== null}
                  >
                    {busy === action
                      ? t("suggestions.processing")
                      : t(`suggestions.${action}All`, { count: pendingForRoom })}
                  </Button>
                ))}
              </div>
            )}
            <ul className="space-y-3" aria-busy={busy !== null || undefined}>
              {roomSuggestions.map((s, i, list) => (
                <SuggestionRow
                  key={s.id}
                  s={s}
                  locked={busy !== null}
                  onDecided={(text) => {
                    // Karar verilen satır listeden kalkar; sıradaki (yoksa önceki) öneriye geçilir.
                    const next = list[i + 1] ?? list[i - 1];
                    focusAfterReload.current = next
                      ? suggestionTitleId(next.id)
                      : SUGGESTIONS_EMPTY_ID;
                    setGenError(null);
                    setInfo(null);
                    setMessage(text);
                    reload();
                  }}
                />
              ))}
            </ul>
          </>
        )}
      </Card>
      {confirmDialog}
    </div>
  );
}

export default function RevenueDashboard() {
  const t = useTranslations("revenue");
  const { data, error, reload, authLost } = useRevenueLoader(() =>
    apiFetch<Array<{ id: string; title: string }>>("/api/host/properties")
  );
  const [propertyId, setPropertyId] = useState("");
  const [announce, setAnnounce] = useState("");
  const focusAfterRetry = useRef(false);
  useEffect(() => {
    if (!data || !focusAfterRetry.current) return;
    focusAfterRetry.current = false;
    focusById("revenue-property", "revenue-kpis-title");
  }, [data]);
  // Sürekli bağlı canlı bölge: mülk değişince yükleniyor/yüklendi duyurulur (WCAG 4.1.3).
  const live = (
    <div role="status" aria-live="polite" className="sr-only">
      {announce}
    </div>
  );
  if (error)
    return (
      <LoadError
        error={error}
        authLost={authLost}
        onRetry={() => {
          focusAfterRetry.current = true;
          reload();
        }}
      />
    );
  if (!data)
    return (
      <>
        {live}
        <p aria-busy="true" className="text-sm text-gray-600">
          {t("loadingProperties")}
        </p>
      </>
    );
  if (data.length === 0) return <p className="text-sm text-gray-700">{t("noProperties")}</p>;
  const selected = propertyId || data[0].id;
  return (
    <div className="space-y-6">
      {live}
      <label className="block max-w-sm text-sm text-gray-800">
        {t("propertyLabel")}
        <select
          id="revenue-property"
          className={inputClass}
          value={selected}
          onChange={(e) => {
            setPropertyId(e.target.value);
            setAnnounce(t("loading"));
          }}
        >
          {data.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
      </label>
      <PropertyRevenue key={selected} propertyId={selected} onAnnounce={setAnnounce} />
    </div>
  );
}
