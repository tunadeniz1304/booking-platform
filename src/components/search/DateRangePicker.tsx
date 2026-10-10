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

/**
 * Çift aylık tarih aralığı seçici (OTA'larda yaygın desen).
 * Kullanıcı giriş tarihine tıklar → seçim başlar; çıkış tarihine tıklar → aralık tamamlanır.
 * Girişten önceki bir tarihe tıklanırsa giriş yeniden ayarlanır (Booking davranışı).
 *
 * Erişilebilirlik: her gün düğmesinin adı tam tarih + giriş/çıkış/aralık durumudur;
 * ızgara tek Tab durağıdır (roving tabindex) ve ok/Home/End/PageUp/PageDown ile gezilir.
 * Kapsayıcı dar olduğunda (ör. ilan kenar çubuğu, mobil) tek ay gösterilir.
 */

/** İki ayın yan yana sığması için gereken asgari kök genişliği (px). */
const TWO_MONTH_MIN_WIDTH = 540;

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

/**
 * Ayın günleri; Pazartesi başlangıçlı hafta için baştaki boşluklar `null`dur.
 * Önceki ayın günleri çizilmez: aksi hâlde "Kasım" altındaki 28, 28 Ekim'i seçerdi.
 */
function monthMatrix(year: number, month: number): (Date | null)[] {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7; // Pazartesi=0
  const days: (Date | null)[] = Array.from({ length: lead }, () => null);
  const last = new Date(year, month + 1, 0).getDate();
  for (let d = 1; d <= last; d++) days.push(new Date(year, month, d));
  return days;
}

interface DateRange {
  checkIn: string;
  checkOut: string;
}

interface DateRangePickerProps {
  value: DateRange;
  onChange: (value: DateRange) => void;
  minDate?: Date;
  /** Kaç ay yan yana gösterilecek (dar kapsayıcıda otomatik olarak 1'e düşer) */
  monthCount?: number;
  /** Escape ile kapatma isteği; çağıran odağı tetikleyiciye geri vermelidir. */
  onClose?: () => void;
}

export default function DateRangePicker({
  value,
  onChange,
  minDate = new Date(),
  monthCount = 2,
  onClose,
}: DateRangePickerProps) {
  const t = useTranslations("search");
  const f = useFormat();
  const today = startOfDay(minDate);
  const [monthsOffset, setMonthsOffset] = useState(0);
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
  const weekdays = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(f.locale, { weekday: "short" });
    // 1 Ocak 2024 pazartesidir; hafta pazartesiden başlar.
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2024, 0, 1 + i)));
  }, [f.locale]);

  // current ay + offset => (yıl, ay)
  const baseYear = today.getFullYear();
  const baseMonth = today.getMonth();
  const baseIndex = baseYear * 12 + baseMonth;
  const totalMonths = baseIndex + monthsOffset;
  const activeYear = Math.floor(totalMonths / 12);
  const activeMonth = totalMonths % 12;

  const months = useMemo(() => {
    const arr: { year: number; month: number; days: (Date | null)[] }[] = [];
    for (let i = 0; i < visibleCount; i++) {
      const m = activeMonth + i;
      const y = activeYear + Math.floor(m / 12);
      const mm = ((m % 12) + 12) % 12;
      arr.push({ year: y, month: mm, days: monthMatrix(y, mm) });
    }
    return arr;
  }, [activeYear, activeMonth, visibleCount]);

  const checkIn = value.checkIn ? parseISODate(value.checkIn) : null;
  const checkOut = value.checkOut ? parseISODate(value.checkOut) : null;

  const inRange = (d: Date) => {
    if (checkIn && checkOut && d > checkIn && d < checkOut) return true;
    return false;
  };

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

  const focusedDate = focusedISO ? parseISODate(focusedISO) : null;
  let activeISO: string;
  if (focusedDate && isVisible(focusedDate) && focusedDate >= today) {
    activeISO = toISODate(focusedDate);
  } else if (checkIn && isVisible(checkIn) && checkIn >= today) {
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
    const weekday = (d.getDay() + 6) % 7; // Pazartesi=0
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
        const lastDay = new Date(y, m + dir + 1, 0).getDate();
        target = new Date(y, m + dir, Math.min(day, lastDay));
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

  const handleDayClick = (d: Date) => {
    const day = startOfDay(d);
    if (day < today) return; // geçmiş tarih seçilemez
    setFocusedISO(toISODate(day));

    if (!checkIn || (checkOut && day >= checkIn)) {
      // Yeni aralık başlat (veya mevcut aralığı temizle)
      onChange({ checkIn: toISODate(day), checkOut: "" });
    } else if (day > checkIn) {
      onChange({ checkIn: toISODate(checkIn), checkOut: toISODate(day) });
    } else if (day < checkIn) {
      // Girişten önceye tıklandı → girişi taşı
      onChange({ checkIn: toISODate(day), checkOut: "" });
    }
    // (day == checkIn ise hiçbir şey değişmez → kullanıcı girişi "silme" amacıyla tıklamış olabilir)
  };

  const goPrev = () => {
    if (monthsOffset === 0) return;
    setMonthsOffset(monthsOffset - 1);
  };
  const goNext = () => {
    setMonthsOffset(monthsOffset + 1);
  };

  const isSameDay = (a: Date | null, b: Date) =>
    !!a &&
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  // Ekran okuyucu için seçim adımı yönergesi.
  const hint = !checkIn
    ? t("picker.hintCheckIn")
    : !checkOut
      ? t("picker.hintCheckOut", { date: dayLabelFormat.format(checkIn) })
      : t("picker.hintDone", {
          checkIn: dayLabelFormat.format(checkIn),
          checkOut: dayLabelFormat.format(checkOut),
        });

  const navBtn = `inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded p-1.5 text-gray-600 hover:bg-gray-100 sm:min-h-0 sm:min-w-0 ${focusRing}`;
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
          disabled={monthsOffset === 0}
          aria-label={t("picker.prevMonth")}
          className={`${navBtn} disabled:opacity-30`}
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
          aria-label={t("picker.nextMonth")}
          className={navBtn}
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

      <div className={`grid gap-4 ${colsClass}`}>
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
                const disabled = d < today;
                const isIn = isSameDay(checkIn, d);
                const isOut = isSameDay(checkOut, d);
                const range = inRange(d);
                const todayCell = isSameDay(today, d);
                const label = [
                  dayLabelFormat.format(d),
                  isIn && t("picker.checkIn"),
                  isOut && t("picker.checkOut"),
                  range && t("picker.inRange"),
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
                    tabIndex={iso === activeISO ? 0 : -1}
                    onClick={() => handleDayClick(d)}
                    onKeyDown={(e) => handleDayKeyDown(e, d)}
                    aria-label={label}
                    aria-pressed={isIn || isOut}
                    aria-current={todayCell ? "date" : undefined}
                    className={`aspect-square w-full min-w-0 rounded text-sm transition ${focusRing} ${
                      disabled
                        ? "cursor-not-allowed text-gray-300"
                        : isIn || isOut
                          ? "bg-[#003580] font-semibold text-white hover:bg-[#002b66]"
                          : range
                            ? "bg-blue-100 text-[#003580] underline decoration-dotted underline-offset-2"
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
    </div>
  );
}
