"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useTranslations } from "next-intl";
import { useFormat } from "@/i18n/use-format";
import { focusRing } from "@/components/ui/ui";
import { firstDayOfWeek } from "@/lib/i18n/week-start";

/**
 * Çift aylık tarih aralığı seçici (OTA'larda yaygın desen).
 * Kullanıcı giriş tarihine tıklar → seçim başlar; çıkış tarihine tıklar → aralık tamamlanır.
 * Girişten önceki bir tarihe tıklanırsa giriş yeniden ayarlanır (Booking davranışı).
 * Durum satırı adımı (giriş/çıkış) ve gece sayısını gösterir; çıkış seçilirken fare ya da
 * odaktaki güne kadar aralık önizlenir. Seçim "Tarihleri temizle" ile sıfırlanır.
 * Açılışta seçili girişin ayı gösterilir; gezinme rezervasyon ufkunda (`maxDate`) durur.
 *
 * Erişilebilirlik: her gün düğmesinin adı tam tarih + giriş/çıkış/aralık durumudur;
 * ızgara tek Tab durağıdır (roving tabindex) ve ok/Home/End/PageUp/PageDown ile gezilir.
 * Kapsayıcı dar olduğunda (ör. ilan kenar çubuğu, mobil) tek ay gösterilir.
 * Hafta dilin ilk gününden başlar (TR Pazartesi, en-US Pazar).
 */

/** İki ayın yan yana sığması için gereken asgari kök genişliği (px). */
const TWO_MONTH_MIN_WIDTH = 540;

/** Varsayılan rezervasyon ufku (gün); envanter bugünden 365 gece ileriye açılır. */
const BOOKING_HORIZON_DAYS = 365;

const DAY_MS = 24 * 60 * 60 * 1000;

const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function toISODate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseISODate(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** İki gün arasındaki gece sayısı (yaz saati geçişindeki 23/25 saatlik günlere dayanıklı). */
function nightsBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / DAY_MS);
}

/**
 * Ayın günleri; haftanın ilk gününe (`weekStart`, 0=Pazar) göre baştaki boşluklar `null`dur.
 * Önceki ayın günleri çizilmez: aksi hâlde "Kasım" altındaki 28, 28 Ekim'i seçerdi.
 */
function monthMatrix(year: number, month: number, weekStart: number): (Date | null)[] {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() - weekStart + 7) % 7;
  const days: (Date | null)[] = Array.from({ length: lead }, () => null);
  const last = new Date(year, month + 1, 0).getDate();
  for (let d = 1; d <= last; d++) days.push(new Date(year, month, d));
  return days;
}

interface DateRange {
  checkIn: string;
  checkOut: string;
}

/** Günün hangi tarih için aday olduğu: giriş seçiliyken ondan sonraki günler çıkış adayıdır. */
export type DatePickPhase = "checkIn" | "checkOut";

interface DateRangePickerProps {
  value: DateRange;
  onChange: (value: DateRange) => void;
  minDate?: Date;
  /** Seçilebilecek son gün; varsayılan bugünden 365 gün sonrası (envanter ufku). */
  maxDate?: Date;
  /** Kaç ay yan yana gösterilecek (dar kapsayıcıda otomatik olarak 1'e düşer) */
  monthCount?: number;
  /** Escape ile kapatma isteği; çağıran odağı tetikleyiciye geri vermelidir. */
  onClose?: () => void;
  /**
   * Seçilemeyen gün (ör. dolu, satışa kapalı). Gün odaklanabilir kalır (aria-disabled) ama
   * seçilmez. `phase` "checkOut" ise gün çıkış adayıdır; dolu bir gece çıkış günü olabilir.
   */
  isDateDisabled?: (iso: string, phase: DatePickPhase) => boolean;
  /** Günün erişilebilir adına eklenen kısa not (ör. "dolu", "en az 3 gece"). */
  dayNote?: (iso: string) => string | null | undefined;
}

