"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useFormat } from "@/i18n/use-format";

/**
 * Çift aylık tarih aralığı seçici (OTA'larda yaygın desen).
 * Kullanıcı giriş tarihine tıklar → seçim başlar; çıkış tarihine tıklar → aralık tamamlanır.
 * Girişten önceki bir tarihe tıklanırsa giriş yeniden ayarlanır (Booking davranışı).
 */

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

function monthMatrix(year: number, month: number): Date[] {
  // Ayın ilk gününün hafta gününe göre boşluk ekle, Pazartesi başlangıçlı
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7; // Pazartesi=0
  const days: Date[] = [];
  for (let i = 0; i < lead; i++) days.push(new Date(year, month, -lead + i + 1));
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
  /** Kaç ay yan yana gösterilecek */
  monthCount?: number;
}

export default function DateRangePicker({
  value,
  onChange,
  minDate = new Date(),
  monthCount = 2,
}: DateRangePickerProps) {
  const t = useTranslations("search");
  const f = useFormat();
  const today = startOfDay(minDate);
  const [monthsOffset, setMonthsOffset] = useState(0);

  // Ay ve gün adları etkin dile göre Intl'den gelir.
  const monthFormat = useMemo(
    () => new Intl.DateTimeFormat(f.locale, { month: "long", year: "numeric" }),
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
  const totalMonths = baseYear * 12 + baseMonth + monthsOffset;
  const activeYear = Math.floor(totalMonths / 12);
  const activeMonth = totalMonths % 12;

  const months = useMemo(() => {
    const arr: { year: number; month: number; days: Date[] }[] = [];
    for (let i = 0; i < monthCount; i++) {
      const m = activeMonth + i;
      const y = activeYear + Math.floor(m / 12);
      arr.push({
        year: y,
        month: ((m % 12) + 12) % 12,
        days: monthMatrix(y, ((m % 12) + 12) % 12),
      });
    }
    return arr;
  }, [activeYear, activeMonth, monthCount]);

  const checkIn = value.checkIn ? parseISODate(value.checkIn) : null;
  const checkOut = value.checkOut ? parseISODate(value.checkOut) : null;

  const inRange = (d: Date) => {
    if (checkIn && checkOut && d > checkIn && d < checkOut) return true;
    return false;
  };

  const handleDayClick = (d: Date) => {
    const day = startOfDay(d);
    if (day < today) return; // geçmiş tarih seçilemez

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

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-lg">
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          onClick={goPrev}
          disabled={monthsOffset === 0}
          aria-label={t("picker.prevMonth")}
          className="rounded p-1.5 text-gray-600 hover:bg-gray-100 disabled:opacity-30"
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
        <div className="flex gap-6 text-sm font-semibold text-gray-800">
          {months.map((m) => (
            <span key={`${m.year}-${m.month}`} className="w-32 text-center">
              {monthFormat.format(new Date(m.year, m.month, 1))}
            </span>
          ))}
        </div>
        <button
          type="button"
          onClick={goNext}
          aria-label={t("picker.nextMonth")}
          className="rounded p-1.5 text-gray-600 hover:bg-gray-100"
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

      <div className={`grid gap-4 ${monthCount === 2 ? "grid-cols-2" : "grid-cols-1"}`}>
        {months.map((m) => (
          <div key={`${m.year}-${m.month}`}>
            <div className="grid grid-cols-7 gap-1 text-center text-xs text-gray-500">
              {weekdays.map((d) => (
                <div key={d} className="py-1">
                  {d}
                </div>
              ))}
            </div>
            <div className="mt-1 grid grid-cols-7 gap-1">
              {m.days.map((d, idx) => {
                const disabled = d < today;
                const isIn = isSameDay(checkIn, d);
                const isOut = isSameDay(checkOut, d);
                const range = inRange(d);
                const todayCell =
                  d.getFullYear() === today.getFullYear() &&
                  d.getMonth() === today.getMonth() &&
                  d.getDate() === today.getDate();
                return (
                  <button
                    key={idx}
                    type="button"
                    disabled={disabled}
                    onClick={() => handleDayClick(d)}
                    aria-pressed={isIn || isOut}
                    className={`h-9 w-9 rounded text-sm transition ${
                      disabled
                        ? "cursor-not-allowed text-gray-300"
                        : isIn || isOut
                          ? "bg-[#003580] font-semibold text-white hover:bg-[#002b66]"
                          : range
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
    </div>
  );
}
