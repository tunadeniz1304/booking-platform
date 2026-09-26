"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useFormat } from "@/i18n/use-format";
import { apiFetch } from "@/lib/api-client";
import { publishStaySelection } from "@/components/booking/stay-selection";

/**
 * Esnek tarih fiyat takvimi (v4 P1-3): ay ızgarası, her gece için en ucuz 1 gecelik fiyat.
 *
 * Erişilebilirlik: renk tek sinyal değildir — her hücrede fiyat METNİ, en ucuz gece için
 * "★ En ucuz" etiketi, müsait olmayan günlerde "—" + üstü çizili gün; her düğmenin
 * `aria-label`'ı tarih + tam fiyat + seviye adını içerir. Seçim `aria-pressed` ile duyurulur,
 * durum mesajları `aria-live` bölgesindedir. Seçilen tarihler rezervasyon formunu doldurur.
 */

interface CalendarDay {
  date: string;
  available: boolean;
  priceMinor: number | null;
  cheapest: boolean;
  band: number | null;
  cheap: boolean;
  minStay: number | null;
  closedToArrival: boolean;
  past: boolean;
}

interface CalendarMonth {
  month: string;
  currency: string;
  taxMode: "included" | "excluded";
  guests: number;
  days: CalendarDay[];
  minPriceMinor: number | null;
}

/** Bant → arka plan (açık ton; metin daima koyu gri, WCAG AA kontrastı). */
const BAND_CLASSES = [
  "bg-emerald-100 border-emerald-300",
  "bg-lime-50 border-lime-300",
  "bg-amber-50 border-amber-300",
  "bg-orange-100 border-orange-300",
  "bg-rose-100 border-rose-300",
] as const;
const BAND_KEYS = ["band0", "band1", "band2", "band3", "band4"] as const;

function monthKey(d: Date): string {
  return d.toISOString().slice(0, 7);
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  return monthKey(new Date(Date.UTC(y, m - 1 + delta, 1)));
}

