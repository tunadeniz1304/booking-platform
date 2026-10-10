"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useFormat } from "@/i18n/use-format";
import { Button } from "@/components/ui/ui";
import DateRangePicker from "@/components/search/DateRangePicker";
import DestinationAutocomplete from "@/components/search/DestinationAutocomplete";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const MAX_ADULTS = 30;
const MAX_CHILDREN = 10;
const MAX_ROOMS = 30;

/** Masaüstü kırılımı (Tailwind `lg`); mobilde tarih seçici tek ay gösterir. */
const DESKTOP_QUERY = "(min-width: 1024px)";
const subscribeDesktop = (cb: () => void) => {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mql = window.matchMedia(DESKTOP_QUERY);
  mql.addEventListener("change", cb);
  return () => mql.removeEventListener("change", cb);
};
const getDesktop = () =>
  typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(DESKTOP_QUERY).matches;

/** Arama ölçütlerini önceden doldurmak için (ör. sonuç sayfasında aramayı düzenleme). */
export interface SearchBarInitial {
  destination?: string;
  checkIn?: string;
  checkOut?: string;
  adults?: number;
  children?: number;
  rooms?: number;
}

const clamp = (n: number | undefined, min: number, max: number, fallback: number) =>
  typeof n === "number" && Number.isFinite(n)
    ? Math.min(max, Math.max(min, Math.trunc(n)))
    : fallback;

const counterButtonClass =
  "h-11 w-11 rounded-full border border-gray-300 text-gray-700 hover:bg-gray-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 lg:h-8 lg:w-8";

interface CounterRowProps {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
  decreaseLabel: string;
  increaseLabel: string;
  statusText: string;
  bordered?: boolean;
}

function CounterRow({
  label,
  hint,
  value,
  min,
  max,
  onChange,
  decreaseLabel,
  increaseLabel,
  statusText,
  bordered,
}: CounterRowProps) {
  const labelId = useId();
  const atMin = value <= min;
  const atMax = value >= max;
  // Sınırda aria-disabled: düğme odakta kalır (disabled odağı düşürürdü) ama işlem yapmaz.
  return (
    <div
      role="group"
      aria-labelledby={labelId}
      className={`flex items-center justify-between py-2 ${bordered ? "border-t border-gray-100" : ""}`}
    >
      <div>
        <p id={labelId} className="text-sm font-medium text-gray-900">
          {label}
        </p>
        {hint && <p className="text-xs text-gray-500">{hint}</p>}
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => {
            if (!atMin) onChange(value - 1);
          }}
          aria-label={decreaseLabel}
          aria-disabled={atMin || undefined}
          className={counterButtonClass}
        >
          −
        </button>
        <span className="w-6 text-center text-sm font-semibold" aria-hidden="true">
          {value}
        </span>
        <span className="sr-only" aria-live="polite" aria-atomic="true">
          {statusText}
        </span>
        <button
          type="button"
          onClick={() => {
            if (!atMax) onChange(value + 1);
          }}
          aria-label={increaseLabel}
          aria-disabled={atMax || undefined}
          className={counterButtonClass}
        >
          +
        </button>
      </div>
    </div>
  );
}

