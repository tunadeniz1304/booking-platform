"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useFormat } from "@/i18n/use-format";
import DateRangePicker from "@/components/search/DateRangePicker";
import DestinationAutocomplete from "@/components/search/DestinationAutocomplete";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export default function SearchBar() {
  const router = useRouter();
  const t = useTranslations("search");
  const f = useFormat();
  // Salt tarih UTC olarak biçimlenir; gün kaymaz.
  const formatShort = (dateStr: string): string =>
    ISO_DATE.test(dateStr) ? f.date(dateStr, "medium") : t("bar.pickDate");
  const [destination, setDestination] = useState("");
  const [dateOpen, setDateOpen] = useState(false);
  const [guestsOpen, setGuestsOpen] = useState(false);
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [roomsCount, setRoomsCount] = useState(1);
  const dateRef = useRef<HTMLDivElement>(null);
  const guestsRef = useRef<HTMLDivElement>(null);

  const totalGuests = adults + children;

  const handleDateChange = (v: { checkIn: string; checkOut: string }) => {
    setCheckIn(v.checkIn);
    setCheckOut(v.checkOut);
    if (v.checkOut) setDateOpen(false); // aralık tamam, kapat
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
        <div ref={dateRef} className="relative lg:w-80">
          <span className="mb-1 block text-xs font-bold text-gray-600">{t("bar.dates")}</span>
          <button
            type="button"
            onClick={() => toggleOpen("date", !dateOpen)}
            aria-expanded={dateOpen}
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
            <div className="absolute left-0 right-0 z-30 mt-1 lg:right-auto lg:w-[560px]">
              <DateRangePicker
                value={{ checkIn, checkOut }}
                onChange={handleDateChange}
                monthCount={2}
              />
            </div>
          )}
        </div>

        {/* Misafirler */}
        <div ref={guestsRef} className="relative lg:w-60">
          <span className="mb-1 block text-xs font-bold text-gray-600">{t("bar.guests")}</span>
          <button
            type="button"
            onClick={() => toggleOpen("guests", !guestsOpen)}
            aria-expanded={guestsOpen}
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
            <div className="absolute right-0 z-30 mt-1 w-72 rounded-lg border border-gray-200 bg-white p-4 shadow-lg">
              <div className="flex items-center justify-between py-2">
                <div>
                  <p className="text-sm font-medium text-gray-900">{t("bar.adults")}</p>
                  <p className="text-xs text-gray-500">{t("bar.adultsHint")}</p>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setAdults(Math.max(1, adults - 1))}
                    aria-label={t("bar.decrease")}
                    className="h-8 w-8 rounded-full border border-gray-300 text-gray-700 hover:bg-gray-50"
                  >
                    −
                  </button>
                  <span className="w-6 text-center text-sm font-semibold">{adults}</span>
                  <button
                    type="button"
                    onClick={() => setAdults(Math.min(30, adults + 1))}
                    aria-label={t("bar.increase")}
                    className="h-8 w-8 rounded-full border border-gray-300 text-gray-700 hover:bg-gray-50"
                  >
                    +
                  </button>
                </div>
              </div>
              <div className="flex items-center justify-between border-t border-gray-100 py-2">
                <div>
                  <p className="text-sm font-medium text-gray-900">{t("bar.children")}</p>
                  <p className="text-xs text-gray-500">{t("bar.childrenHint")}</p>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setChildren(Math.max(0, children - 1))}
                    aria-label={t("bar.decrease")}
                    className="h-8 w-8 rounded-full border border-gray-300 text-gray-700 hover:bg-gray-50"
                  >
                    −
                  </button>
                  <span className="w-6 text-center text-sm font-semibold">{children}</span>
                  <button
                    type="button"
                    onClick={() => setChildren(Math.min(10, children + 1))}
                    aria-label={t("bar.increase")}
                    className="h-8 w-8 rounded-full border border-gray-300 text-gray-700 hover:bg-gray-50"
                  >
                    +
                  </button>
                </div>
              </div>
              <div className="flex items-center justify-between border-t border-gray-100 py-2">
                <p className="text-sm font-medium text-gray-900">{t("bar.rooms")}</p>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setRoomsCount(Math.max(1, roomsCount - 1))}
                    aria-label={t("bar.decrease")}
                    className="h-8 w-8 rounded-full border border-gray-300 text-gray-700 hover:bg-gray-50"
                  >
                    −
                  </button>
                  <span className="w-6 text-center text-sm font-semibold">{roomsCount}</span>
                  <button
                    type="button"
                    onClick={() => setRoomsCount(Math.min(30, roomsCount + 1))}
                    aria-label={t("bar.increase")}
                    className="h-8 w-8 rounded-full border border-gray-300 text-gray-700 hover:bg-gray-50"
                  >
                    +
                  </button>
                </div>
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
