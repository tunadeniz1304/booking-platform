"use client";

import { Suspense, useCallback, useEffect, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import QuoteBreakdown from "@/components/booking/QuoteBreakdown";
import { useQuote } from "@/components/booking/useQuote";
import CouponField from "@/components/booking/CouponField";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { Button, focusRing, loginHref, useErrorText, useSession } from "@/components/ui/ui";
import { ApiError, apiFetch } from "@/lib/api-client";
import { useFormat } from "@/i18n/use-format";

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

/** Ödeme adımı yerine kullanıcı eylemi gerektiren hata kodları (çözüm yolu gösterilir). */
type SubmitError = { message: string; code?: string };

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
  const router = useRouter();
  const searchParams = useSearchParams();
  const f = useFormat();
  const errorText = useErrorText();
  const session = useSession();

  const propertyId = searchParams.get("propertyId") ?? "";
  const roomId = searchParams.get("roomId") ?? "";
  const checkIn = searchParams.get("checkIn") ?? "";
  const checkOut = searchParams.get("checkOut") ?? "";
  const guestCount = Number(searchParams.get("guestCount") ?? "1");
  const ratePlanId = searchParams.get("ratePlanId") ?? undefined;

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
    checkIn,
    checkOut,
    guests: guestCount,
    ratePlanId,
    refreshKey,
    couponCode: couponCode || undefined,
  });

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

  const propertyParams = new URLSearchParams();
  if (checkIn) propertyParams.set("checkIn", checkIn);
  if (checkOut) propertyParams.set("checkOut", checkOut);
  propertyParams.set("guests", String(guestCount));
  if (roomId) propertyParams.set("roomId", roomId);
  if (ratePlanId) propertyParams.set("ratePlanId", ratePlanId);
  const propertyHref = propertyId
    ? `/property/${encodeURIComponent(propertyId)}?${propertyParams.toString()}`
    : "/";

  /** Giriş dönüş adresi: uygulanan kupon da URL'de taşınır. */
  const returnTo = () => {
    const params = new URLSearchParams(searchParams.toString());
    if (couponCode) params.set("coupon", couponCode);
    else params.delete("coupon");
    return `/checkout?${params.toString()}`;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quote || !idempotencyKey || submitting) return;
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
      if (!bookingId) throw new Error(t("invalidResponse"));
      // Aynı sekmede sonraki deneme yeni rezervasyon açsın (F5).
      resetIdempotencyKey();
      router.push(`/booking/${bookingId}`);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          router.replace(loginHref(returnTo()));
          return;
        }
        if (err.code === "COUPON_EXHAUSTED" || err.code === "COUPON_NOT_APPLICABLE") {
          setRefreshKey((k) => k + 1);
        }
        if (err.code === "PRICE_CHANGED" || err.code === "QUOTE_EXPIRED") {
          setRefreshKey((k) => k + 1);
          setError({
            message: err.code === "PRICE_CHANGED" ? t("priceChanged") : t("quoteExpired"),
            code: err.code,
          });
        } else if (err.code === "EMAIL_NOT_VERIFIED" || err.status >= 500) {
          setError({ message: errorText(err), code: err.code });
        } else {
          setError({ message: err.message || t("createFailed"), code: err.code });
        }
      } else if (err instanceof TypeError) {
        setError({ message: errorText(err) });
      } else {
        setError({ message: err instanceof Error ? err.message : t("createFailed") });
      }
      setSubmitting(false);
    }
  };

  if (!propertyId || !roomId || !checkIn || !checkOut || loadError) {
    const missing = !propertyId || !roomId || !checkIn || !checkOut;
    return (
      <CheckoutFrame>
        <main
          id="main"
          className="mx-auto flex min-h-[60vh] w-full max-w-3xl flex-1 items-center justify-center px-4"
        >
          <div className="text-center">
            <h1 className="text-2xl font-bold text-gray-900">
              {missing ? t("missingTitle") : t("loadFailedTitle")}
            </h1>
            <p className="mt-2 text-gray-600">{missing ? t("missingHint") : t("loadFailedHint")}</p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
              {!missing && (
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
              <Link
                href="/"
                className={`inline-flex min-h-[44px] items-center text-primary-600 hover:underline ${focusRing}`}
              >
                {t("backHome")}
              </Link>
            </div>
          </div>
        </main>
      </CheckoutFrame>
    );
  }

  const submitDisabled = submitting || !quote || !idempotencyKey;
  const signedOut = session.status === "ready" && !session.user;

  return (
    <CheckoutFrame>
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <Link
          href={propertyHref}
          className={`inline-flex min-h-[44px] items-center text-sm text-primary-600 hover:underline ${focusRing}`}
        >
          {t("backToProperty")}
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">{t("title")}</h1>

        <form onSubmit={handleSubmit} className="mt-6 space-y-6" aria-busy={submitting}>
          <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900">{t("stayDetails")}</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-gray-600">{t("stay")}</dt>
                <dd className="text-right font-medium text-gray-900">{property?.title ?? "…"}</dd>
              </div>
              {property && (
                <div className="flex justify-between gap-4">
                  <dt className="text-gray-600">{t("location")}</dt>
                  <dd className="text-right font-medium text-gray-900">
                    {property.location.city}, {property.location.country}
                  </dd>
                </div>
              )}
              {room && (
                <div className="flex justify-between gap-4">
                  <dt className="text-gray-600">{t("room")}</dt>
                  <dd className="text-right font-medium text-gray-900">
                    {room.name} ({room.bedType})
                  </dd>
                </div>
              )}
              <div className="flex justify-between gap-4">
                <dt className="text-gray-600">{t("dates")}</dt>
                <dd className="text-right font-medium text-gray-900">
                  {f.date(checkIn, "long")} – {f.date(checkOut, "long")}
                  {nights !== null && (
                    <span className="block font-normal text-gray-600">
                      {t("nights", { count: nights })}
                    </span>
                  )}
                </dd>
              </div>
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

          <section
            className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"
            aria-live="polite"
          >
            <h2 className="text-lg font-semibold text-gray-900">{t("priceSummary")}</h2>
            <div className="mt-4">
              {quoteLoading && <p className="text-sm text-gray-500">{t("calculating")}</p>}
              {quoteError && (
                <div className="space-y-2">
                  <p className="text-sm text-red-600">
                    {quoteErrorCode === "SOLD_OUT" ? t("soldOut") : quoteError}
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    {quoteErrorCode !== "SOLD_OUT" && (
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
              {quote && <QuoteBreakdown quote={quote} />}
              <CouponField
                applied={couponCode}
                status={quote?.coupon?.status ?? null}
                onApply={setCouponCode}
              />
            </div>
            <p className="mt-3 text-xs text-gray-500">{t("totalNotice")}</p>
          </section>

          {error && (
            <div role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
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
            </div>
          )}

          <div className="space-y-2">
            {signedOut && (
              <p className="text-sm text-gray-700">
                {t("loginRequired")}{" "}
                <Link
                  href={loginHref(returnTo())}
                  className={`font-medium text-primary-600 hover:underline ${focusRing}`}
                >
                  {t("loginLink")}
                </Link>
              </p>
            )}
            <p id="checkout-next-step" className="text-sm text-gray-700">
              {t("nextStepNotice")}
            </p>
            {!quote && !quoteLoading && (
              <p id="checkout-submit-reason" className="text-sm text-gray-600">
                {t("submitDisabledReason")}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={submitDisabled}
            aria-describedby={
              !quote && !quoteLoading
                ? "checkout-next-step checkout-submit-reason"
                : "checkout-next-step"
            }
            className="w-full rounded-lg bg-[#003580] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#002b66] disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-700"
          >
            {submitting ? t("processing") : t("title")}
          </button>
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
          <p className="text-gray-500">{t("loading")}</p>
        </main>
      }
    >
      <CheckoutContent />
    </Suspense>
  );
}