export default function SearchBar({ initial }: { initial?: SearchBarInitial } = {}) {
  const router = useRouter();
  const t = useTranslations("search");
  const f = useFormat();
  const isDesktop = useSyncExternalStore(subscribeDesktop, getDesktop, () => false);
  // Salt tarih UTC olarak biçimlenir; gün kaymaz.
  const formatShort = (dateStr: string): string =>
    ISO_DATE.test(dateStr) ? f.date(dateStr, "medium") : t("bar.pickDate");
  const initialAdults = clamp(initial?.adults, 1, MAX_ADULTS, 2);
  const [destination, setDestination] = useState(initial?.destination ?? "");
  const [dateOpen, setDateOpen] = useState(false);
  const [guestsOpen, setGuestsOpen] = useState(false);
  const [checkIn, setCheckIn] = useState(
    initial?.checkIn && ISO_DATE.test(initial.checkIn) ? initial.checkIn : ""
  );
  const [checkOut, setCheckOut] = useState(
    initial?.checkOut && ISO_DATE.test(initial.checkOut) ? initial.checkOut : ""
  );
  const [adults, setAdults] = useState(initialAdults);
  const [children, setChildren] = useState(clamp(initial?.children, 0, MAX_CHILDREN, 0));
  const [roomsCount, setRoomsCount] = useState(
    clamp(initial?.rooms, 1, Math.min(MAX_ROOMS, initialAdults), 1)
  );
  const dateRef = useRef<HTMLDivElement>(null);
  const guestsRef = useRef<HTMLDivElement>(null);
  const datePanelRef = useRef<HTMLDivElement>(null);
  const dateButtonRef = useRef<HTMLButtonElement>(null);
  const guestsButtonRef = useRef<HTMLButtonElement>(null);
  const datePanelId = useId();
  const guestsPanelId = useId();

  const totalGuests = adults + children;
  // Her odada en az bir yetişkin olmalı.
  const maxRooms = Math.min(MAX_ROOMS, adults);

  // Dış tıklamada açık paneli kapat (odak taşınmaz; kullanıcı başka yere tıkladı).
  useEffect(() => {
    if (!dateOpen && !guestsOpen) return;
    const handler = (e: PointerEvent) => {
      const target = e.target as Node;
      if (dateOpen && dateRef.current && !dateRef.current.contains(target)) setDateOpen(false);
      if (guestsOpen && guestsRef.current && !guestsRef.current.contains(target))
        setGuestsOpen(false);
    };
    document.addEventListener("pointerdown", handler);
    return () => document.removeEventListener("pointerdown", handler);
  }, [dateOpen, guestsOpen]);

  // Tarih seçici açılınca odağı seçili (yoksa ilk seçilebilir) güne taşı.
  useEffect(() => {
    if (!dateOpen) return;
    const panel = datePanelRef.current;
    if (!panel) return;
    const day =
      panel.querySelector<HTMLButtonElement>('button[aria-pressed="true"]:not([disabled])') ??
      panel.querySelector<HTMLButtonElement>("button[aria-pressed]:not([disabled])");
    day?.focus();
  }, [dateOpen]);

  const closeDate = (returnFocus: boolean) => {
    setDateOpen(false);
    if (returnFocus) dateButtonRef.current?.focus();
  };

  const closeGuests = (returnFocus: boolean) => {
    setGuestsOpen(false);
    if (returnFocus) guestsButtonRef.current?.focus();
  };

  const handleDateChange = (v: { checkIn: string; checkOut: string }) => {
    setCheckIn(v.checkIn);
    setCheckOut(v.checkOut);
    // Aralık tamam: kapat ve odağı tetikleyiciye geri ver (body'ye düşmesin).
    if (v.checkOut) closeDate(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams();
    if (destination.trim()) params.set("destination", destination.trim());
    if (checkIn && checkOut) {
      params.set("checkIn", checkIn);
      params.set("checkOut", checkOut);
    }
    params.set("guests", String(totalGuests));
    params.set("adults", String(adults));
    if (children > 0) params.set("children", String(children));
    params.set("rooms", String(roomsCount));
    router.push(`/search?${params.toString()}`);
  };

  const toggleOpen = (target: "date" | "guests", next: boolean) => {
    if (target === "date") {
      setDateOpen(next);
      setGuestsOpen(false);
    } else {
      setGuestsOpen(next);
      setDateOpen(false);
    }
  };

  const changeAdults = (next: number) => {
    setAdults(next);
    setRoomsCount((r) => Math.min(r, next));
  };

  const dateSummary = (() => {
    if (checkIn && checkOut) {
      return `${formatShort(checkIn)} - ${formatShort(checkOut)}`;
    }
    if (checkIn) return t("bar.checkInOnly", { date: formatShort(checkIn) });
    return t("bar.pickDate");
  })();

  return (
    <form
      onSubmit={handleSubmit}
      className="w-full rounded-xl bg-white p-3 shadow-xl ring-1 ring-black/5"
    >
      <div className="flex flex-col gap-2 lg:flex-row lg:items-stretch">
        {/* Nereye? */}
        <div className="lg:flex-1 lg:border-r lg:border-gray-200 lg:pr-3">
          <label htmlFor="destination" className="mb-1 block text-xs font-bold text-gray-600">
            {t("bar.destination")}
          </label>
          <DestinationAutocomplete value={destination} onChange={setDestination} />
        </div>

        {/* Giriş - Çıkış */}
        <div
          ref={dateRef}
          className="relative lg:w-80"
          onKeyDown={(e) => {
            if (e.key === "Escape" && dateOpen) {
              e.preventDefault();
              e.stopPropagation();
              closeDate(true);
            }
          }}
        >
          <span className="mb-1 block text-xs font-bold text-gray-600">{t("bar.dates")}</span>
          <button
            ref={dateButtonRef}
            type="button"
            onClick={() => toggleOpen("date", !dateOpen)}
            aria-expanded={dateOpen}
            aria-haspopup="dialog"
            aria-controls={dateOpen ? datePanelId : undefined}
            className="flex w-full items-center gap-2 rounded-sm border border-gray-300 bg-white px-3 py-2.5 text-left text-sm text-gray-900 hover:border-[#003580]"
          >
            <svg
              className="h-5 w-5 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
            <span>{dateSummary}</span>
          </button>
          {dateOpen && (
            // Mobilde akış içinde açılır (alttaki alanları örtmez), masaüstünde açılır pencere.
            <div
              ref={datePanelRef}
              id={datePanelId}
              role="dialog"
              aria-label={t("bar.datesDialog")}
              className="mt-1 lg:absolute lg:left-0 lg:z-30 lg:w-[560px]"
            >
              <DateRangePicker
                value={{ checkIn, checkOut }}
                onChange={handleDateChange}
                monthCount={isDesktop ? 2 : 1}
              />
            </div>
          )}
        </div>

        {/* Misafirler */}
        <div
          ref={guestsRef}
          className="relative lg:w-60"
          onKeyDown={(e) => {
            if (e.key === "Escape" && guestsOpen) {
              e.preventDefault();
              e.stopPropagation();
              closeGuests(true);
            }
          }}
        >
          <span className="mb-1 block text-xs font-bold text-gray-600">{t("bar.guests")}</span>
          <button
            ref={guestsButtonRef}
            type="button"
            onClick={() => toggleOpen("guests", !guestsOpen)}
            aria-expanded={guestsOpen}
            aria-controls={guestsOpen ? guestsPanelId : undefined}
            className="flex w-full items-center gap-2 rounded-sm border border-gray-300 bg-white px-3 py-2.5 text-left text-sm text-gray-900 hover:border-[#003580]"
          >
            <svg
              className="h-5 w-5 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
              />
            </svg>
            <span>{t("bar.guestsSummary", { guests: totalGuests, rooms: roomsCount })}</span>
          </button>
          {guestsOpen && (
            // Mobilde akış içinde açılır; "Ara" düğmesini örtmez.
            <div
              id={guestsPanelId}
              className="mt-1 w-full rounded-lg border border-gray-200 bg-white p-4 shadow-lg lg:absolute lg:right-0 lg:z-30 lg:w-72"
            >
              <CounterRow
                label={t("bar.adults")}
                hint={t("bar.adultsHint")}
                value={adults}
                min={1}
                max={MAX_ADULTS}
                onChange={changeAdults}
                decreaseLabel={t("bar.decreaseAdults")}
                increaseLabel={t("bar.increaseAdults")}
                statusText={t("bar.countStatus", { label: t("bar.adults"), count: adults })}
              />
              <CounterRow
                bordered
                label={t("bar.children")}
                hint={t("bar.childrenHint")}
                value={children}
                min={0}
                max={MAX_CHILDREN}
                onChange={setChildren}
                decreaseLabel={t("bar.decreaseChildren")}
                increaseLabel={t("bar.increaseChildren")}
                statusText={t("bar.countStatus", { label: t("bar.children"), count: children })}
              />
              <CounterRow
                bordered
                label={t("bar.rooms")}
                hint={t("bar.roomsHint")}
                value={roomsCount}
                min={1}
                max={maxRooms}
                onChange={setRoomsCount}
                decreaseLabel={t("bar.decreaseRooms")}
                increaseLabel={t("bar.increaseRooms")}
                statusText={t("bar.countStatus", { label: t("bar.rooms"), count: roomsCount })}
              />
              <div className="mt-2 flex justify-end border-t border-gray-100 pt-3">
                <Button
                  variant="secondary"
                  onClick={() => closeGuests(true)}
                  className="min-h-[44px] lg:min-h-0"
                >
                  {t("bar.done")}
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="lg:ml-3 lg:flex lg:items-end">
          <button
            type="submit"
            className="w-full rounded-lg bg-[#003580] px-10 py-3 text-sm font-semibold text-white transition hover:bg-[#002b66] lg:w-auto"
          >
            {t("bar.submit")}
          </button>
        </div>
      </div>
    </form>
  );
}
