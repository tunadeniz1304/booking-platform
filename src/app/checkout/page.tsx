"use client";

import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import QuoteBreakdown from "@/components/booking/QuoteBreakdown";
import { useQuote, type QuoteView } from "@/components/booking/useQuote";
import CouponField from "@/components/booking/CouponField";
import { ResendVerificationButton } from "@/components/auth/AuthCard";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import {
  Button,
  focusRing,
  loginHref,
  useErrorText,
  usePageHeadingFocus,
  useSession,
} from "@/components/ui/ui";
import { ApiError, apiFetch, isNetworkError } from "@/lib/api-client";
import { useFormat } from "@/i18n/use-format";
import { bedTypeKey } from "@/lib/i18n/bed-type";

interface CheckoutRatePlan {
  id: string;
  name: string;
  mealPlan: string;
  refundable: boolean;
  isDefault: boolean;
}

interface CheckoutProperty {
  id: string;
  title: string;
  location: { city: string; country: string };
  rooms: Array<{ id: string; name: string; bedType: string; ratePlans?: CheckoutRatePlan[] }>;
}

/**
 * Ödeme adımı yerine kullanıcı eylemi gerektiren hata kodları (çözüm yolu gösterilir).
 * `retryable`: ağ kopması/sunucu hatası; aynı Idempotency-Key ile yeniden denemek güvenlidir.
 */
type SubmitError = { message: string; code?: string; retryable?: boolean };

/** URL'deki konaklama bilgisi neden kullanılamıyor (F746). */
type InvalidStay = "dates" | "past" | "guests" | null;

/** Son gösterilen teklif ve (toplam değiştiyse) bir önceki toplam (F749). */
type PriceTrail = { last: QuoteView | null; previous: number | null };

/** PRICE_CHANGED yanıtındaki `details`: önceki ve güncel toplam (F749). */
function priceChangeOf(
  details: unknown
): { previousTotal: number; currentTotal: number; currency: string } | null {
  if (!details || typeof details !== "object") return null;
  const d = details as Record<string, unknown>;
  return typeof d.previousTotal === "number" &&
    typeof d.currentTotal === "number" &&
    typeof d.currency === "string"
    ? { previousTotal: d.previousTotal, currentTotal: d.currentTotal, currency: d.currency }
    : null;
}

/** Giriş/çıkış günü hafta günüyle; son kontrolde gün ile ay karışmaz (F756, F757). */
function stayDay(locale: string, value: string): string {
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}

/**
 * Idempotency-Key checkout açılışında BİR KEZ üretilir ve sekme boyunca saklanır:
 * çift tıklama, ağ yeniden denemesi veya sayfa yenilemesi aynı rezervasyonu döndürür.
 * Rezervasyon başarıyla oluşunca `reset` anahtarı siler ve yenisini üretir; böylece aynı
 * sekmede yeniden rezervasyon denemesi iptal edilmiş/süresi dolmuş eski kayda düşmez (F5).
 */
function useStableIdempotencyKey(scope: string): { key: string | null; reset: () => void } {
  const [key, setKey] = useState<string | null>(null);
  const storageKey = `checkout-idem:${scope}`;
  useEffect(() => {
    let value: string | null = null;
    try {
      value = sessionStorage.getItem(storageKey);
      if (!value) {
        value = crypto.randomUUID();
        sessionStorage.setItem(storageKey, value);
      }
    } catch {
      value = crypto.randomUUID();
    }
    const timer = setTimeout(() => setKey(value), 0);
    return () => clearTimeout(timer);
  }, [storageKey]);
  const reset = useCallback(() => {
    const next = crypto.randomUUID();
    try {
      sessionStorage.setItem(storageKey, next);
    } catch {
      // sessionStorage yoksa yalnız bellekteki anahtar yenilenir
    }
    setKey(next);
  }, [storageKey]);
  return { key, reset };
}

