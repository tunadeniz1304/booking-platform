"use client";

import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useFormat } from "@/i18n/use-format";
import { bedTypeKey } from "@/lib/i18n/bed-type";
import DateRangePicker from "@/components/search/DateRangePicker";
import QuoteBreakdown from "./QuoteBreakdown";
import { GuestCountStepper } from "./GuestCountStepper";
import PriceInsight from "./PriceInsight";
import { useQuote } from "./useQuote";
import { useQuoteError } from "./quote-error";
import { MEAL_PLAN_KEYS } from "@/lib/i18n/meal-plan";
import { publishStaySelection, subscribeStaySelection } from "./stay-selection";
import { subscribeStaySelectionClear } from "./stay-selection-clear";
import AddToCartButton from "@/components/cart/AddToCartButton";
import { Button, focusRing, useSession } from "@/components/ui/ui";

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
    /** Toplam misafir (yetişkin + çocuk); `adults` yoksa yetişkin sayısı sayılır. */
    guests?: number;
    adults?: number;
    children?: number;
    roomId?: string;
    ratePlanId?: string;
  };
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

type GuestField = "adults" | "children";

interface StayDates {
  checkIn: string;
  checkOut: string;
}

/** Misafir sayısı: tam sayı ve en az `min`; geçersizse `fallback`. */
function toCount(value: number | undefined, min: number, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value >= min
    ? Math.floor(value)
    : fallback;
}