function addDaysIso(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Pazartesi başlangıçlı haftalara böler (baştaki boşluklar null). */
function weeksOf(days: CalendarDay[]): Array<Array<CalendarDay | null>> {
  if (days.length === 0) return [];
  const first = new Date(`${days[0].date}T00:00:00.000Z`).getUTCDay();
  const lead = (first + 6) % 7;
  const cells: Array<CalendarDay | null> = [...Array<null>(lead).fill(null), ...days];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: Array<Array<CalendarDay | null>> = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** Kısa (kuruşsuz) para metni; para birimi Intl'de yoksa null. */
function formatShortPrice(minor: number, currency: string, locale: string): string | null {
  try {
    const fractionDigits =
      new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
        .maximumFractionDigits ?? 2;
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(minor / 10 ** fractionDigits);
  } catch {
    return null;
  }
}

export default function PriceCalendar({
  propertyId,
  initialCheckIn,
}: {
  propertyId: string;
  initialCheckIn?: string;
}) {
  const t = useTranslations("property.calendar");
  const f = useFormat();
  const currentMonth = monthKey(new Date());
  const [month, setMonth] = useState(() =>
    initialCheckIn && /^\d{4}-\d{2}-\d{2}$/.test(initialCheckIn) && initialCheckIn >= currentMonth
      ? initialCheckIn.slice(0, 7)
      : currentMonth
  );
  const [taxesIncluded, setTaxesIncluded] = useState(true);
  const [checkIn, setCheckIn] = useState<string | null>(null);
  const [checkOut, setCheckOut] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const taxes = taxesIncluded ? "included" : "excluded";
  const requestKey = `${propertyId}|${month}|${taxes}`;
  /** Son tamamlanan isteğin sonucu; anahtar değişince yükleniyor durumu türetilir. */
  const [result, setResult] = useState<{
    key: string;
    data: CalendarMonth | null;
    error: boolean;
  } | null>(null);
  const loading = result?.key !== requestKey;
  const data = loading ? null : (result?.data ?? null);
  const error = !loading && (result?.error ?? false);

  useEffect(() => {
    let cancelled = false;
    const key = `${propertyId}|${month}|${taxes}`;
    apiFetch<CalendarMonth>(
      `/api/properties/${encodeURIComponent(propertyId)}/calendar-prices?month=${month}&taxes=${taxes}`
    )
      .then((res) => {
        if (!cancelled) setResult({ key, data: res, error: false });
      })
      .catch(() => {
        if (!cancelled) setResult({ key, data: null, error: true });
      });
    return () => {
      cancelled = true;
    };
  }, [propertyId, month, taxes]);

  const weeks = useMemo(() => weeksOf(data?.days ?? []), [data]);
  const weekdayNames = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(f.locale, { weekday: "short", timeZone: "UTC" });
    // 2024-01-01 Pazartesi.
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(Date.UTC(2024, 0, 1 + i))));
  }, [f.locale]);
  const monthTitle = useMemo(
    () =>
      new Intl.DateTimeFormat(f.locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(
        new Date(`${month}-01T00:00:00.000Z`)
      ),
    [f.locale, month]
  );
  const shortPrice = (minor: number) =>
    data ? (formatShortPrice(minor, data.currency, f.locale) ?? f.money(minor, data.currency)) : "";

  const selectDay = (day: CalendarDay) => {
    if (!day.available) return;
    if (checkIn && !checkOut && day.date > checkIn) {
      setCheckOut(day.date);
      publishStaySelection({ checkIn, checkOut: day.date });
      setStatus(
        t("selected", { checkIn: f.date(checkIn, "medium"), checkOut: f.date(day.date, "medium") })
      );
      return;
    }
    if (day.closedToArrival) {
      setStatus(t("closedToArrivalHint", { date: f.date(day.date, "medium") }));
      return;
    }
    const out = addDaysIso(day.date, Math.max(1, day.minStay ?? 1));
    setCheckIn(day.date);
    setCheckOut(null);
    publishStaySelection({ checkIn: day.date, checkOut: out });
    setStatus(t("selectCheckOut", { date: f.date(day.date, "medium") }));
  };

  const inRange = (date: string) =>
    checkIn !== null &&
    (date === checkIn || (checkOut !== null && date > checkIn && date < checkOut));

  return (
    <section className="mt-8" aria-labelledby="price-calendar-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="price-calendar-title" className="text-xl font-semibold text-gray-900">
          {t("title")}
        </h2>
        <label className="flex items-center gap-2 text-sm text-gray-800">
          <input
            type="checkbox"
            checked={taxesIncluded}
            onChange={(e) => setTaxesIncluded(e.target.checked)}
            className="h-4 w-4"
          />
          {t("taxesToggle")}
        </label>
      </div>
      <p className="mt-1 text-sm text-gray-600">
        {t(taxesIncluded ? "subtitleIncluded" : "subtitleExcluded", { guests: data?.guests ?? 1 })}
      </p>

      <div className="mt-3 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setMonth((m) => shiftMonth(m, -1))}
          disabled={month <= currentMonth}
          className="rounded-md border border-gray-400 px-3 py-1 text-sm text-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label={t("prevMonth")}
        >
          <span aria-hidden="true">‹</span> {t("prevMonthShort")}
        </button>
        <p className="text-base font-medium capitalize text-gray-900" aria-live="polite">
          {monthTitle}
        </p>
        <button
          type="button"
          onClick={() => setMonth((m) => shiftMonth(m, 1))}
          className="rounded-md border border-gray-400 px-3 py-1 text-sm text-gray-900"
          aria-label={t("nextMonth")}
        >
          {t("nextMonthShort")} <span aria-hidden="true">›</span>
        </button>
      </div>

      {loading && (
        <p className="mt-3 text-sm text-gray-600" role="status">
          {t("loading")}
        </p>
      )}
      {error && !loading && (
        <p className="mt-3 text-sm text-red-700" role="alert">
          {t("error")}
        </p>
      )}

      {data && !loading && (
        <>
          <table className="mt-3 w-full table-fixed border-separate border-spacing-1">
            <caption className="sr-only">{t("caption", { month: monthTitle })}</caption>
            <thead>
              <tr>
                {weekdayNames.map((name) => (
                  <th key={name} scope="col" className="text-xs font-medium text-gray-600">
                    {name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeks.map((week, wi) => (
                <tr key={wi}>
                  {week.map((day, di) => {
                    if (!day) return <td key={di} />;
                    const dayNum = Number(day.date.slice(8));
                    const dateLabel = f.date(day.date, "long");
                    if (!day.available || day.priceMinor === null || day.band === null) {
                      return (
                        <td key={day.date}>
                          <button
                            type="button"
                            disabled
                            aria-label={t(day.past ? "dayAriaPast" : "dayAriaUnavailable", {
                              date: dateLabel,
                            })}
                            className="flex h-14 w-full flex-col items-center justify-center rounded-md border border-dashed border-gray-300 bg-gray-50 text-gray-500"
                          >
                            <span className="text-xs line-through">{dayNum}</span>
                            <span className="text-[11px]" aria-hidden="true">
                              —
                            </span>
                          </button>
                        </td>
                      );
                    }
                    const level = t(`legend.${BAND_KEYS[day.band]}`);
                    const extras = [
                      day.cheapest ? t("cheapestAria") : null,
                      day.minStay ? t("minStay", { count: day.minStay }) : null,
                      day.closedToArrival ? t("closedToArrival") : null,
                    ]
                      .filter(Boolean)
                      .join(", ");
                    const selected = inRange(day.date);
                    return (
                      <td key={day.date}>
                        <button
                          type="button"
                          onClick={() => selectDay(day)}
                          aria-pressed={selected}
                          aria-label={t("dayAria", {
                            date: dateLabel,
                            price: f.money(day.priceMinor, data.currency),
                            level,
                            extras: extras ? `, ${extras}` : "",
                          })}
                          className={`flex h-14 w-full flex-col items-center justify-center rounded-md border text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#003580] ${
                            BAND_CLASSES[day.band]
                          } ${selected ? "ring-2 ring-[#003580]" : ""} ${
                            day.cheapest ? "border-2 border-emerald-700 font-semibold" : ""
                          }`}
                        >
                          <span className="text-xs">{dayNum}</span>
                          <span className="text-[11px] leading-tight">
                            {shortPrice(day.priceMinor)}
                          </span>
                          {day.cheapest && (
                            <span
                              className="text-[10px] leading-tight text-emerald-900"
                              aria-hidden="true"
                            >
                              ★ {t("cheapest")}
                            </span>
                          )}
                          {!day.cheapest && day.minStay && (
                            <span
                              className="text-[10px] leading-tight text-gray-700"
                              aria-hidden="true"
                            >
                              {t("minStayShort", { count: day.minStay })}
                            </span>
                          )}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>

          {data.minPriceMinor === null && (
            <p className="mt-2 text-sm text-gray-700">{t("noPrices")}</p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-gray-800">
            <span className="font-medium">{t("legend.title")}:</span>
            {BAND_KEYS.map((key, i) => (
              <span key={key} className="flex items-center gap-1">
                <span
                  className={`inline-block h-3 w-3 rounded-sm border ${BAND_CLASSES[i]}`}
                  aria-hidden="true"
                />
                {t(`legend.${key}`)}
              </span>
            ))}
            <span className="flex items-center gap-1">
              <span aria-hidden="true">★</span> {t("cheapest")}
            </span>
            <span className="flex items-center gap-1">
              <span aria-hidden="true">—</span> {t("unavailable")}
            </span>
          </div>
        </>
      )}

      <p className="mt-2 text-sm text-gray-700" aria-live="polite">
        {status || t("selectHint")}
      </p>
      <p className="mt-1 text-xs text-gray-500">{t("estimateNote")}</p>
    </section>
  );
}
