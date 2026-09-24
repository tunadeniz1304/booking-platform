"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import DateRangePicker, { toISODate } from "@/components/search/DateRangePicker";
import QuoteBreakdown from "./QuoteBreakdown";
import { useQuote } from "./useQuote";

export interface BookingWidgetRoom {
  id: string;
  name: string;
  capacity: number;
  bedType: string;
  priceModifier: number;
  available: boolean;
}

interface BookingWidgetProps {
  propertyId: string;
  rooms: BookingWidgetRoom[];
  /** Yalnızca "başlangıç fiyatı" gösterimi için; toplam daima sunucu teklifinden gelir. */
  basePrice?: number;
  currency?: string;
}

function addDaysISO(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return toISODate(d);
}

export default function BookingWidget({ propertyId, rooms }: BookingWidgetProps) {
  const router = useRouter();
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [checkIn, setCheckIn] = useState(addDaysISO(1));
  const [checkOut, setCheckOut] = useState(addDaysISO(2));
  const [guestCount, setGuestCount] = useState(2);
  const [selectedRoomId, setSelectedRoomId] = useState<string>(rooms[0]?.id ?? "");

  const availableRooms = rooms.filter((room) => room.available);

  const selectedRoom =
    availableRooms.find((room) => room.id === selectedRoomId) ?? availableRooms[0];

  const { quote, loading, error } = useQuote({
    roomId: selectedRoom?.id,
    propertyId,
    checkIn,
    checkOut,
    guests: guestCount,
  });

  const handleDateChange = (v: { checkIn: string; checkOut: string }) => {
    setCheckIn(v.checkIn);
    setCheckOut(v.checkOut);
    if (v.checkOut) setCalendarOpen(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRoom || !quote) return;

    const params = new URLSearchParams({
      propertyId,
      roomId: selectedRoom.id,
      checkIn,
      checkOut,
      guestCount: String(guestCount),
      quoteId: quote.quoteId,
    });

    router.push(`/checkout?${params.toString()}`);
  };

  const dateSummary = (() => {
    const fmt = (s: string) =>
      new Date(s).toLocaleDateString("tr-TR", { day: "numeric", month: "short", year: "numeric" });
    return checkIn && checkOut ? `${fmt(checkIn)} - ${fmt(checkOut)}` : "Tarih seçin";
  })();

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"
    >
      <h2 className="text-xl font-semibold text-gray-900">Rezervasyon Yap</h2>

      <div className="relative mt-4">
        <label className="block text-sm font-medium text-gray-700">Giriş - Çıkış</label>
        <button
          type="button"
          onClick={() => setCalendarOpen(!calendarOpen)}
          aria-expanded={calendarOpen}
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-left text-sm text-gray-900 hover:border-[#003580]"
        >
          {dateSummary}
        </button>
        {calendarOpen && (
          <div className="absolute left-0 right-0 z-20">
            <DateRangePicker
              value={{ checkIn, checkOut }}
              onChange={handleDateChange}
              monthCount={2}
            />
          </div>
        )}
      </div>

      <div className="mt-3">
        <label htmlFor="guest-count" className="block text-sm font-medium text-gray-700">
          Misafir Sayısı
        </label>
        <select
          id="guest-count"
          value={guestCount}
          onChange={(e) => setGuestCount(Number(e.target.value))}
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#003580] focus:outline-none focus:ring-1 focus:ring-[#003580]"
        >
          {[1, 2, 3, 4, 5, 6].map((count) => (
            <option key={count} value={count}>
              {count} misafir
            </option>
          ))}
        </select>
      </div>

      <div className="mt-3">
        <label htmlFor="room-select" className="block text-sm font-medium text-gray-700">
          Oda Seçimi
        </label>
        <select
          id="room-select"
          value={selectedRoom?.id ?? ""}
          onChange={(e) => setSelectedRoomId(e.target.value)}
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#003580] focus:outline-none focus:ring-1 focus:ring-[#003580]"
        >
          {availableRooms.length === 0 && <option value="">Uygun oda yok</option>}
          {availableRooms.map((room) => (
            <option key={room.id} value={room.id}>
              {room.name} - {room.capacity} kişi - {room.bedType}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-5 border-t border-gray-200 pt-4" aria-live="polite">
        {loading && <p className="text-sm text-gray-500">Fiyat hesaplanıyor…</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
        {quote && <QuoteBreakdown quote={quote} />}
      </div>

      <button
        type="submit"
        disabled={!selectedRoom || !quote}
        className="mt-5 w-full rounded-lg bg-[#003580] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#002b66] disabled:cursor-not-allowed disabled:bg-gray-300"
      >
        Rezervasyonu Onayla
      </button>
    </form>
  );
}
