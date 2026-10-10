"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useFormat } from "@/i18n/use-format";
import DateRangePicker, { toISODate } from "@/components/search/DateRangePicker";
import QuoteBreakdown from "./QuoteBreakdown";
import PriceInsight from "./PriceInsight";
import { useQuote } from "./useQuote";
import { subscribeStaySelection } from "./stay-selection";
import AddToCartButton from "@/components/cart/AddToCartButton";
import { Button, focusRing } from "@/components/ui/ui";

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
  priceModifierMinor: number;
  available: boolean;
}

interface BookingWidgetProps {
  propertyId: string;
  rooms: BookingWidgetRoom[];
  /** Yalnızca "başlangıç fiyatı" gösterimi için; toplam daima sunucu teklifinden gelir. */
  basePriceMinor?: number;
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

/** Arayüz dilinde gösterilen teklif hata kodları (sunucu metni yalnız bilinmeyen kodda). */
const QUOTE_ERROR_CODES = new Set(["SOLD_OUT", "RESTRICTED", "NOT_FOUND"]);

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
  const [notice, setNotice] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const datesRef = useRef<HTMLDivElement>(null);
  const uid = useId();
  const datesLabelId = `${uid}-dates`;
  const capacityMsgId = `${uid}-capacity`;
  const submitHintId = `${uid}-submit-hint`;

  const availableRooms = rooms.filter((room) => room.available);

  const selectedRoom =
    availableRooms.find((room) => room.id === selectedRoomId) ?? availableRooms[0];
  // Misafir seçenekleri en büyük oda kapasitesine kadar; aramadan gelen değer daima listede
  // (aksi halde kontrollü select ilk seçeneği gösterirken teklif başka sayıyla hesaplanır).
  const maxCapacity = availableRooms.reduce((max, room) => Math.max(max, room.capacity), 0);
  const guestMax = Math.max(maxCapacity || 6, guestCount);
  const overCapacity = selectedRoom !== undefined && guestCount > selectedRoom.capacity;
  // Misafir sayısına yeten en küçük oda (kapasite aşımında öneri).
  const fittingRoom = availableRooms
    .filter((room) => room.capacity >= guestCount)
    .sort((a, b) => a.capacity - b.capacity)[0];

  const plans = selectedRoom?.ratePlans ?? [];
  const [selectedPlanId, setSelectedPlanId] = useState<string | undefined>(initial?.ratePlanId);
  const selectedPlan =
    plans.find((p) => p.id === selectedPlanId) ?? plans.find((p) => p.isDefault) ?? plans[0];

