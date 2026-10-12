"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useFormat } from "@/i18n/use-format";
import { Button } from "@/components/ui/ui";
import DateRangePicker from "@/components/search/DateRangePicker";
import DestinationAutocomplete from "@/components/search/DestinationAutocomplete";
import { publishSearchDraft } from "@/components/search/useSearchDraft";
import { MAX_SEARCH_GUESTS } from "@/lib/search/guest-limits";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const MAX_ADULTS = MAX_SEARCH_GUESTS;
const MAX_CHILDREN = 10;

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
  /** Arama oda sayısını desteklemiyor; yok sayılır (geriye dönük uyumluluk). */
  rooms?: number;
}

/** Takvimde seçili (yoksa ilk seçilebilir) güne odak taşır. */
const focusSelectedDay = (panel: HTMLElement | null) => {
  const day =
    panel?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]:not([disabled])') ??
    panel?.querySelector<HTMLButtonElement>("button[aria-pressed]:not([disabled])");
  day?.focus();
};

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
  /** Artır düğmesi sınırdayken nedenini açıklayan notun id'si (toplam misafir sınırı). */
  limitNoteId?: string;
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
  limitNoteId,
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
          aria-describedby={atMax ? limitNoteId : undefined}
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
  const tc = useTranslations("common");
  const f = useFormat();
  const isDesktop = useSyncExternalStore(subscribeDesktop, getDesktop, () => false);
  const [isPending, startTransition] = useTransition();
  // Salt tarih UTC olarak biçimlenir; gün kaymaz.
  const formatShort = (dateStr: string): string =>
    ISO_DATE.test(dateStr) ? f.date(dateStr, "medium") : t("bar.pickDate");
  const [destination, setDestination] = useState(initial?.destination ?? "");
  const [dateOpen, setDateOpen] = useState(false);
  const [guestsOpen, setGuestsOpen] = useState(false);
  const [checkIn, setCheckIn] = useState(
    initial?.checkIn && ISO_DATE.test(initial.checkIn) ? initial.checkIn : ""
  );
  const [checkOut, setCheckOut] = useState(
    initial?.checkOut && ISO_DATE.test(initial.checkOut) ? initial.checkOut : ""
  );
  const initialAdults = clamp(initial?.adults, 1, MAX_ADULTS, 2);
  const [adults, setAdults] = useState(initialAdults);
  const [children, setChildren] = useState(
    clamp(initial?.children, 0, Math.min(MAX_CHILDREN, MAX_SEARCH_GUESTS - initialAdults), 0)
  );
  const [dateError, setDateError] = useState(false);
  const dateRef = useRef<HTMLDivElement>(null);
  const guestsRef = useRef<HTMLDivElement>(null);
  const datePanelRef = useRef<HTMLDivElement>(null);
  const guestsPanelRef = useRef<HTMLDivElement>(null);
  const dateButtonRef = useRef<HTMLButtonElement>(null);
  const guestsButtonRef = useRef<HTMLButtonElement>(null);
  const datePanelId = useId();
  const guestsPanelId = useId();
  const dateLabelId = useId();
  const dateValueId = useId();
  const dateErrorId = useId();
  const guestsLabelId = useId();
  const guestsValueId = useId();
  const guestLimitId = useId();

  // Toplam misafir, arama API'sinin kabul ettiği sınırı aşamaz (F820).
  const totalGuests = adults + children;
  const atGuestLimit = totalGuests >= MAX_SEARCH_GUESTS;

  // F1282: seçili ölçütler sayfadaki destinasyon ve öne çıkan kartların bağlantılarına taşınır.
  useEffect(() => {
    publishSearchDraft({ checkIn, checkOut, adults, children });
  }, [checkIn, checkOut, adults, children]);
  useEffect(() => () => publishSearchDraft(null), []);

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
    if (dateOpen) focusSelectedDay(datePanelRef.current);
  }, [dateOpen]);

  // Misafir paneli açılınca odağı ilk sayaca taşı.
  useEffect(() => {
    if (guestsOpen) guestsPanelRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [guestsOpen]);

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
    if (v.checkOut || !v.checkIn) setDateError(false);
    // Aralık tamam: kapat ve odağı tetikleyiciye geri ver (body'ye düşmesin).
    if (v.checkOut) closeDate(true);
  };

  const clearDates = () => {
    setCheckIn("");
    setCheckOut("");
    setDateError(false);
    // Temizle düğmesi kalkacağı için odak tarih düğmesine verilir.
    dateButtonRef.current?.focus();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isPending) return;
    // Yalnız giriş seçiliyse tarihsiz arama yapma; çıkış tarihini iste.
    if (checkIn && !checkOut) {
      setDateError(true);
      setGuestsOpen(false);
      if (dateOpen) focusSelectedDay(datePanelRef.current);
      else setDateOpen(true);
      return;
    }
    const params = new URLSearchParams();
    if (destination.trim()) params.set("destination", destination.trim());
    if (checkIn && checkOut) {
      params.set("checkIn", checkIn);
      params.set("checkOut", checkOut);
    }
    params.set("guests", String(totalGuests));
    params.set("adults", String(adults));
    if (children > 0) params.set("children", String(children));
    startTransition(() => router.push(`/search?${params.toString()}`));
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

  const dateSummary = (() => {
    if (checkIn && checkOut) {
      // F809: gece sayısı da özetlenir.
      const count = Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / 86400000);
      return t("bar.dateRange", {
        checkIn: formatShort(checkIn),
        checkOut: formatShort(checkOut),
        nights: t("picker.nights", { count }),
      });
    }
    if (checkIn) return t("bar.checkInOnly", { date: formatShort(checkIn) });
    return t("bar.pickDate");
  })();

  return (
    <form
      role="search"
      aria-label={t("bar.formLabel")}
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
          onBlur={(e) => {
            // Odak (Tab ile) alanın dışına çıkınca kapat; tıklamaları pointerdown ele alır.
            const next = e.relatedTarget;
            if (dateOpen && next && !e.currentTarget.contains(next)) setDateOpen(false);
          }}
        >
          <span id={dateLabelId} className="mb-1 block text-xs font-bold text-gray-600">
            {t("bar.dates")}
          </span>
          <div className="relative">
            <button
              ref={dateButtonRef}
              type="button"
              onClick={() => toggleOpen("date", !dateOpen)}
              aria-labelledby={`${dateLabelId} ${dateValueId}`}
              aria-describedby={dateError ? dateErrorId : undefined}
              aria-expanded={dateOpen}
              aria-haspopup="dialog"
              aria-controls={dateOpen ? datePanelId : undefined}
              className={`flex w-full items-center gap-2 rounded-sm border border-gray-300 bg-white px-3 py-2.5 text-left text-sm text-gray-900 hover:border-[#003580] ${checkIn ? "pr-11" : ""}`}
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
              <span id={dateValueId}>{dateSummary}</span>
            </button>
            {checkIn && (
              <button
                type="button"
                onClick={clearDates}
                aria-label={t("bar.clearDates")}
                title={t("bar.clearDates")}
                className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-sm text-gray-600 hover:text-gray-900"
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            )}
          </div>
          {dateError && (
            <p id={dateErrorId} role="alert" className="mt-1 text-xs font-medium text-red-700">
              <span aria-hidden="true">{"⚠︎"} </span>
              <span className="sr-only">{tc("errorPrefix")} </span>
              {t("bar.checkOutRequired")}
            </p>
          )}
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
                onClose={() => closeDate(true)}
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
          onBlur={(e) => {
            const next = e.relatedTarget;
            if (guestsOpen && next && !e.currentTarget.contains(next)) setGuestsOpen(false);
          }}
        >
          <span id={guestsLabelId} className="mb-1 block text-xs font-bold text-gray-600">
            {t("bar.guests")}
          </span>
          <button
            ref={guestsButtonRef}
            type="button"
            onClick={() => toggleOpen("guests", !guestsOpen)}
            aria-labelledby={`${guestsLabelId} ${guestsValueId}`}
            aria-expanded={guestsOpen}
            aria-haspopup="dialog"
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
            <span id={guestsValueId}>{t("bar.guestsSummary", { adults, children })}</span>
          </button>
          {guestsOpen && (
            // Mobilde akış içinde açılır; "Ara" düğmesini örtmez.
            <div
              ref={guestsPanelRef}
              id={guestsPanelId}
              role="dialog"
              aria-labelledby={guestsLabelId}
              className="mt-1 w-full rounded-lg border border-gray-200 bg-white p-4 shadow-lg lg:absolute lg:right-0 lg:z-30 lg:w-72"
            >
              <CounterRow
                label={t("bar.adults")}
                hint={t("bar.adultsHint")}
                value={adults}
                min={1}
                max={Math.min(MAX_ADULTS, MAX_SEARCH_GUESTS - children)}
                onChange={setAdults}
                decreaseLabel={t("bar.decreaseAdults")}
                increaseLabel={t("bar.increaseAdults")}
                statusText={t("bar.countStatus", { label: t("bar.adults"), count: adults })}
                limitNoteId={atGuestLimit ? guestLimitId : undefined}
              />
              <CounterRow
                bordered
                label={t("bar.children")}
                hint={t("bar.childrenHintPricing")}
                value={children}
                min={0}
                max={Math.min(MAX_CHILDREN, MAX_SEARCH_GUESTS - adults)}
                onChange={setChildren}
                decreaseLabel={t("bar.decreaseChildren")}
                increaseLabel={t("bar.increaseChildren")}
                statusText={t("bar.countStatus", { label: t("bar.children"), count: children })}
                limitNoteId={atGuestLimit ? guestLimitId : undefined}
              />
              {/* Bölge panelle birlikte bağlanır; sınıra gelinince not hem görünür hem duyurulur. */}
              <p id={guestLimitId} role="status" className="text-xs text-gray-600">
                {atGuestLimit ? t("bar.maxGuests", { max: MAX_SEARCH_GUESTS }) : ""}
              </p>
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
          <Button type="submit" size="lg" fullWidth busy={isPending} className="lg:w-auto">
            {isPending ? t("bar.searching") : t("bar.submit")}
          </Button>
          <span className="sr-only" role="status">
            {isPending ? t("bar.searching") : ""}
          </span>
        </div>
      </div>
    </form>
  );
}
