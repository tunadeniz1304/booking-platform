"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import { useFormat } from "@/i18n/use-format";
import { apiFetch } from "@/lib/api-client";
import {
  publishStaySelection,
  subscribeStaySelection,
  type StaySelection,
} from "@/components/booking/stay-selection";
import { publishStaySelectionClear } from "@/components/booking/stay-selection-clear";
import { focusRing } from "@/components/ui/ui";

/**
 * Esnek tarih fiyat takvimi (v4 P1-3): ay ızgarası, her gece için en ucuz 1 gecelik fiyat.
 *
 * Erişilebilirlik: renk tek sinyal değildir — her hücrede fiyat METNİ, gerçek fırsat günü için
 * "★ En ucuz", girişe kapalı günde "⊘ Giriş yok", en az konaklamada "min N gece", dolu günlerde
 * "Dolu" (geçmiş günler yalnız soluk numara), seçimin uçlarında "Giriş"/"Çıkış" metni; dar
 * ekranda kısaltmalar lejantta açıklanır. Her düğmenin `aria-label`'ı tarih + tam fiyat + seviye
 * + seçimdeki rolünü (giriş/çıkış/konaklama gecesi) içerir; `aria-pressed` kullanılmaz (aynı güne
 * yeniden basmak seçimi kaldırmaz, yeni giriş başlatır).
 * Izgara tek Tab durağıdır (roving tabindex); ok/Home/End/PageUp/PageDown ile gezilir.
 * Seçim rezervasyon formuyla iki yönlü eşitlenir; durum mesajları `aria-live` bölgesindedir.
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
  /** Fiyat ufkunun son günü (YYYY-MM-DD); sunucu göndermiyorsa ileri gezinme sınırsızdır. */
  horizonEnd?: string;
}

type RangeRole = "start" | "end" | "between";

interface CellMark {
  /** `sm` ve üstünde görünen metin. */
  text: string;
  /** Dar ekranda (`sm` altı) görünen kısa metin; yoksa `text`. */
  short?: string;
  className: string;
}

interface DayCellView {
  selectable: boolean;
  label: string;
  className: string;
  /** Sembollü kısa fiyat ve dar ekran için sembolsüz sayı. */
  price: ShortPrice | null;
  marks: CellMark[];
}

interface ShortPrice {
  full: string;
  bare: string;
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
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Gün odağı kesikli çizgi: seçim halkasından ayırt edilir. */
const DAY_FOCUS =
  "focus-visible:outline focus-visible:outline-dashed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#003580]";
const UNAVAILABLE_CLASS = "border border-dashed border-gray-300 bg-gray-50 text-gray-500";
/** Geçmiş/ufuk ötesi gün: çerçevesiz, yalnız soluk gün numarası. */
const MUTED_CLASS = "text-gray-500";
/** Giriş/çıkış günü kalın, aradaki geceler ince halka. */
const RING_ENDPOINT = "ring-4 ring-inset ring-[#003580]";
const RING_BETWEEN = "ring-2 ring-inset ring-[#003580]";
/** "En ucuz" işareti yalnız fiyatlar farklıyken ve en çok bu kadar gecede anlam taşır. */
const MAX_CHEAPEST_MARKS = 3;
const KEYS_HINT_ID = "price-calendar-keys";
/** Sunucu fiyat ufkunu bildirmezse ay seçicide gösterilen ileri ay sayısı. */
const FALLBACK_MONTHS_AHEAD = 12;

function monthKey(d: Date): string {
  return d.toISOString().slice(0, 7);
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  return monthKey(new Date(Date.UTC(y, m - 1 + delta, 1)));
}

function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function addDaysIso(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Pazartesi=0 … Pazar=6. */
function weekdayIndex(date: string): number {
  return (new Date(`${date}T00:00:00.000Z`).getUTCDay() + 6) % 7;
}

function isPriced(d: CalendarDay): d is CalendarDay & { priceMinor: number; band: number } {
  return d.available && d.priceMinor !== null && d.band !== null;
}

/** Pazartesi başlangıçlı haftalara böler (baştaki boşluklar null). */
function weeksOf(days: CalendarDay[]): Array<Array<CalendarDay | null>> {
  if (days.length === 0) return [];
  const lead = weekdayIndex(days[0].date);
  const cells: Array<CalendarDay | null> = [...Array<null>(lead).fill(null), ...days];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: Array<Array<CalendarDay | null>> = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** Kısa (kuruşsuz) fiyat: sembollü ve sembolsüz metin; para birimi Intl'de yoksa null. */
function formatShortPrice(minor: number, currency: string, locale: string): ShortPrice | null {
  try {
    const fractionDigits =
      new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
        .maximumFractionDigits ?? 2;
    const value = minor / 10 ** fractionDigits;
    return {
      full: new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
      }).format(value),
      bare: new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value),
    };
  } catch {
    return null;
  }
}