function nightsBetween(checkIn: string, checkOut: string): number | null {
  const a = Date.parse(`${checkIn}T00:00:00Z`);
  const b = Date.parse(`${checkOut}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b) || b <= a) return null;
  return Math.round((b - a) / 86_400_000);
}

/** `YYYY-MM-DD` biçiminde gerçek bir takvim günü mü? */
function isIsoDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * Kabul edilen en erken giriş günü: saat dilimi farkıyla geçerli bir "bugün" reddedilmesin diye
 * UTC'ye göre bir gün pay bırakılır; kesin kontrolü sunucu yapar.
 */
function earliestCheckIn(): string {
  return new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
}

function CheckoutFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      {children}
      <Footer />
    </div>
  );
}

function CheckoutContent() {
  const t = useTranslations("checkout");
  const tq = useTranslations("quote");
  const tc = useTranslations("common");
  const router = useRouter();
  const searchParams = useSearchParams();
  const f = useFormat();
  const errorText = useErrorText();
  const session = useSession();
  const formRef = useRef<HTMLFormElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const inFlight = useRef(false);
  const h1Ref = usePageHeadingFocus();

  const propertyId = searchParams.get("propertyId") ?? "";
  const roomId = searchParams.get("roomId") ?? "";
  const checkIn = searchParams.get("checkIn") ?? "";
  const checkOut = searchParams.get("checkOut") ?? "";
  // İlan sayfası `guests` kullanır; ikisi de kabul edilir (F1005).
  const guestParam = searchParams.get("guestCount") ?? searchParams.get("guests");
  const guestCount = guestParam === null ? 1 : Number(guestParam);
  const ratePlanId = searchParams.get("ratePlanId") ?? undefined;

  // Eski yer imi / bozuk bağlantı: boş fiyat kutusu ve "NaN" yerine nedeni gösterilir (F746).
  const [minCheckIn] = useState(earliestCheckIn);
  const missing = !propertyId || !roomId || !checkIn || !checkOut;
  const datesValid = isIsoDay(checkIn) && isIsoDay(checkOut) && checkIn < checkOut;
  const guestsValid = Number.isInteger(guestCount) && guestCount >= 1;
  const invalid: InvalidStay = missing
    ? null
    : !datesValid
      ? "dates"
      : checkIn < minCheckIn
        ? "past"
        : !guestsValid
          ? "guests"
          : null;

  const [property, setProperty] = useState<CheckoutProperty | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<SubmitError | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  // Giriş dönüşünde kupon kaybolmasın diye URL'deki `coupon` ile başlar (F226).
  const [couponCode, setCouponCode] = useState(() => searchParams.get("coupon") ?? "");

  const { key: idempotencyKey, reset: resetIdempotencyKey } = useStableIdempotencyKey(
    `${propertyId}:${roomId}:${checkIn}:${checkOut}:${guestCount}:${couponCode.toUpperCase()}`
  );
  const {
    quote,
    loading: quoteLoading,
    error: quoteError,
    code: quoteErrorCode,
  } = useQuote({
    roomId,
    propertyId,
    // Geçersiz bilgiyle teklif istenmez (anahtar boş kalır).
    checkIn: invalid ? undefined : checkIn,
    checkOut,
    guests: guestCount,
    ratePlanId,
    refreshKey,
    couponCode: couponCode || undefined,
  });

  // Yeniden hesaplama sürerken önceki toplam görünür; kupon ya da fiyat değişince eski ve yeni
  // toplam yan yana gösterilir (F749). Türetilmiş durum render sırasında güncellenir.
  const [priceTrail, setPriceTrail] = useState<PriceTrail>({ last: null, previous: null });
  if (quote && quote !== priceTrail.last) {
    const last = priceTrail.last;
    setPriceTrail({
      last: quote,
      previous:
        last && last.currency === quote.currency && last.total !== quote.total ? last.total : null,
    });
  }

  useEffect(() => {
    if (!propertyId) return;
    let active = true;
    fetch(`/api/properties/${propertyId}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error())))
      .then((data: CheckoutProperty) => {
        if (!active) return;
        setProperty(data);
        setLoadError(null);
      })
      .catch(() => {
        if (active) setLoadError(t("loadFailed"));
      });
    return () => {
      active = false;
    };
  }, [propertyId, t, loadAttempt]);

  const room = property?.rooms.find((r) => r.id === roomId) ?? null;
  const plans = room?.ratePlans ?? [];
  const plan =
    plans.find((p) => p.id === ratePlanId) ??
    (ratePlanId ? undefined : (plans.find((p) => p.isDefault) ?? plans[0]));
  const nights = nightsBetween(checkIn, checkOut);
  // Yatak tipi kodu arayüz dilinde; eski serbest metin olduğu gibi (F1306).
  const bedKey = room ? bedTypeKey(room.bedType) : null;
  const bedLabel = bedKey ? tc(bedKey) : (room?.bedType ?? "");

  /** Süresi dolan teklif gönderimden önce yeniden alınır (F1393). */
  const refreshExpiredQuote = useCallback(() => setRefreshKey((k) => k + 1), [setRefreshKey]);

  // İlana dönüşte yalnız geçerli seçimler taşınır; geçmiş/bozuk tarih yeniden seçtirilir.
  const propertyParams = new URLSearchParams();
  if (datesValid && checkIn >= minCheckIn) {
    propertyParams.set("checkIn", checkIn);
    propertyParams.set("checkOut", checkOut);
  }
  if (guestsValid) propertyParams.set("guests", String(guestCount));
  if (roomId) propertyParams.set("roomId", roomId);
  if (ratePlanId) propertyParams.set("ratePlanId", ratePlanId);
  const propertyQuery = propertyParams.toString();
  const propertyHref = propertyId
    ? `/property/${encodeURIComponent(propertyId)}${propertyQuery ? `?${propertyQuery}` : ""}`
    : "/";

  /** Giriş dönüş adresi: uygulanan kupon da URL'de taşınır. */
  const returnTo = () => {
    const params = new URLSearchParams(searchParams.toString());
    if (couponCode) params.set("coupon", couponCode);
    else params.delete("coupon");
    return `/checkout?${params.toString()}`;
  };

  /** Giriş/kayıt bağlantısı: dönüş adresi + giriş sayfasında bağlam metni için `reason` (F494). */
  const authHref = (base: "/login" | "/register" = "/login") => {
    const href = loginHref(returnTo(), base);
    return `${href}${href.includes("?") ? "&" : "?"}reason=checkout`;
  };

  /** "Tekrar dene": odak ana düğmeye taşınır (hata kutusu kapanınca odak kaybolmaz). */
  const retrySubmit = () => {
    submitRef.current?.focus();
    formRef.current?.requestSubmit();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quote || !idempotencyKey || inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setError(null);

    try {
      // apiFetch: erişim token'ı dolmuşsa bir kez oturumu tazeleyip isteği tekrarlar (F103).
      const data = await apiFetch<{ booking?: { id?: string } }>("/api/bookings", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({
          propertyId,
          roomId,
          checkIn,
          checkOut,
          guestCount,
          quoteId: quote.quoteId,
          ...(ratePlanId ? { ratePlanId } : {}),
          // Yalnız teklifte uygulanan kupon gönderilir (uygulanamayan kupon rezervasyonu engeller).
          ...(quote.coupon?.status === "APPLIED" ? { couponCode: quote.coupon.code } : {}),
        }),
      });
      const bookingId = data?.booking?.id;
      if (!bookingId) {
        setError({ message: t("createFailed"), retryable: true });
        inFlight.current = false;
        setSubmitting(false);
        return;
      }
      // Aynı sekmede sonraki deneme yeni rezervasyon açsın (F5).
      resetIdempotencyKey();
      router.push(`/booking/${bookingId}`);
    } catch (err) {
      inFlight.current = false;
      if (err instanceof ApiError) {
        if (err.status === 401) {
          // push: checkout geçmişte kalır; girişten Geri ile dönülebilir (F494).
          setSubmitting(false);
          router.push(authHref());
          return;
        }
        if (err.code === "COUPON_EXHAUSTED" || err.code === "COUPON_NOT_APPLICABLE") {
          setRefreshKey((k) => k + 1);
        }
        if (err.code === "PRICE_CHANGED" || err.code === "QUOTE_EXPIRED") {
          setRefreshKey((k) => k + 1);
          // Sunucu önceki ve güncel toplamı gönderir; kullanıcı farkı hatırlamak zorunda kalmaz.
          const change = err.code === "PRICE_CHANGED" ? priceChangeOf(err.details) : null;
          setError({
            message: change
              ? t("priceChangedFromTo", {
                  previous: f.money(change.previousTotal, change.currency),
                  current: f.money(change.currentTotal, change.currency),
                })
              : err.code === "PRICE_CHANGED"
                ? t("priceChanged")
                : t("quoteExpired"),
            code: err.code,
          });
        } else {
          // Kodsuz/5xx hatada ve arayüz dilinde olmayan sunucu iletisinde `createFailed` (F748).
          setError({
            message: errorText(err, t("createFailed")),
            code: err.code,
            retryable: err.status >= 500,
          });
        }
      } else {
        // Ağ kopması ya da okunamayan yanıt: ham tarayıcı/JS metni gösterilmez (F495, F748).
        setError({
          message: isNetworkError(err) ? errorText(err) : t("createFailed"),
          retryable: true,
        });
      }
      setSubmitting(false);
    }
  };

  if (missing || invalid || loadError) {
    const title = missing ? t("missingTitle") : invalid ? t("invalidTitle") : t("loadFailedTitle");
    const hint = missing
      ? t("missingHint")
      : invalid === "dates"
        ? t("invalidDatesHint")
        : invalid === "past"
          ? t("pastDatesHint")
          : invalid === "guests"
            ? t("invalidGuestsHint")
            : t("loadFailedHint");
    return (
      <CheckoutFrame>
        <main
          id="main"
          className="mx-auto flex min-h-[60vh] w-full max-w-3xl flex-1 items-center justify-center px-4"
        >
          <div className="text-center">
            {/* Yükleme hatası sonradan oluşur; başlık ve açıklama duyurulur (F750). */}
            <div role={!missing && !invalid ? "alert" : undefined}>
              <h1
                ref={h1Ref}
                tabIndex={-1}
                className="text-2xl font-bold text-gray-900 focus:outline-none"
              >
                {title}
              </h1>
              <p className="mt-2 text-gray-600">{hint}</p>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
              {!missing && !invalid && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setLoadError(null);
                    setLoadAttempt((n) => n + 1);
                  }}
                >
                  {t("retry")}
                </Button>
              )}
              {propertyId && (
                <Link
                  href={propertyHref}
                  className={`inline-flex min-h-[44px] items-center text-primary-600 hover:underline ${focusRing}`}
                >
                  {t("backToProperty")}
                </Link>
              )}
              {/* Eksik bağlantıda seçim yeniden aranarak kurulur; ana sayfa değil (F750). */}
              <Link
                href={missing ? "/search" : "/"}
                className={`inline-flex min-h-[44px] items-center text-primary-600 hover:underline ${focusRing}`}
              >
                {missing ? t("searchAgain") : t("backHome")}
              </Link>
            </div>
          </div>
        </main>
      </CheckoutFrame>
    );
  }

  // Gönderim sürerken `disabled` yerine aria-disabled: odak düğmede kalır (F495).
  const submitDisabled = !quote || !idempotencyKey;
  const signedOut = session.status === "ready" && !session.user;
  const couponStatus = couponCode ? quote?.coupon?.status : undefined;
  const couponText = !couponStatus
    ? ""
    : tq.has(`couponStatus.${couponStatus}`)
      ? tq(`couponStatus.${couponStatus}`)
      : tq("couponStatus.other");
  // Kupon/fiyat değişiminde eski ve yeni toplam birlikte (F749).
  const totalChange =
    quote && priceTrail.last === quote && priceTrail.previous !== null
      ? t("totalChanged", {
          previous: f.money(priceTrail.previous, quote.currency),
          current: f.money(quote.total, quote.currency),
        })
      : "";
  // Fiyat bölümü yerine yalnız değişen bilgi duyurulur: kupon sonucu + güncel toplam (F591).
  const totalText = quote
    ? totalChange || t("totalStatus", { total: f.money(quote.total, quote.currency) })
    : "";
  const priceStatus = quote ? `${couponText} ${totalText}`.trim() : "";
  // Yer tutucu: "…" ekran okuyucuda "üç nokta" diye okunmaz, "Yükleniyor" duyulur (F1228).
  const loadingValue = (
    <>
      <span aria-hidden="true">…</span>
      <span className="sr-only">{t("loading")}</span>
    </>
  );
  // Gönder düğmesi neden devre dışı: hesaplanıyor / dolu / fiyat alınamadı (F758).
  const soldOut = quoteErrorCode === "SOLD_OUT";
  const submitReasonIds = quote
    ? ""
    : quoteLoading
      ? "checkout-quote-loading"
      : soldOut
        ? "checkout-quote-error"
        : "checkout-submit-reason";

  return (
    <CheckoutFrame>
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <Link
          href={propertyHref}
          className={`inline-flex min-h-[44px] items-center text-sm text-primary-600 hover:underline ${focusRing}`}
        >
          {t("backToProperty")}
        </Link>
        {/* Adım göstergesi: bu sayfa rezervasyonu bitirmez, ödeme sonraki adımdadır (F498).
            Geçerli adım renge ek olarak "Adım 1/3" metni ve kalın yazıyla belirtilir (F751). */}
        <p className="mt-2 text-sm font-medium text-gray-900">
          {t("steps.position", { current: 1, total: 3 })}
        </p>
        <ol
          aria-label={t("steps.label")}
          className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-gray-600"
        >
          <li aria-current="step" className="font-semibold text-gray-900">
            {t("steps.details")}
          </li>
          <li>
            <span aria-hidden="true">· </span>
            {t("steps.payment")}
          </li>
          <li>
            <span aria-hidden="true">· </span>
            {t("steps.confirmation")}
          </li>
        </ol>
        <h1
          ref={h1Ref}
          tabIndex={-1}
          className="mt-2 text-2xl font-bold text-gray-900 focus:outline-none"
        >
          {t("title")}
        </h1>

        <form
          ref={formRef}
          onSubmit={handleSubmit}
          className="mt-6 space-y-6"
          aria-busy={submitting}
        >
          <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-x-4">
              <h2 className="text-lg font-semibold text-gray-900">{t("stayDetails")}</h2>
              <Link
                href={propertyHref}
                className={`inline-flex min-h-[44px] items-center text-sm text-primary-600 hover:underline ${focusRing}`}
              >
                {t("changeDates")}
              </Link>
            </div>
            <dl className="mt-2 space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-gray-600">{t("stay")}</dt>
                <dd className="text-right font-medium text-gray-900">
                  {property ? property.title : loadingValue}
                </dd>
              </div>
              {/* Yüklenirken konum ve oda satırları yer tutucuyla durur; sayfa kaymaz (F1228). */}
              <div className="flex justify-between gap-4">
                <dt className="text-gray-600">{t("location")}</dt>
                <dd className="text-right font-medium text-gray-900">
                  {property
                    ? `${property.location.city}, ${property.location.country}`
                    : loadingValue}
                </dd>
              </div>
              {(room || !property) && (
                <div className="flex justify-between gap-4">
                  <dt className="text-gray-600">{t("room")}</dt>
                  <dd className="text-right font-medium text-gray-900">
                    {room ? `${room.name} (${bedLabel})` : loadingValue}
                  </dd>
                </div>
              )}
              {/* Giriş ve çıkış ayrı satırda, hafta günüyle; ok/tire okunmaz (F756, F757). */}
              <div className="flex justify-between gap-4">
                <dt className="text-gray-600">{t("checkInLabel")}</dt>
                <dd className="text-right font-medium text-gray-900">
                  {stayDay(f.locale, checkIn)}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-gray-600">{t("checkOutLabel")}</dt>
                <dd className="text-right font-medium text-gray-900">
                  {stayDay(f.locale, checkOut)}
                </dd>
              </div>
              {nights !== null && (
                <div className="flex justify-between gap-4">
                  <dt className="text-gray-600">{t("duration")}</dt>
                  <dd className="text-right font-medium text-gray-900">
                    {t("nights", { count: nights })}
                  </dd>
                </div>
              )}
              <div className="flex justify-between gap-4">
                <dt className="text-gray-600">{t("guests")}</dt>
                <dd className="text-right font-medium text-gray-900">{guestCount}</dd>
              </div>
              {plan && (
                <div className="flex justify-between gap-4">
                  <dt className="text-gray-600">{t("ratePlan")}</dt>
                  <dd className="text-right font-medium text-gray-900">
                    {plan.name}
                    <span className="block font-normal text-gray-600">
                      {plan.refundable ? t("refundable") : t("nonRefundable")}
                      {plan.mealPlan === "BREAKFAST" ? ` · ${t("breakfastIncluded")}` : ""}
                    </span>
                  </dd>
                </div>
              )}
            </dl>
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900">{t("priceSummary")}</h2>
            <p role="status" className="sr-only">
              {priceStatus}
            </p>
            <div className="mt-4">
              {quoteLoading && (
                <p id="checkout-quote-loading" className="text-sm text-gray-500">
                  {priceTrail.last
                    ? t("recalculatingFrom", {
                        total: f.money(priceTrail.last.total, priceTrail.last.currency),
                      })
                    : t("calculating")}
                </p>
              )}
              {totalChange && (
                <p
                  className="mb-3 text-sm font-medium text-gray-900"
                  data-testid="checkout-total-changed"
                >
                  {totalChange}
                </p>
              )}
              {quoteError && (
                <div className="space-y-2">
                  <p id="checkout-quote-error" role="alert" className="text-sm text-red-600">
                    {soldOut ? t("soldOut") : quoteError}
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    {!soldOut && (
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => setRefreshKey((k) => k + 1)}
                      >
                        {t("recalculate")}
                      </Button>
                    )}
                    <Link
                      href={propertyHref}
                      className={`inline-flex min-h-[44px] items-center text-sm text-primary-600 hover:underline ${focusRing}`}
                    >
                      {t("changeDates")}
                    </Link>
                  </div>
                </div>
              )}
              {quote && <QuoteBreakdown quote={quote} onExpire={refreshExpiredQuote} />}
              <CouponField
                applied={couponCode}
                status={quote?.coupon?.status ?? null}
                onApply={setCouponCode}
                loading={quoteLoading}
              />
            </div>
            <p className="mt-3 text-xs text-gray-500">{t("totalNotice")}</p>
          </section>

          {error && (
            <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
              {/* Canlı bölgede yalnız metin; düğmeler (kendi Status bölgesiyle) dışında (F1). */}
              <div role="alert">
                <p>{error.message}</p>
                {error.code === "EMAIL_NOT_VERIFIED" && (
                  <p className="mt-1">{t("emailNotVerifiedHint")}</p>
                )}
                {error.code === "IDENTITY_VERIFICATION_REQUIRED" && (
                  <p className="mt-1">
                    {t("identityRequiredHint")}{" "}
                    <Link href="/support" className={`underline ${focusRing}`}>
                      {t("contactSupport")}
                    </Link>
                  </p>
                )}
                {error.retryable && <p className="mt-1">{t("retrySafeHint")}</p>}
              </div>
              {/* Seçim korunur; doğrulama e-postası sayfadan çıkmadan yeniden istenir. */}
              {error.code === "EMAIL_NOT_VERIFIED" && <ResendVerificationButton className="mt-3" />}
              {error.retryable && (
                <Button type="button" variant="secondary" className="mt-3" onClick={retrySubmit}>
                  {t("retry")}
                </Button>
              )}
            </div>
          )}

          <div className="space-y-2">
            {signedOut && (
              <div className="text-sm text-gray-700">
                <p>{t("loginRequired")}</p>
                <p className="mt-1 flex flex-wrap gap-x-4">
                  <Link
                    href={authHref()}
                    className={`inline-flex min-h-[44px] items-center font-medium text-primary-600 hover:underline ${focusRing}`}
                  >
                    {t("loginLink")}
                  </Link>
                  <Link
                    href={authHref("/register")}
                    className={`inline-flex min-h-[44px] items-center font-medium text-primary-600 hover:underline ${focusRing}`}
                  >
                    {t("registerLink")}
                  </Link>
                </p>
              </div>
            )}
            <p id="checkout-next-step" className="text-sm text-gray-700">
              {t("nextStepNotice")}
            </p>
            {submitReasonIds === "checkout-submit-reason" && (
              <p id="checkout-submit-reason" className="text-sm text-gray-600">
                {t("submitDisabledReason")}
              </p>
            )}
          </div>

          {/* Ortak düğme; `busy`: odak düğmede kalır, ikinci gönderim yok sayılır (F425). */}
          <Button
            ref={submitRef}
            type="submit"
            size="lg"
            fullWidth
            busy={submitting}
            disabled={submitDisabled}
            aria-describedby={`checkout-next-step ${submitReasonIds}`.trim()}
            className="disabled:bg-gray-300 disabled:text-gray-700 disabled:opacity-100"
          >
            {submitting ? t("processing") : t("submit")}
          </Button>
        </form>
      </main>
    </CheckoutFrame>
  );
}

export default function CheckoutPage() {
  const t = useTranslations("checkout");
  return (
    <Suspense
      fallback={
        <main
          id="main"
          className="mx-auto flex min-h-[60vh] max-w-3xl items-center justify-center px-4"
        >
          <p role="status" className="text-gray-500">
            {t("loading")}
          </p>
        </main>
      }
    >
      <CheckoutContent />
    </Suspense>
  );
}
