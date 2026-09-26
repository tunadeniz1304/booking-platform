"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useFormat } from "@/i18n/use-format";
import DateRangePicker, { toISODate } from "@/components/search/DateRangePicker";
import QuoteBreakdown from "./QuoteBreakdown";
import PriceInsight from "./PriceInsight";
import { useQuote } from "./useQuote";
import { subscribeStaySelection } from "./stay-selection";
import AddToCartButton from "@/components/cart/AddToCartButton";

export interface BookingWidgetRatePlan {
  id: string;
  name: string;
  mealPlan: string;
  refundable: boolean;
  priceModifierBps: number;
  isDefault: boolean;
}

export interface BookingWidgetRoom {
  id: string;
  name: string;
  capacity: number;
  /** Fiyat planları (iade edilebilir / edilemez, kahvaltılı…); yoksa sunucu varsayılanı. */
  ratePlans?: BookingWidgetRatePlan[];
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
  /** Arama kartından gelen seçim (kartta gösterilen toplamla aynı teklif için). */
  initial?: {
    checkIn?: string;
    checkOut?: string;
    guests?: number;
    roomId?: string;
    ratePlanId?: string;
  };
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function addDaysISO(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return toISODate(d);
}

export default function BookingWidget({ propertyId, rooms, initial }: BookingWidgetProps) {
  const router = useRouter();
  const t = useTranslations("booking");
  const f = useFormat();
  const validStay =
    initial?.checkIn !== undefined &&
    initial.checkOut !== undefined &&
    ISO_DAY.test(initial.checkIn) &&
    ISO_DAY.test(initial.checkOut) &&
    initial.checkIn < initial.checkOut;
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [checkIn, setCheckIn] = useState(validStay ? initial!.checkIn! : addDaysISO(1));
  const [checkOut, setCheckOut] = useState(validStay ? initial!.checkOut! : addDaysISO(2));
  const [guestCount, setGuestCount] = useState(
    initial?.guests && initial.guests >= 1 ? Math.floor(initial.guests) : 2
  );
  const [selectedRoomId, setSelectedRoomId] = useState<string>(
    rooms.find((r) => r.id === initial?.roomId)?.id ?? rooms[0]?.id ?? ""
  );

  const availableRooms = rooms.filter((room) => room.available);

  const selectedRoom =
    availableRooms.find((room) => room.id === selectedRoomId) ?? availableRooms[0];
  const plans = selectedRoom?.ratePlans ?? [];
  const [selectedPlanId, setSelectedPlanId] = useState<string | undefined>(initial?.ratePlanId);
  const selectedPlan =
    plans.find((p) => p.id === selectedPlanId) ?? plans.find((p) => p.isDefault) ?? plans[0];

  const { quote, loading, error } = useQuote({
    roomId: selectedRoom?.id,
    ratePlanId: selectedPlan?.id,
    propertyId,
    checkIn,
    checkOut,
    guests: guestCount,
  });

  // P1-3: fiyat takviminden seçilen tarihler formu doldurur.
  useEffect(
    () =>
      subscribeStaySelection((s) => {
        setCheckIn(s.checkIn);
        setCheckOut(s.checkOut);
      }),
    []
  );

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
      ...(selectedPlan ? { ratePlanId: selectedPlan.id } : {}),
      checkIn,
      checkOut,
      guestCount: String(guestCount),
      quoteId: quote.quoteId,
    });

    router.push(`/checkout?${params.toString()}`);
  };

  const dateSummary = (() => {
    const fmt = (s: string) => f.date(s, "medium");
    return checkIn && checkOut ? `${fmt(checkIn)} - ${fmt(checkOut)}` : t("widget.selectDates");
  })();

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"
    >
      <h2 className="text-xl font-semibold text-gray-900">{t("widget.title")}</h2>

      <div className="relative mt-4">
        <label className="block text-sm font-medium text-gray-700">{t("widget.dates")}</label>
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
          {t("widget.guests")}
        </label>
        <select
          id="guest-count"
          value={guestCount}
          onChange={(e) => setGuestCount(Number(e.target.value))}
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#003580] focus:outline-none focus:ring-1 focus:ring-[#003580]"
        >
          {[1, 2, 3, 4, 5, 6].map((count) => (
            <option key={count} value={count}>
              {t("widget.guestOption", { count })}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-3">
        <label htmlFor="room-select" className="block text-sm font-medium text-gray-700">
          {t("widget.room")}
        </label>
        <select
          id="room-select"
          value={selectedRoom?.id ?? ""}
          onChange={(e) => setSelectedRoomId(e.target.value)}
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#003580] focus:outline-none focus:ring-1 focus:ring-[#003580]"
        >
          {availableRooms.length === 0 && <option value="">{t("widget.noRooms")}</option>}
          {availableRooms.map((room) => (
            <option key={room.id} value={room.id}>
              {t("widget.roomOption", {
                name: room.name,
                capacity: room.capacity,
                bedType: room.bedType,
              })}
            </option>
          ))}
        </select>
      </div>

      {plans.length > 1 && (
        <fieldset className="mt-3">
          <legend className="block text-sm font-medium text-gray-700">
            {t("widget.ratePlan")}
          </legend>
          <div className="mt-1 space-y-1">
            {plans.map((plan) => (
              <label key={plan.id} className="flex items-start gap-2 text-sm text-gray-800">
                <input
                  type="radio"
                  name="rate-plan"
                  value={plan.id}
                  checked={selectedPlan?.id === plan.id}
                  onChange={() => setSelectedPlanId(plan.id)}
                  className="mt-1"
                />
                <span>
                  {plan.name}
                  <span className="block text-xs text-gray-600">
                    {plan.refundable ? t("widget.refundable") : t("widget.nonRefundable")}
                    {plan.mealPlan === "BREAKFAST" ? ` · ${t("widget.breakfastIncluded")}` : ""}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <div className="mt-5 border-t border-gray-200 pt-4" aria-live="polite">
        {loading && <p className="text-sm text-gray-500">{t("widget.calculating")}</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
        {quote && <QuoteBreakdown quote={quote} />}
      </div>

      {selectedRoom && checkIn && checkOut && checkIn < checkOut && (
        <PriceInsight
          roomId={selectedRoom.id}
          checkIn={checkIn}
          checkOut={checkOut}
          guests={guestCount}
        />
      )}

      <button
        type="submit"
        disabled={!selectedRoom || !quote}
        className="mt-5 w-full rounded-lg bg-[#003580] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#002b66] disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-700"
      >
        {t("widget.submit")}
      </button>
      <AddToCartButton
        propertyId={propertyId}
        roomTypeId={selectedRoom?.id}
        ratePlanId={selectedPlan?.id}
        checkIn={checkIn}
        checkOut={checkOut}
        adults={guestCount}
        disabled={!quote}
      />
    </form>
  );
}