export default function DateRangePicker({
  value,
  onChange,
  minDate = new Date(),
  maxDate,
  monthCount = 2,
  onClose,
  isDateDisabled,
  dayNote,
}: DateRangePickerProps) {
  const t = useTranslations("search");
  const f = useFormat();
  const today = startOfDay(minDate);
  const lastDay = maxDate
    ? startOfDay(maxDate)
    : new Date(today.getFullYear(), today.getMonth(), today.getDate() + BOOKING_HORIZON_DAYS);
  const baseIndex = today.getFullYear() * 12 + today.getMonth();
  // Açılışta seçili girişin ayı gösterilir (bugünün ayı değil).
  const [monthsOffset, setMonthsOffset] = useState(() => {
    const start = value.checkIn ? parseISODate(value.checkIn) : null;
    return start ? Math.max(0, start.getFullYear() * 12 + start.getMonth() - baseIndex) : 0;
  });
  const idBase = useId();

  // Kapsayıcı genişliğine göre görünür ay sayısı.
  const rootRef = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  useIsoLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => setNarrow(el.getBoundingClientRect().width < TWO_MONTH_MIN_WIDTH);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const visibleCount = narrow ? 1 : Math.max(1, monthCount);

  // Ay ve gün adları etkin dile göre Intl'den gelir.
  const monthFormat = useMemo(
    () => new Intl.DateTimeFormat(f.locale, { month: "long", year: "numeric" }),
    [f.locale]
  );
  const dayLabelFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(f.locale, {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
    [f.locale]
  );
  const weekStart = useMemo(() => firstDayOfWeek(f.locale), [f.locale]);
  const weekdays = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(f.locale, { weekday: "short" });
    // 7 Ocak 2024 pazardır; liste dilin hafta başından başlar.
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2024, 0, 7 + weekStart + i)));
  }, [f.locale, weekStart]);

  // Bugünün ayı + offset => (yıl, ay); son görünür ay ufkun ayını geçmez.
  const lastIndex = lastDay.getFullYear() * 12 + lastDay.getMonth();
  const maxOffset = Math.max(0, lastIndex - baseIndex - visibleCount + 1);
  const offset = Math.min(monthsOffset, maxOffset);
  const totalMonths = baseIndex + offset;
  const activeYear = Math.floor(totalMonths / 12);
  const activeMonth = totalMonths % 12;

  const months = useMemo(() => {
    const arr: { year: number; month: number; days: (Date | null)[] }[] = [];
    for (let i = 0; i < visibleCount; i++) {
      const m = activeMonth + i;
      const y = activeYear + Math.floor(m / 12);
      const mm = ((m % 12) + 12) % 12;
      arr.push({ year: y, month: mm, days: monthMatrix(y, mm, weekStart) });
    }
    return arr;
  }, [activeYear, activeMonth, visibleCount, weekStart]);

  const checkIn = value.checkIn ? parseISODate(value.checkIn) : null;
  const checkOut = value.checkOut ? parseISODate(value.checkOut) : null;

  const inRange = (d: Date) => {
    if (checkIn && checkOut && d > checkIn && d < checkOut) return true;
    return false;
  };

  // Çıkış seçilirken fare/odaktaki güne kadar aralık önizlemesi.
  const [previewISO, setPreviewISO] = useState<string | null>(null);
  const previewEnd = checkIn && !checkOut && previewISO ? parseISODate(previewISO) : null;
  const previewNights =
    checkIn && previewEnd && previewEnd > checkIn ? nightsBetween(checkIn, previewEnd) : 0;
  const inPreview = (d: Date) =>
    !!(checkIn && previewEnd && previewNights > 0 && d > checkIn && d <= previewEnd);

  // Girişle aynı güne çıkış için tıklandı: en az 1 gece gerektiği söylenir.
  const [sameDayNotice, setSameDayNotice] = useState(false);

  // --- Klavye gezinmesi (roving tabindex) ---
  const dayRefs = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocus = useRef(true); // açılışta odağı ızgaraya taşı
  const [focusedISO, setFocusedISO] = useState<string | null>(null);

  const isVisible = useCallback(
    (d: Date) => {
      const idx = d.getFullYear() * 12 + d.getMonth();
      return idx >= totalMonths && idx < totalMonths + visibleCount;
    },
    [totalMonths, visibleCount]
  );
  const isSelectable = (d: Date) => d >= today && d <= lastDay;

  const focusedDate = focusedISO ? parseISODate(focusedISO) : null;
  let activeISO: string;
  if (focusedDate && isVisible(focusedDate) && isSelectable(focusedDate)) {
    activeISO = toISODate(focusedDate);
  } else if (checkIn && isVisible(checkIn) && isSelectable(checkIn)) {
    activeISO = toISODate(checkIn);
  } else {
    const firstOfMonth = new Date(activeYear, activeMonth, 1);
    activeISO = toISODate(firstOfMonth < today ? today : firstOfMonth);
  }

  useEffect(() => {
    if (!pendingFocus.current) return;
    pendingFocus.current = false;
    dayRefs.current.get(activeISO)?.focus();
  });

  const moveFocusTo = (target: Date) => {
    let d = startOfDay(target);
    if (d < today) d = today;
    if (d > lastDay) d = lastDay;
    const idx = d.getFullYear() * 12 + d.getMonth();
    if (idx < totalMonths) setMonthsOffset(idx - baseIndex);
    else if (idx >= totalMonths + visibleCount) setMonthsOffset(idx - baseIndex - visibleCount + 1);
    setFocusedISO(toISODate(d));
    pendingFocus.current = true;
  };

  const handleDayKeyDown = (e: KeyboardEvent<HTMLButtonElement>, d: Date) => {
    const y = d.getFullYear();
    const m = d.getMonth();
    const day = d.getDate();
    const weekday = (d.getDay() - weekStart + 7) % 7; // haftanın ilk günü=0
    let target: Date;
    switch (e.key) {
      case "ArrowLeft":
        target = new Date(y, m, day - 1);
        break;
      case "ArrowRight":
        target = new Date(y, m, day + 1);
        break;
      case "ArrowUp":
        target = new Date(y, m, day - 7);
        break;
      case "ArrowDown":
        target = new Date(y, m, day + 7);
        break;
      case "Home":
        target = new Date(y, m, day - weekday);
        break;
      case "End":
        target = new Date(y, m, day + (6 - weekday));
        break;
      case "PageUp":
      case "PageDown": {
        const dir = e.key === "PageUp" ? -1 : 1;
        const lastOfMonth = new Date(y, m + dir + 1, 0).getDate();
        target = new Date(y, m + dir, Math.min(day, lastOfMonth));
        break;
      }
      default:
        return;
    }
    e.preventDefault();
    moveFocusTo(target);
  };

  const handleRootKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape" && onClose) {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  const handleDayClick = (d: Date, unavailable: boolean) => {
    const day = startOfDay(d);
    if (!isSelectable(day)) return; // geçmiş ya da ufuk dışı tarih seçilemez
    setFocusedISO(toISODate(day));
    if (unavailable) return; // dolu/kapalı gün (aria-disabled) seçilmez
    setSameDayNotice(false);

    if (!checkIn || (checkOut && day >= checkIn)) {
      // Yeni aralık başlat (veya mevcut aralığı temizle)
      onChange({ checkIn: toISODate(day), checkOut: "" });
    } else if (day > checkIn) {
      onChange({ checkIn: toISODate(checkIn), checkOut: toISODate(day) });
    } else if (day < checkIn) {
      // Girişten önceye tıklandı → girişi taşı
      onChange({ checkIn: toISODate(day), checkOut: "" });
    } else {
      // Girişle aynı gün: en az 1 gece gerekir; seçim korunur, yönerge gösterilir.
      setSameDayNotice(true);
    }
  };

  const clearDates = () => {
    setFocusedISO(null);
    setPreviewISO(null);
    setSameDayNotice(false);
    // Temizle düğmesi kalkacağı için odak ızgaraya taşınır.
    pendingFocus.current = true;
    onChange({ checkIn: "", checkOut: "" });
  };

  // Sınırdaki ok düğmeleri odakta kalsın diye `disabled` yerine aria-disabled kullanılır.
  const atStart = offset === 0;
  const atEnd = offset >= maxOffset;
  const goPrev = () => {
    if (!atStart) setMonthsOffset(offset - 1);
  };
  const goNext = () => {
    if (!atEnd) setMonthsOffset(offset + 1);
  };

  const isSameDay = (a: Date | null, b: Date) =>
    !!a &&
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  const nights = checkIn && checkOut ? nightsBetween(checkIn, checkOut) : 0;

  // Ekran okuyucu için seçim adımı yönergesi.
  const hint = !checkIn
    ? t("picker.hintCheckIn")
    : sameDayNotice
      ? t("picker.minOneNight")
      : !checkOut
        ? t("picker.hintCheckOut", { date: dayLabelFormat.format(checkIn) })
        : t("picker.hintDone", {
            checkIn: dayLabelFormat.format(checkIn),
            checkOut: dayLabelFormat.format(checkOut),
            nights: t("picker.nights", { count: nights }),
          });

  // Görünür durum satırı: adım + (önizlenen ya da seçilen) gece sayısı.
  const stepCheckOut =
    previewNights > 0
      ? `${t("picker.stepCheckOut")} · ${t("picker.nights", { count: previewNights })}`
      : t("picker.stepCheckOut");
  const status = !checkIn
    ? t("picker.stepCheckIn")
    : sameDayNotice
      ? t("picker.minOneNight")
      : !checkOut
        ? stepCheckOut
        : `${t("picker.nights", { count: nights })} · ${t("picker.stepChange")}`;

  const navBtn = `inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded p-1.5 text-gray-600 hover:bg-gray-100 sm:min-h-0 sm:min-w-0 ${focusRing}`;
  const navOff = "cursor-not-allowed opacity-30";
  const colsClass = visibleCount === 2 ? "grid-cols-2" : "grid-cols-1";

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label={t("picker.dialogLabel")}
      onKeyDown={handleRootKeyDown}
      className="max-w-[calc(100vw-2rem)] rounded-lg border border-gray-200 bg-white p-4 shadow-lg"
    >
      <p className="sr-only" aria-live="polite">
        {hint}
      </p>
      <div className="mb-3 flex items-center gap-2">
        <button
          type="button"
          onClick={goPrev}
          aria-disabled={atStart || undefined}
          aria-label={t("picker.prevMonth")}
          className={`${navBtn} ${atStart ? navOff : ""}`}
        >
          <svg
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </button>
        <div
          className={`grid min-w-0 flex-1 gap-4 text-sm font-semibold text-gray-800 ${colsClass}`}
          aria-live="polite"
        >
          {months.map((m, i) => (
            <span
              key={`${m.year}-${m.month}`}
              id={`${idBase}-month-${i}`}
              className="min-w-0 truncate text-center"
            >
              {monthFormat.format(new Date(m.year, m.month, 1))}
            </span>
          ))}
        </div>
        <button
          type="button"
          onClick={goNext}
          aria-disabled={atEnd || undefined}
          aria-label={t("picker.nextMonth")}
          className={`${navBtn} ${atEnd ? navOff : ""}`}
        >
          <svg
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Görünür adım satırı; ekran okuyucuya yukarıdaki canlı bölge okunur. */}
      <p aria-hidden="true" className="mb-3 text-sm font-medium text-gray-800">
        {status}
      </p>

      <div className={`grid gap-4 ${colsClass}`} onMouseLeave={() => setPreviewISO(null)}>
        {months.map((m, i) => (
          <div
            key={`${m.year}-${m.month}`}
            role="group"
            aria-labelledby={`${idBase}-month-${i}`}
            className="min-w-0"
          >
            {/* Hafta günü kısaltmaları görseldir; gün düğmelerinin adı haftanın gününü zaten içerir. */}
            <div
              className="grid grid-cols-7 gap-1 text-center text-xs text-gray-500"
              aria-hidden="true"
            >
              {weekdays.map((d) => (
                <div key={d} className="min-w-0 truncate py-1">
                  {d}
                </div>
              ))}
            </div>
            <div className="mt-1 grid grid-cols-7 gap-1">
              {m.days.map((d, idx) => {
                if (!d) return <div key={`lead-${idx}`} aria-hidden="true" />;
                const iso = toISODate(d);
                const beyondHorizon = d > lastDay;
                const disabled = d < today || beyondHorizon;
                const phase: DatePickPhase =
                  checkIn && !checkOut && d > checkIn ? "checkOut" : "checkIn";
                const unavailable = !disabled && !!isDateDisabled?.(iso, phase);
                const isIn = isSameDay(checkIn, d);
                const isOut = isSameDay(checkOut, d);
                const range = inRange(d);
                const preview = !range && inPreview(d);
                const todayCell = isSameDay(today, d);
                const label = [
                  dayLabelFormat.format(d),
                  isIn && t("picker.checkIn"),
                  isOut && t("picker.checkOut"),
                  range && t("picker.inRange"),
                  beyondHorizon && t("picker.notBookable"),
                  dayNote?.(iso),
                ]
                  .filter(Boolean)
                  .join(", ");
                return (
                  <button
                    key={iso}
                    ref={(el) => {
                      if (el) dayRefs.current.set(iso, el);
                      else dayRefs.current.delete(iso);
                    }}
                    type="button"
                    disabled={disabled}
                    aria-disabled={unavailable || undefined}
                    tabIndex={iso === activeISO ? 0 : -1}
                    onClick={() => handleDayClick(d, unavailable)}
                    onKeyDown={(e) => handleDayKeyDown(e, d)}
                    onMouseEnter={disabled ? undefined : () => setPreviewISO(iso)}
                    onFocus={() => setPreviewISO(iso)}
                    aria-label={label}
                    aria-pressed={isIn || isOut}
                    aria-current={todayCell ? "date" : undefined}
                    className={`aspect-square w-full min-w-0 rounded text-sm transition ${focusRing} ${
                      disabled
                        ? "cursor-not-allowed text-gray-300"
                        : isIn || isOut
                          ? "bg-[#003580] font-semibold text-white hover:bg-[#002b66]"
                          : unavailable
                            ? "cursor-not-allowed text-gray-300 line-through"
                            : range
                              ? "bg-blue-100 text-[#003580] underline decoration-dotted underline-offset-2"
                              : preview
                                ? "bg-blue-100 text-[#003580]"
                                : "text-gray-800 hover:bg-blue-50"
                    } ${todayCell && !(isIn || isOut) ? "ring-1 ring-inset ring-[#003580]" : ""}`}
                  >
                    {d.getDate()}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {checkIn && (
        <div className="mt-3">
          <button
            type="button"
            onClick={clearDates}
            className={`min-h-[44px] rounded px-2 text-sm font-medium text-[#003580] underline underline-offset-2 hover:bg-blue-50 sm:min-h-0 sm:py-1 ${focusRing}`}
          >
            {t("picker.clearDates")}
          </button>
        </div>
      )}
    </div>
  );
}