  // Kapasite aşımında teklif istenmez; uyarı istemcide, arayüz dilinde gösterilir.
  const { quote, loading, error, code } = useQuote({
    roomId: overCapacity ? undefined : selectedRoom?.id,
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

  const closeCalendar = (returnFocus: boolean) => {
    setCalendarOpen(false);
    // Gün düğmesi DOM'dan kalktığı için odak tarih düğmesine geri verilir.
    if (returnFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  };

  // Takvim dışına tıklama ya da odak geçişi takvimi kapatır (arkadaki alanlar örtülmesin).
  useEffect(() => {
    if (!calendarOpen) return;
    const onOutside = (e: Event) => {
      if (datesRef.current && !datesRef.current.contains(e.target as Node)) setCalendarOpen(false);
    };
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("focusin", onOutside);
    return () => {
      document.removeEventListener("mousedown", onOutside);
      document.removeEventListener("focusin", onOutside);
    };
  }, [calendarOpen]);

  const handleDateChange = (v: { checkIn: string; checkOut: string }) => {
    setCheckIn(v.checkIn);
    setCheckOut(v.checkOut);
    if (v.checkOut) closeCalendar(true);
  };

  const switchToFittingRoom = () => {
    if (!fittingRoom) return;
    setSelectedRoomId(fittingRoom.id);
    setNotice(t("widget.roomSwitched", { name: fittingRoom.name }));
  };

  const errorText =
    error === null
      ? null
      : code && QUOTE_ERROR_CODES.has(code)
        ? t(`widget.errors.${code}`)
        : error;

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

  // Planlar arası fark: en ucuz plana göre yüzde (plan baz puanlarından; toplam teklifte).
  const cheapestBps = plans.reduce(
    (min, p) => Math.min(min, p.priceModifierBps),
    Number.POSITIVE_INFINITY
  );
  const planDetail = (plan: BookingWidgetRatePlan) => {
    const refund = plan.refundable ? t("widget.refundable") : t("widget.nonRefundable");
    // Plan adı iade metninin başıyla aynıysa ("İade edilemez / İade edilemez: …") tekrar edilmez.
    const name = plan.name.trim();
    const repeated = refund
      .toLocaleLowerCase(f.locale)
      .startsWith(name.toLocaleLowerCase(f.locale));
    const rest = repeated ? refund.slice(name.length).replace(/^[\s:—–-]+/, "") : refund;
    const parts = rest ? [rest] : [];
    if (plan.mealPlan === "BREAKFAST") parts.push(t("widget.breakfastIncluded"));
    if (plans.length > 1) {
      const delta = plan.priceModifierBps - cheapestBps;
      parts.push(
        delta > 0
          ? t("widget.planDelta", { percent: String(Math.round(delta / 10) / 10) })
          : t("widget.planCheapest")
      );
    }
    return parts.join(" · ");
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

      <div className="relative mt-4" ref={datesRef}>
        <span id={datesLabelId} className="block text-sm font-medium text-gray-700">
          {t("widget.dates")}
        </span>
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setCalendarOpen(!calendarOpen)}
          aria-expanded={calendarOpen}
          aria-haspopup="dialog"
          aria-describedby={datesLabelId}
          className={`mt-1 min-h-[44px] w-full rounded-lg border border-gray-300 px-3 py-2 text-left text-sm text-gray-900 hover:border-[#003580] ${focusRing}`}
        >
          {dateSummary}
        </button>
        {calendarOpen && (
          // Seçici dar kapsayıcıda kendiliğinden tek aya düşer; gün düğmeleri hücreye sığar.
          <div className="absolute left-0 right-0 z-20">
            <DateRangePicker
              value={{ checkIn, checkOut }}
              onChange={handleDateChange}
              onClose={() => closeCalendar(true)}
              monthCount={2}
            />
            <div className="mt-1 flex justify-end">
              <Button
                variant="secondary"
                className="min-h-[44px] sm:min-h-0"
                onClick={() => closeCalendar(true)}
              >
                {t("widget.closeCalendar")}
              </Button>
            </div>
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
          onChange={(e) => {
            setGuestCount(Number(e.target.value));
            setNotice("");
          }}
          aria-invalid={overCapacity || undefined}
          aria-describedby={overCapacity ? capacityMsgId : undefined}
          className="mt-1 min-h-[44px] w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#003580] focus:outline-none focus:ring-1 focus:ring-[#003580]"
        >
          {Array.from({ length: guestMax }, (_, i) => i + 1).map((count) => (
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
          onChange={(e) => {
            setSelectedRoomId(e.target.value);
            setNotice("");
          }}
          aria-invalid={overCapacity || undefined}
          aria-describedby={overCapacity ? capacityMsgId : undefined}
          className="mt-1 min-h-[44px] w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#003580] focus:outline-none focus:ring-1 focus:ring-[#003580]"
        >
          {availableRooms.length === 0 && <option value="">{t("widget.noRooms")}</option>}
          {availableRooms.map((room) => (
            <option key={room.id} value={room.id}>
              {t(room.capacity < guestCount ? "widget.roomOptionTooSmall" : "widget.roomOption", {
                name: room.name,
                capacity: room.capacity,
                bedType: room.bedType,
                guests: guestCount,
              })}
            </option>
          ))}
        </select>
        {overCapacity && selectedRoom && (
          <div id={capacityMsgId} className="mt-1 text-sm text-red-600">
            <p>
              {fittingRoom
                ? t("widget.overCapacity", { capacity: selectedRoom.capacity })
                : t("widget.overCapacityNoRoom", { capacity: maxCapacity, guests: guestCount })}
            </p>
            {fittingRoom && (
              <Button
                variant="secondary"
                className="mt-2 min-h-[44px] w-full sm:min-h-0"
                onClick={switchToFittingRoom}
              >
                {t("widget.switchRoom", { name: fittingRoom.name, capacity: fittingRoom.capacity })}
              </Button>
            )}
          </div>
        )}
      </div>

      {plans.length > 1 && (
        <fieldset className="mt-3">
          <legend className="block text-sm font-medium text-gray-700">
            {t("widget.ratePlan")}
          </legend>
          <div className="mt-1 space-y-1">
            {plans.map((plan) => (
              <label
                key={plan.id}
                className="flex min-h-[44px] items-start gap-2 py-1 text-sm text-gray-800 sm:min-h-0"
              >
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
                  <span className="block text-xs text-gray-600">{planDetail(plan)}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {plans.length === 1 && (
        // Tek planda da iade ve yemek koşulu görünür olmalı.
        <p className="mt-3 text-sm text-gray-800">
          {plans[0].name}
          <span className="block text-xs text-gray-600">{planDetail(plans[0])}</span>
        </p>
      )}
      {plans.length > 0 && (
        <a
          href="#policies"
          className={`mt-1 inline-flex min-h-[44px] items-center text-xs font-semibold text-[#003580] underline sm:min-h-0 ${focusRing}`}
        >
          {t("widget.policyLink")}
        </a>
      )}

      <div className="mt-5 border-t border-gray-200 pt-4" aria-live="polite" aria-busy={loading}>
        {notice && <p className="mb-2 text-sm text-gray-700">{notice}</p>}
        {loading && <p className="text-sm text-gray-500">{t("widget.calculating")}</p>}
        {errorText && <p className="text-sm text-red-600">{errorText}</p>}
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
        aria-describedby={submitHintId}
        className="mt-5 w-full rounded-lg bg-[#003580] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#002b66] disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-700"
      >
        {t("widget.submit")}
      </button>
      <p id={submitHintId} className="mt-1 text-xs text-gray-500">
        {t("widget.submitHint")}
      </p>
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