export default function BookingWidget({ propertyId, rooms, initial }: BookingWidgetProps) {
  const router = useRouter();
  const t = useTranslations("booking");
  const ts = useTranslations("search");
  const tc = useTranslations("common");
  const f = useFormat();
  const validStay =
    initial?.checkIn !== undefined &&
    initial.checkOut !== undefined &&
    ISO_DAY.test(initial.checkIn) &&
    ISO_DAY.test(initial.checkOut) &&
    initial.checkIn < initial.checkOut;
  const [calendarOpen, setCalendarOpen] = useState(false);
  // Tarih gelmediyse alan boş kalır ("Tarih seçin"); örnek tarihle fiyat gösterilmez.
  const [checkIn, setCheckIn] = useState(validStay ? initial!.checkIn! : "");
  const [checkOut, setCheckOut] = useState(validStay ? initial!.checkOut! : "");
  // Kullanıcı bir seçimi değiştirdi mi (adres satırı ve kısa duyurular bundan sonra güncellenir).
  const [edited, setEdited] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  // Arama ve sepetle aynı misafir modeli: yetişkin + çocuk; teklif ve kapasite toplamla.
  const [adults, setAdults] = useState(() =>
    toCount(initial?.adults, 1, toCount(initial?.guests, 1, 2))
  );
  // `guests` toplamı yetişkin sayıldığında çocuklar ayrıca eklenmez (çift sayım olmasın).
  const [children, setChildren] = useState(() =>
    initial?.adults === undefined && initial?.guests !== undefined
      ? 0
      : toCount(initial?.children, 0, 0)
  );
  const guestCount = adults + children;
  // Elle yazılan misafir sayısı (taslak) ve alandan çıkınca gösterilen aralık hatası.
  const [guestDrafts, setGuestDrafts] = useState<Partial<Record<GuestField, string>>>({});
  const [guestErrors, setGuestErrors] = useState<Partial<Record<GuestField, string>>>({});
  const [navigating, startNavigation] = useTransition();
  const [selectedRoomId, setSelectedRoomId] = useState<string>(
    rooms.find((r) => r.id === initial?.roomId)?.id ?? rooms[0]?.id ?? ""
  );
  const [notice, setNotice] = useState("");
  // Kullanıcı odayı kendisi seçti mi (aramadaki odanın yerine geçme bildirimi için).
  const [roomPicked, setRoomPicked] = useState(false);
  const session = useSession();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const datesRef = useRef<HTMLDivElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  // Olay dinleyicileri güncel tarihleri buradan okur; yarım seçimle kapanışta son eksiksiz
  // aralık geri yüklenir.
  const currentDates = useRef<StayDates>({ checkIn, checkOut });
  const lastFullRange = useRef<StayDates | null>(null);
  // Fiyat takvimi yayınlamadan önceki tarihler (takvimde "Seçimi temizle" bunları geri yükler).
  const beforeCalendar = useRef<StayDates | null>(null);
  // Kendi yayınımız abonelikte yok sayılır.
  const publishing = useRef(false);
  const uid = useId();
  const titleId = `${uid}-title`;
  const datesLabelId = `${uid}-dates`;
  const datesValueId = `${uid}-dates-value`;
  const adultsId = `${uid}-adults`;
  const childrenId = `${uid}-children`;
  const capacityMsgId = `${uid}-capacity`;
  const submitHintId = `${uid}-submit-hint`;
  const submitReasonId = `${uid}-submit-reason`;
  const roomNoticeId = `${uid}-room-notice`;
  const noRoomsId = `${uid}-no-rooms`;
  const contentLang = f.locale === "tr" ? undefined : "tr";

  const availableRooms = rooms.filter((room) => room.available);

  const selectedRoom =
    availableRooms.find((room) => room.id === selectedRoomId) ?? availableRooms[0];
  // Aramada seçilen oda satışta değilse yerine gösterilen oda açıkça bildirilir.
  const roomReplaced =
    initial?.roomId !== undefined &&
    !roomPicked &&
    selectedRoom !== undefined &&
    selectedRoom.id !== initial.roomId;
  // Misafir sayısı en büyük oda kapasitesine kadar; aramadan gelen değer daima aralıkta
  // (aksi halde alan gösterdiği sayıya hiç dönemez).
  const maxCapacity = availableRooms.reduce((max, room) => Math.max(max, room.capacity), 0);
  const adultMax = Math.max(maxCapacity || 6, adults);
  const childMax = Math.max((maxCapacity || 6) - 1, children);
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
  const { quote, loading, error, code, details } = useQuote({
    roomId: overCapacity ? undefined : selectedRoom?.id,
    ratePlanId: selectedPlan?.id,
    propertyId,
    checkIn,
    checkOut,
    guests: guestCount,
    refreshKey,
  });

  useEffect(() => {
    currentDates.current = { checkIn, checkOut };
    if (checkIn && checkOut && checkIn < checkOut) lastFullRange.current = { checkIn, checkOut };
  }, [checkIn, checkOut]);

  // P1-3: fiyat takviminden seçilen tarihler formu doldurur.
  useEffect(
    () =>
      subscribeStaySelection((s) => {
        if (publishing.current) return;
        if (!beforeCalendar.current) beforeCalendar.current = currentDates.current;
        setCheckIn(s.checkIn);
        setCheckOut(s.checkOut);
        setEdited(true);
      }),
    []
  );

  // Takvimde "Seçimi temizle": takvimin yayınladığı tarihler geri alınır (yeniden yayınlanmaz).
  // Adres satırı da geri alınan tarihlerle güncellensin diye `edited` açık kalır.
  useEffect(
    () =>
      subscribeStaySelectionClear(() => {
        const before = beforeCalendar.current;
        if (!before) return;
        beforeCalendar.current = null;
        setCheckIn(before.checkIn);
        setCheckOut(before.checkOut);
        setEdited(true);
      }),
    []
  );

  const closeCalendar = useCallback((returnFocus: boolean) => {
    setCalendarOpen(false);
    // Yalnız girişle kapanınca son eksiksiz aralık geri gelir; yoksa çıkış tarihi istemi fiyat
    // alanında görünür kalır.
    const { checkIn: inNow, checkOut: outNow } = currentDates.current;
    const full = lastFullRange.current;
    if (inNow && !outNow && full) {
      setCheckIn(full.checkIn);
      setCheckOut(full.checkOut);
    }
    // Gün düğmesi DOM'dan kalktığı için odak tarih düğmesine geri verilir.
    if (returnFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  // Takvim dışına tıklama ya da odak geçişi takvimi kapatır (arkadaki alanlar örtülmesin).
  useEffect(() => {
    if (!calendarOpen) return;
    const onOutside = (e: Event) => {
      if (datesRef.current && !datesRef.current.contains(e.target as Node)) closeCalendar(false);
    };
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("focusin", onOutside);
    return () => {
      document.removeEventListener("mousedown", onOutside);
      document.removeEventListener("focusin", onOutside);
    };
  }, [calendarOpen, closeCalendar]);

  // Seçici açılınca odağı kendisi gün ızgarasına taşır.
  const openCalendar = () => setCalendarOpen(true);

  const handleDateChange = (v: StayDates) => {
    setCheckIn(v.checkIn);
    setCheckOut(v.checkOut);
    setEdited(true);
    currentDates.current = v;
    // Formdaki seçim esas alınır; fiyat takvimi de aynı aralığı gösterir.
    beforeCalendar.current = null;
    if (v.checkIn && v.checkOut && v.checkIn < v.checkOut) {
      lastFullRange.current = v;
      publishing.current = true;
      try {
        publishStaySelection(v);
      } finally {
        publishing.current = false;
      }
    }
    if (v.checkOut) closeCalendar(true);
  };

  const switchToFittingRoom = () => {
    if (!fittingRoom) return;
    setSelectedRoomId(fittingRoom.id);
    setRoomPicked(true);
    setEdited(true);
    setNotice(t("widget.roomSwitched", { name: fittingRoom.name }));
  };

  // Seçimler adres satırına yazılır (sayfa yeniden yüklenmez): checkout'tan Geri dönülünce
  // form aynı seçimle kurulur. Yarım tarih seçimi yazılmaz.
  const urlRoomId = selectedRoom?.id;
  const urlPlanId = selectedPlan?.id;
  useEffect(() => {
    if (!edited) return;
    const params = new URLSearchParams(window.location.search);
    const put = (key: string, value: string | undefined) => {
      if (value) params.set(key, value);
      else params.delete(key);
    };
    const stay = checkIn && checkOut && checkIn < checkOut;
    put("checkIn", stay ? checkIn : undefined);
    put("checkOut", stay ? checkOut : undefined);
    put("guests", String(adults + children));
    put("adults", String(adults));
    put("children", String(children));
    put("roomId", urlRoomId);
    put("ratePlanId", urlPlanId);
    const search = params.toString();
    if (search === window.location.search.replace(/^\?/, "")) return;
    const { pathname, hash } = window.location;
    window.history.replaceState(null, "", `${pathname}${search ? `?${search}` : ""}${hash}`);
  }, [edited, checkIn, checkOut, adults, children, urlRoomId, urlPlanId]);

  // F2-16: hata metni ve eylemi checkout ile ortak yardımcıdan.
  const { text: errorText, action: quoteErrorAction } = useQuoteError(error, code, details);

  const datesComplete = Boolean(checkIn && checkOut && checkIn < checkOut);
  const canSubmit = Boolean(selectedRoom && quote);
  // Devam düğmesi neden pasif: fiyat alanında görünür, düğmeye aria-describedby ile bağlı.
  const blockReason = (() => {
    if (canSubmit) return null;
    if (loading) return t("widget.calculating");
    if (errorText) return errorText;
    if (availableRooms.length === 0) return null;
    if (!datesComplete) return t(checkIn ? "widget.reasonCheckOut" : "widget.reasonDates");
    return overCapacity ? t("widget.reasonCapacity") : null;
  })();
  const reasonColor = errorText ? "text-red-600" : loading ? "text-gray-500" : "text-gray-700";
  const reasonTarget =
    availableRooms.length === 0 ? noRoomsId : blockReason ? submitReasonId : null;
  // Ekran okuyucuya yalnız kısa durum (döküm duyurulmaz); ilk yüklemede sessiz.
  const liveText = (() => {
    if (!edited) return "";
    if (loading) return notice || t("widget.calculating");
    if (errorText) return errorText;
    if (!quote) return blockReason ?? "";
    return t("widget.totalAnnounce", { total: f.money(quote.total, quote.currency) });
  })();

  const retryQuote = () => {
    setRefreshKey((k) => k + 1);
    setEdited(true);
    // Düğme yükleme sırasında kalkar; odak devam düğmesine geçer (sonuç durum bölgesinden okunur).
    submitRef.current?.focus();
  };

  // Süresi dolan teklif yenilenir; kararlı geri çağrı (her çizimde zamanlayıcı sıfırlanmasın).
  const refreshExpiredQuote = useCallback(() => setRefreshKey((k) => k + 1), []);

  const guestStepper = (field: GuestField) => {
    const isAdults = field === "adults";
    const current = isAdults ? adults : children;
    const min = isAdults ? 1 : 0;
    const max = isAdults ? adultMax : childMax;
    const parse = (raw: string) => {
      const n = Number(raw.trim());
      return raw.trim() !== "" && Number.isInteger(n) && n >= min && n <= max ? n : null;
    };
    const apply = (n: number) => {
      setGuestErrors((e) => ({ ...e, [field]: undefined }));
      if (n === current) return;
      if (isAdults) setAdults(n);
      else setChildren(n);
      setEdited(true);
      setNotice("");
    };
    return (
      <GuestCountStepper
        id={isAdults ? adultsId : childrenId}
        label={<span className="block text-sm text-gray-700">{t(`widget.${field}`)}</span>}
        value={guestDrafts[field] ?? String(current)}
        min={min}
        max={max}
        onChange={(raw) => {
          setGuestDrafts((d) => ({ ...d, [field]: raw }));
          const n = parse(raw);
          if (n !== null) apply(n);
        }}
        onStep={(n) => {
          setGuestDrafts((d) => ({ ...d, [field]: undefined }));
          apply(n);
        }}
        onCommit={() => {
          const raw = guestDrafts[field];
          if (raw === undefined) return;
          // Geçersiz yazım geri alınır; kullanılan sayı hata metninde söylenir.
          setGuestDrafts((d) => ({ ...d, [field]: undefined }));
          if (parse(raw) !== null) return;
          setGuestErrors((e) => ({
            ...e,
            [field]: t(isAdults ? "widget.adultsRange" : "widget.childrenRange", {
              min,
              max,
              current,
            }),
          }));
        }}
        decreaseLabel={ts(isAdults ? "bar.decreaseAdults" : "bar.decreaseChildren")}
        increaseLabel={ts(isAdults ? "bar.increaseAdults" : "bar.increaseChildren")}
        valueText={(n) => ts("bar.countStatus", { label: t(`widget.${field}`), count: n })}
        error={guestErrors[field]}
        describedBy={overCapacity ? capacityMsgId : undefined}
      />
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Yönlendirme sürerken ikinci gönderim yok sayılır.
    if (navigating) return;
    if (!selectedRoom || !quote) {
      if (!datesComplete) openCalendar();
      return;
    }

    const params = new URLSearchParams({
      propertyId,
      roomId: selectedRoom.id,
      ...(selectedPlan ? { ratePlanId: selectedPlan.id } : {}),
      checkIn,
      checkOut,
      guestCount: String(guestCount),
      // F2-13: yetişkin/çocuk ayrımı checkout ve geri dönüşte korunur.
      adults: String(adults),
      children: String(children),
      quoteId: quote.quoteId,
    });

    // Geçiş sürerken düğme meşgul görünür (yavaş ağda geri bildirim, çift tıklama yok).
    startNavigation(() => router.push(`/checkout?${params.toString()}`));
  };

  // Planlar arası fark: en ucuz plana göre yüzde (plan baz puanlarından; toplam teklifte).
  const cheapestBps = plans.reduce(
    (min, p) => Math.min(min, p.priceModifierBps),
    Number.POSITIVE_INFINITY
  );
  const mixedMeals = new Set(plans.map((p) => p.mealPlan)).size > 1;
  const planDetail = (plan: BookingWidgetRatePlan) => {
    const refund = plan.refundable ? t("widget.refundable") : t("widget.nonRefundable");
    // Plan adı iade metninin başıyla aynıysa ("İade edilemez / İade edilemez: …") tekrar edilmez.
    const name = plan.name.trim();
    const repeated = refund
      .toLocaleLowerCase(f.locale)
      .startsWith(name.toLocaleLowerCase(f.locale));
    const rest = repeated ? refund.slice(name.length).replace(/^[\s:—–-]+/, "") : refund;
    const parts = rest ? [rest] : [];
    const mealKey = MEAL_PLAN_KEYS[plan.mealPlan];
    // "Yalnız oda" yalnız planlar arasında yemek farkı varsa yazılır.
    if (mealKey && (plan.mealPlan !== "ROOM_ONLY" || mixedMeals)) parts.push(t(mealKey));
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
    if (checkIn && checkOut) return `${fmt(checkIn)} - ${fmt(checkOut)}`;
    if (checkIn) return t("widget.checkInOnly", { date: fmt(checkIn) });
    return t("widget.selectDates");
  })();

  return (
    <form
      onSubmit={handleSubmit}
      aria-labelledby={titleId}
      className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"
    >
      <h2 id={titleId} className="text-xl font-semibold text-gray-900">
        {t("widget.title")}
      </h2>

      <div className="relative mt-4" ref={datesRef}>
        <span id={datesLabelId} className="block text-sm font-medium text-gray-700">
          {t("widget.dates")}
        </span>
        <button
          ref={triggerRef}
          type="button"
          onClick={() => (calendarOpen ? closeCalendar(false) : openCalendar())}
          aria-expanded={calendarOpen}
          aria-haspopup="dialog"
          aria-labelledby={`${datesLabelId} ${datesValueId}`}
          className={`mt-1 min-h-[44px] w-full rounded-lg border border-gray-500 px-3 py-2 text-left text-base text-gray-900 hover:border-[#003580] sm:text-sm ${focusRing}`}
        >
          <span id={datesValueId}>{dateSummary}</span>
        </button>
        {calendarOpen && (
          // Seçici dar kapsayıcıda kendiliğinden tek aya düşer; gün düğmeleri hücreye sığar.
          <div className="absolute left-0 right-0 z-20">
            {/* Adım ve gece sayısı satırı seçicinin kendisinde. */}
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

      <fieldset className="mt-3">
        <legend className="block text-sm font-medium text-gray-700">{t("widget.guests")}</legend>
        <div className="mt-1 flex flex-wrap gap-x-6 gap-y-3">
          {guestStepper("adults")}
          {guestStepper("children")}
        </div>
      </fieldset>

      <div className="mt-3">
        {availableRooms.length === 0 ? (
          // Boş durum: seçilemeyen bir liste yerine açıklama ve aramaya dönüş yolu.
          <div id={noRoomsId} className="text-sm text-gray-700">
            <p className="font-medium text-gray-700">{t("widget.room")}</p>
            <p className="mt-1">{t("widget.noRooms")}</p>
            <Link
              href="/search"
              className={`inline-flex min-h-[44px] items-center font-semibold text-[#003580] underline sm:min-h-0 ${focusRing}`}
            >
              {t("widget.searchOther")}
            </Link>
          </div>
        ) : (
          <>
            <label htmlFor="room-select" className="block text-sm font-medium text-gray-700">
              {t("widget.room")}
            </label>
            <select
              id="room-select"
              value={selectedRoom?.id ?? ""}
              onChange={(e) => {
                setSelectedRoomId(e.target.value);
                setRoomPicked(true);
                setEdited(true);
                setNotice("");
              }}
              aria-invalid={overCapacity || undefined}
              aria-describedby={
                [overCapacity ? capacityMsgId : "", roomReplaced ? roomNoticeId : ""]
                  .filter(Boolean)
                  .join(" ") || undefined
              }
              className={`mt-1 min-h-[44px] w-full rounded-lg border border-gray-500 px-3 py-2 text-base focus:border-[#003580] sm:text-sm ${focusRing}`}
            >
              {availableRooms.map((room) => {
                // Yatak tipi kodu arayüz dilinde; eski serbest metin olduğu gibi gösterilir.
                const bedKey = bedTypeKey(room.bedType);
                return (
                  <option key={room.id} value={room.id}>
                    {t(
                      room.capacity < guestCount
                        ? "widget.roomOptionTooSmall"
                        : "widget.roomOption",
                      {
                        name: room.name,
                        capacity: room.capacity,
                        bedType: bedKey ? tc(bedKey) : room.bedType,
                        guests: guestCount,
                      }
                    )}
                  </option>
                );
              })}
            </select>
          </>
        )}
        {roomReplaced && selectedRoom && (
          <p id={roomNoticeId} role="status" className="mt-1 text-sm text-gray-700">
            {t("widget.roomReplaced", { name: selectedRoom.name })}
          </p>
        )}
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
                  onChange={() => {
                    setSelectedPlanId(plan.id);
                    setEdited(true);
                  }}
                  // F2-59: hedef en az 20px; satırın tamamı (etiket) de tıklanabilir.
                  className={`h-5 w-5 shrink-0 ${focusRing}`}
                />
                <span>
                  <span lang={contentLang}>{plan.name}</span>
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
          <span lang={contentLang}>{plans[0].name}</span>
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

      <div className="mt-5 border-t border-gray-200 pt-4">
        {notice && <p className="mb-2 text-sm text-gray-700">{notice}</p>}
        {blockReason && (
          <p id={submitReasonId} className={`text-sm ${reasonColor}`}>
            {blockReason}
          </p>
        )}
        {quoteErrorAction && (
          <Button
            variant="secondary"
            className="mt-2 min-h-[44px] sm:min-h-0"
            onClick={quoteErrorAction === "dates" ? openCalendar : retryQuote}
          >
            {quoteErrorAction === "dates" ? t("widget.pickOtherDates") : t("widget.retry")}
          </Button>
        )}
        {quote && <QuoteBreakdown quote={quote} heading="h3" onExpire={refreshExpiredQuote} />}
        <p className="sr-only" role="status">
          {liveText}
        </p>
      </div>

      {/* Pasifken de odaklanabilir (aria-disabled); nedeni aria-describedby ile okunur. */}
      <button
        ref={submitRef}
        type="submit"
        aria-disabled={!canSubmit || undefined}
        aria-busy={navigating || undefined}
        aria-describedby={reasonTarget ? `${reasonTarget} ${submitHintId}` : submitHintId}
        className={`mt-5 w-full rounded-lg bg-[#003580] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#002b66] aria-disabled:cursor-not-allowed aria-disabled:bg-gray-300 aria-disabled:text-gray-700 ${focusRing}`}
      >
        {navigating ? t("widget.continuing") : t("widget.submit")}
      </button>
      <p id={submitHintId} className="mt-1 text-xs text-gray-500">
        {t("widget.submitHint")}
        {session.status === "ready" && !session.user && ` ${t("widget.loginNext")}`}
      </p>
      <AddToCartButton
        propertyId={propertyId}
        roomTypeId={selectedRoom?.id}
        ratePlanId={selectedPlan?.id}
        checkIn={checkIn}
        checkOut={checkOut}
        adults={adults}
        childCount={children}
        disabled={!quote}
      />

      {/* Ana düğmelerden sonra: değerlendirme içeriği devam düğmesini aşağı itmez. Teklif
          hatasında ya da kapasite aşımında gecelik fiyat değerlendirmesi gösterilmez. */}
      {selectedRoom && datesComplete && !errorText && !overCapacity && (
        <PriceInsight
          roomId={selectedRoom.id}
          checkIn={checkIn}
          checkOut={checkOut}
          guests={guestCount}
          user={session.status === "ready" ? session.user : undefined}
        />
      )}
    </form>
  );
}