/** Para birimi sembolü (ör. "₺"); bulunamazsa para birimi kodu. */
function currencySymbol(currency: string, locale: string): string {
  try {
    const part = new Intl.NumberFormat(locale, { style: "currency", currency })
      .formatToParts(0)
      .find((p) => p.type === "currency");
    return part?.value ?? currency;
  } catch {
    return currency;
  }
}

export default function PriceCalendar({
  propertyId,
  initialCheckIn,
  initialCheckOut,
  totalPriceRequired = false,
}: {
  propertyId: string;
  initialCheckIn?: string;
  /** Aramadan gelen çıkış tarihi; girişle birlikte geçerliyse takvim bu aralıkla açılır. */
  initialCheckOut?: string;
  /** Pazar vergi dahil toplam fiyatı zorunlu tutuyorsa vergi hariç gösterim sunulmaz. */
  totalPriceRequired?: boolean;
}) {
  const t = useTranslations("property.calendar");
  const f = useFormat();
  const currentMonth = monthKey(new Date());
  const initialStay =
    initialCheckIn !== undefined &&
    initialCheckOut !== undefined &&
    ISO_DAY.test(initialCheckIn) &&
    ISO_DAY.test(initialCheckOut) &&
    initialCheckIn < initialCheckOut;
  const [month, setMonth] = useState(() =>
    initialCheckIn && ISO_DAY.test(initialCheckIn) && initialCheckIn >= currentMonth
      ? initialCheckIn.slice(0, 7)
      : currentMonth
  );
  const [taxesIncluded, setTaxesIncluded] = useState(true);
  const [checkIn, setCheckIn] = useState<string | null>(
    initialStay ? (initialCheckIn ?? null) : null
  );
  const [checkOut, setCheckOut] = useState<string | null>(
    initialStay ? (initialCheckOut ?? null) : null
  );
  /** Seçilen giriş gününün en az konaklama kuralı (çıkış doğrulaması için). */
  const [checkInMinStay, setCheckInMinStay] = useState(1);
  const [status, setStatus] = useState("");
  const [retry, setRetry] = useState(0);
  /** Sunucunun bildirdiği fiyat ufku (YYYY-MM-DD); bilinmiyorsa null. */
  const [horizonEnd, setHorizonEnd] = useState<string | null>(null);
  /** Klavyeyle gezilen gün (roving tabindex). */
  const [focusedDate, setFocusedDate] = useState<string | null>(null);
  const dayRefs = useRef(new Map<string, HTMLButtonElement>());
  const retryRef = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef(false);
  const publishing = useRef(false);
  const taxes = taxesIncluded || totalPriceRequired ? "included" : "excluded";
  const requestKey = `${propertyId}|${month}|${taxes}|${retry}`;
  /** Son tamamlanan isteğin sonucu; anahtar değişince yükleniyor durumu türetilir. */
  const [result, setResult] = useState<{
    key: string;
    data: CalendarMonth | null;
    error: boolean;
  } | null>(null);
  const loading = result?.key !== requestKey;
  const data = loading ? null : (result?.data ?? null);
  const error = !loading && (result?.error ?? false);
  /** Yüklenirken önceki ızgara soluk olarak yerinde kalır (sayfa yüksekliği zıplamaz). */
  const view = data ?? (loading ? (result?.data ?? null) : null);
  const stale = loading && view !== null;

  useEffect(() => {
    let cancelled = false;
    const key = `${propertyId}|${month}|${taxes}|${retry}`;
    apiFetch<CalendarMonth>(
      `/api/properties/${encodeURIComponent(propertyId)}/calendar-prices?month=${month}&taxes=${taxes}`
    )
      .then((res) => {
        if (cancelled) return;
        setResult({ key, data: res, error: false });
        if (res.horizonEnd && ISO_DAY.test(res.horizonEnd.slice(0, 10))) {
          setHorizonEnd(res.horizonEnd.slice(0, 10));
        }
      })
      .catch(() => {
        if (!cancelled) setResult({ key, data: null, error: true });
      });
    return () => {
      cancelled = true;
    };
  }, [propertyId, month, taxes, retry]);

  // Rezervasyon formunda değişen tarihler takvime de yansır: sayfada tek seçili aralık olur.
  useEffect(
    () =>
      subscribeStaySelection((s) => {
        if (publishing.current) return;
        setCheckIn(s.checkIn);
        setCheckOut(s.checkOut);
        setCheckInMinStay(1);
        setFocusedDate(null);
        setStatus("");
        if (s.checkIn.slice(0, 7) >= monthKey(new Date())) setMonth(s.checkIn.slice(0, 7));
      }),
    []
  );

  // Klavyeyle ay değişince odak yeni ay yüklenince hedef güne (hatada yeniden denemeye) taşınır.
  useEffect(() => {
    if (!pendingFocus.current) return;
    if (error) {
      pendingFocus.current = false;
      retryRef.current?.focus();
      return;
    }
    const el = focusedDate ? dayRefs.current.get(focusedDate) : undefined;
    if (!el) return;
    pendingFocus.current = false;
    el.focus();
  });

  /** Olay eşzamanlı dağıtılır; kendi yayınımız abonelikte yok sayılır. */
  const publish = (selection: StaySelection) => {
    publishing.current = true;
    try {
      publishStaySelection(selection);
    } finally {
      publishing.current = false;
    }
  };

  const weeks = useMemo(() => weeksOf(view?.days ?? []), [view]);
  const weekdayNames = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(f.locale, { weekday: "short", timeZone: "UTC" });
    // 2024-01-01 Pazartesi.
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(Date.UTC(2024, 0, 1 + i))));
  }, [f.locale]);
  const monthFormat = useMemo(
    () => new Intl.DateTimeFormat(f.locale, { month: "long", year: "numeric", timeZone: "UTC" }),
    [f.locale]
  );
  const titleOf = (m: string) => monthFormat.format(new Date(`${m.slice(0, 7)}-01T00:00:00.000Z`));
  const monthTitle = titleOf(month);
  const horizonMonth = horizonEnd?.slice(0, 7) ?? null;
  const atHorizon = horizonMonth !== null && month >= horizonMonth;
  /** Ay seçici: bu aydan fiyat ufkunun ayına (bilinmiyorsa 12 ay ileriye) kadar. */
  const monthOptions = useMemo(() => {
    const last = horizonMonth ?? shiftMonth(currentMonth, FALLBACK_MONTHS_AHEAD);
    const options: string[] = [];
    for (let m = currentMonth; m <= last; m = shiftMonth(m, 1)) options.push(m);
    if (!options.includes(month)) options.push(month);
    return options.sort();
  }, [currentMonth, horizonMonth, month]);

  /** Tüm geceler aynı fiyattaysa bant ve "en ucuz" işareti bilgi taşımaz. */
  const priceStats = useMemo(() => {
    const days = view?.days ?? [];
    const priced = days.filter(isPriced);
    const distinct = new Set(priced.map((d) => d.priceMinor)).size;
    const cheapestCount = priced.filter((d) => d.cheapest).length;
    return {
      uniform: distinct === 1,
      showCheapest: distinct > 1 && cheapestCount <= MAX_CHEAPEST_MARKS,
      minStay: priced.some((d) => (d.minStay ?? 1) > 1),
      closedToArrival: priced.some((d) => d.closedToArrival),
      booked: days.some(
        (d) => !d.past && !isPriced(d) && !(horizonEnd !== null && d.date > horizonEnd)
      ),
    };
  }, [view, horizonEnd]);

  /** Giriş seçiliyken çıkış olarak seçilebilen ilk dolu/fiyatsız gün (o gece konaklanmaz). */
  const checkoutOnlyDate = useMemo(() => {
    if (!checkIn || checkOut || !view) return null;
    const blocked = view.days.find((d) => d.date > checkIn && !d.past && !isPriced(d));
    return blocked?.date ?? null;
  }, [checkIn, checkOut, view]);

  /** Izgaradaki tek Tab durağı: gezilen gün, yoksa giriş günü, yoksa ilk müsait gün. */
  const activeDate = useMemo(() => {
    const days = view?.days ?? [];
    const inGrid = (d: string | null) => d !== null && days.some((x) => x.date === d);
    if (inGrid(focusedDate)) return focusedDate;
    if (inGrid(checkIn)) return checkIn;
    const open = days.find((d) => !d.past && d.available) ?? days.find((d) => !d.past);
    return (open ?? days[0])?.date ?? null;
  }, [view, focusedDate, checkIn]);

  const moveFocus = (target: string) => {
    const targetMonth = target.slice(0, 7);
    if (targetMonth < currentMonth) return;
    if (horizonMonth !== null && targetMonth > horizonMonth) return;
    setFocusedDate(target);
    pendingFocus.current = true;
    if (targetMonth !== month) setMonth(targetMonth);
  };

  const handleDayKeyDown = (e: KeyboardEvent<HTMLButtonElement>, date: string) => {
    // Ay yüklenirken odak eski ızgarada kalır; gezinme hedef günden devam eder.
    const base = loading && focusedDate ? focusedDate : date;
    const weekday = weekdayIndex(base);
    let target: string;
    switch (e.key) {
      case "ArrowLeft":
        target = addDaysIso(base, -1);
        break;
      case "ArrowRight":
        target = addDaysIso(base, 1);
        break;
      case "ArrowUp":
        target = addDaysIso(base, -7);
        break;
      case "ArrowDown":
        target = addDaysIso(base, 7);
        break;
      case "Home":
        target = addDaysIso(base, -weekday);
        break;
      case "End":
        target = addDaysIso(base, 6 - weekday);
        break;
      case "PageUp":
      case "PageDown": {
        const next = shiftMonth(base.slice(0, 7), e.key === "PageUp" ? -1 : 1);
        const day = Math.min(Number(base.slice(8)), daysInMonth(next));
        target = `${next}-${String(day).padStart(2, "0")}`;
        break;
      }
      default:
        return;
    }
    e.preventDefault();
    moveFocus(target);
  };

  const selectDay = (day: CalendarDay) => {
    if (loading || !data) return;
    setFocusedDate(day.date);
    if (checkIn && !checkOut && day.date > checkIn) {
      const nights = Math.round(
        (Date.parse(`${day.date}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86_400_000
      );
      if (nights < checkInMinStay) {
        setStatus(t("minStayError", { count: checkInMinStay }));
        return;
      }
      // Aradaki gecelerden (yüklü ayda) dolu olan varsa seçimi yayınlama.
      const blockedNight = data.days.find(
        (d) => d.date >= checkIn && d.date < day.date && !isPriced(d)
      );
      if (blockedNight) {
        setStatus(t("rangeBlocked", { date: f.date(blockedNight.date, "medium") }));
        return;
      }
      setCheckOut(day.date);
      publish({ checkIn, checkOut: day.date });
      setStatus(
        t("selected", { checkIn: f.date(checkIn, "medium"), checkOut: f.date(day.date, "medium") })
      );
      return;
    }
    if (!day.available) return;
    if (day.closedToArrival) {
      setStatus(t("closedToArrivalHint", { date: f.date(day.date, "medium") }));
      return;
    }
    const out = addDaysIso(day.date, Math.max(1, day.minStay ?? 1));
    setCheckIn(day.date);
    setCheckInMinStay(Math.max(1, day.minStay ?? 1));
    setCheckOut(null);
    publish({ checkIn: day.date, checkOut: out });
    setStatus(
      t("selectCheckOut", { date: f.date(day.date, "medium"), checkOut: f.date(out, "medium") })
    );
  };

  /** Seçimi geri alır; düğme kaybolacağı için odak ızgaradaki etkin güne taşınır. */
  const clearSelection = () => {
    const target = activeDate;
    setCheckIn(null);
    setCheckOut(null);
    setCheckInMinStay(1);
    setFocusedDate(target);
    publishStaySelectionClear();
    setStatus(t("selectionCleared"));
    const el = target ? dayRefs.current.get(target) : undefined;
    el?.focus();
  };

  const rangeRole = (date: string): RangeRole | null => {
    if (checkIn === null) return null;
    if (date === checkIn) return "start";
    if (checkOut === null) return null;
    if (date === checkOut) return "end";
    return date > checkIn && date < checkOut ? "between" : null;
  };

  const dayCell = (day: CalendarDay, currency: string): DayCellView => {
    const dateLabel = f.date(day.date, "long");
    const role = rangeRole(day.date);
    const endpoint = role === "start" || role === "end";
    const ring = endpoint ? RING_ENDPOINT : role === "between" ? RING_BETWEEN : "";
    const roleMark: CellMark | null = endpoint
      ? { text: t(role === "start" ? "rangeStart" : "rangeEnd"), className: "font-semibold" }
      : null;
    const roleAria = role ? t(`rangeAria.${role}`) : null;
    if (day.date === checkoutOnlyDate) {
      return {
        selectable: true,
        label: t("dayAriaCheckoutOnly", { date: dateLabel }),
        className: UNAVAILABLE_CLASS,
        price: null,
        marks: [{ text: t("checkoutOnly"), className: "" }],
      };
    }
    if (!isPriced(day)) {
      const beyondHorizon = !day.past && horizonEnd !== null && day.date > horizonEnd;
      const muted = day.past || beyondHorizon;
      let base = t("dayAriaUnavailable", { date: dateLabel });
      if (day.past) base = t("dayAriaPast", { date: dateLabel });
      else if (beyondHorizon) base = t("dayAriaBeyondHorizon", { date: dateLabel });
      let marks: CellMark[] = [];
      if (roleMark) marks = [roleMark];
      else if (!muted) marks = [{ text: t("booked"), className: "" }];
      return {
        selectable: false,
        label: roleAria ? `${base}, ${roleAria}` : base,
        className: `${muted ? MUTED_CLASS : UNAVAILABLE_CLASS} ${ring}`,
        price: null,
        marks,
      };
    }
    const markCheapest = priceStats.showCheapest && day.cheapest;
    const minStay = day.minStay !== null && day.minStay > 1 ? day.minStay : null;
    const extras = [
      roleAria,
      markCheapest ? t("cheapestAria") : null,
      minStay ? t("minStay", { count: minStay }) : null,
      day.closedToArrival ? t("closedToArrival") : null,
    ]
      .filter(Boolean)
      .join(", ");
    const price = f.money(day.priceMinor, currency);
    const extrasText = extras ? `, ${extras}` : "";
    const cheapClass = markCheapest ? "border-2 border-emerald-700 font-semibold" : "";
    const marks: CellMark[] = [];
    if (roleMark) {
      marks.push(roleMark);
    } else {
      if (markCheapest) {
        marks.push({ text: `★ ${t("cheapest")}`, short: "★", className: "text-emerald-900" });
      }
      if (minStay) {
        marks.push({
          text: t("minStayShort", { count: minStay }),
          short: t("minStayTiny", { count: minStay }),
          className: "text-gray-700",
        });
      }
      if (day.closedToArrival) {
        marks.push({
          text: `⊘ ${t("closedToArrivalMark")}`,
          short: "⊘",
          className: "text-gray-700",
        });
      }
    }
    const shortPrice = formatShortPrice(day.priceMinor, currency, f.locale);
    return {
      selectable: true,
      label: priceStats.uniform
        ? t("dayAriaUniform", { date: dateLabel, price, extras: extrasText })
        : t("dayAria", {
            date: dateLabel,
            price,
            level: t(`legend.${BAND_KEYS[day.band]}`),
            extras: extrasText,
          }),
      className: `border text-gray-900 ${BAND_CLASSES[day.band]} ${ring} ${cheapClass}`,
      price: shortPrice ?? { full: price, bare: price },
      marks,
    };
  };

  /** Ayın tamamı fiyat ufkunun ötesindeyse "müsait gece yok" yerine yalnız ufuk notu gösterilir. */
  const viewBeyondHorizon =
    view !== null && horizonEnd !== null && `${view.month.slice(0, 7)}-01` > horizonEnd;

  // Seçim (formdan gelse de) görünür kalır; hata varken seçim ipucu gösterilmez.
  let idleText = error ? "" : t("selectHint");
  if (checkIn && checkOut) {
    idleText = t("currentSelection", {
      checkIn: f.date(checkIn, "medium"),
      checkOut: f.date(checkOut, "medium"),
    });
  }

  return (
    <section className="mt-8" aria-labelledby="price-calendar-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="price-calendar-title" className="text-xl font-semibold text-gray-900">
          {t("title")}
        </h2>
        {!totalPriceRequired && (
          <label className="flex items-center gap-2 text-sm text-gray-800">
            <input
              type="checkbox"
              checked={taxesIncluded}
              onChange={(e) => setTaxesIncluded(e.target.checked)}
              className="h-4 w-4"
            />
            {t("taxesToggle")}
          </label>
        )}
      </div>
      <p className="mt-1 text-sm text-gray-600">
        {t(taxes === "included" ? "subtitleIncluded" : "subtitleExcluded", {
          guests: view?.guests ?? 1,
        })}
      </p>

      <div className="mt-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setMonth((m) => shiftMonth(m, -1))}
          disabled={month <= currentMonth}
          className="rounded-md border border-gray-400 px-3 py-1 text-sm text-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label={t("prevMonth")}
        >
          <span aria-hidden="true">‹</span> {t("prevMonthShort")}
        </button>
        {/* Uzak aya tek adımda atlanır; ay değişimi ayrıca duyurulur. */}
        <select
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          aria-label={t("monthSelect")}
          className={`min-w-0 rounded-md border border-gray-400 bg-white px-2 py-1 text-base font-medium capitalize text-gray-900 ${focusRing}`}
        >
          {monthOptions.map((m) => (
            <option key={m} value={m}>
              {titleOf(m)}
            </option>
          ))}
        </select>
        <p className="sr-only" aria-live="polite">
          {monthTitle}
        </p>
        <button
          type="button"
          onClick={() => setMonth((m) => shiftMonth(m, 1))}
          disabled={atHorizon}
          className="rounded-md border border-gray-400 px-3 py-1 text-sm text-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label={t("nextMonth")}
        >
          {t("nextMonthShort")} <span aria-hidden="true">›</span>
        </button>
      </div>
      {atHorizon && horizonEnd && (
        <p className="mt-2 text-sm text-gray-700">
          {t("horizonNote", { date: f.date(horizonEnd, "medium") })}
        </p>
      )}

      {/* İlk yüklemede yer tutucu yüksekliği ayırır; sonraki yüklemelerde yalnız duyurulur. */}
      <p
        role="status"
        className={view || error ? "sr-only" : "mt-3 min-h-[23rem] text-sm text-gray-600"}
      >
        {loading ? t("loading") : ""}
      </p>
      {error && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="text-sm text-red-700" role="alert">
            {t("error")}
          </p>
          <button
            ref={retryRef}
            type="button"
            onClick={() => setRetry((n) => n + 1)}
            className={`inline-flex min-h-[44px] items-center rounded-md border border-gray-400 px-3 py-1 text-sm text-gray-900 sm:min-h-0 ${focusRing}`}
          >
            {t("retry")}
          </button>
        </div>
      )}

      {view && (
        <>
          <p id={KEYS_HINT_ID} className="sr-only">
            {t("keyboardHint")}
          </p>
          {/* Dar ekranda hücrelerde para sembolü gösterilmez; birim burada belirtilir. */}
          <p className="mt-2 text-xs text-gray-600 sm:hidden">
            {t("currencyNote", { currency: currencySymbol(view.currency, f.locale) })}
          </p>
          <table
            aria-busy={stale || undefined}
            aria-describedby={KEYS_HINT_ID}
            className={`mt-3 w-full table-fixed border-separate border-spacing-1 ${stale ? "opacity-60" : ""}`}
          >
            <caption className="sr-only">{t("caption", { month: titleOf(view.month) })}</caption>
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
                    const cell = dayCell(day, view.currency);
                    return (
                      <td key={day.date}>
                        <button
                          ref={(el) => {
                            if (el) dayRefs.current.set(day.date, el);
                            else dayRefs.current.delete(day.date);
                          }}
                          type="button"
                          tabIndex={day.date === activeDate ? 0 : -1}
                          aria-disabled={cell.selectable ? undefined : true}
                          aria-label={cell.label}
                          onClick={cell.selectable ? () => selectDay(day) : undefined}
                          onKeyDown={(e) => handleDayKeyDown(e, day.date)}
                          className={`flex min-h-14 w-full flex-col items-center justify-center rounded-md py-1 ${DAY_FOCUS} ${cell.className}`}
                        >
                          <span className="text-xs">{Number(day.date.slice(8))}</span>
                          {cell.price && (
                            <span className="text-xs leading-tight">
                              <span className="sm:hidden">{cell.price.bare}</span>
                              <span className="hidden sm:inline">{cell.price.full}</span>
                            </span>
                          )}
                          {cell.marks.length > 0 && (
                            <span
                              className="flex flex-wrap justify-center gap-x-1 text-xs leading-tight"
                              aria-hidden="true"
                            >
                              {cell.marks.map((m) => (
                                <span key={m.text} className={m.className}>
                                  {m.short === undefined ? (
                                    m.text
                                  ) : (
                                    <>
                                      <span className="sm:hidden">{m.short}</span>
                                      <span className="hidden sm:inline">{m.text}</span>
                                    </>
                                  )}
                                </span>
                              ))}
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

          {view.minPriceMinor === null && !viewBeyondHorizon && (
            <p className="mt-2 text-sm text-gray-700">{t("noPrices")}</p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-gray-800">
            {priceStats.uniform ? (
              <span className="font-medium">{t("uniformPrice")}</span>
            ) : (
              <>
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
              </>
            )}
            {priceStats.showCheapest && (
              <span className="flex items-center gap-1">
                <span aria-hidden="true">★</span> {t("cheapest")}
              </span>
            )}
            {priceStats.minStay && <span>{t("legendMinStay")}</span>}
            {priceStats.closedToArrival && (
              <span className="flex items-center gap-1">
                <span aria-hidden="true">⊘</span> {t("legendClosedToArrival")}
              </span>
            )}
            {priceStats.booked && (
              <span className="flex items-center gap-1">
                <span className={`rounded-sm px-1 ${UNAVAILABLE_CLASS}`} aria-hidden="true">
                  {t("booked")}
                </span>
                {t("unavailable")}
              </span>
            )}
          </div>
        </>
      )}

      <p className="mt-2 text-sm text-gray-700" aria-live="polite">
        {status || idleText}
      </p>
      {checkIn && (
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <a
            href="#booking"
            className={`inline-flex min-h-[44px] items-center text-[#003580] underline sm:min-h-0 ${focusRing}`}
          >
            {t("goToBooking")}
          </a>
          <button
            type="button"
            onClick={clearSelection}
            className={`inline-flex min-h-[44px] items-center rounded-md border border-gray-400 px-3 py-1 text-gray-900 sm:min-h-0 ${focusRing}`}
          >
            {t("clearSelection")}
          </button>
        </div>
      )}
      <p className="mt-1 text-xs text-gray-500">{t("estimateNote")}</p>
    </section>
  );
}
