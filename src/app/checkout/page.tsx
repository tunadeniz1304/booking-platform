"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import QuoteBreakdown from "@/components/booking/QuoteBreakdown";
import { useQuote } from "@/components/booking/useQuote";
import CouponField from "@/components/booking/CouponField";

interface CheckoutProperty {
  id: string;
  title: string;
  location: { city: string; country: string };
  rooms: Array<{ id: string; name: string; bedType: string }>;
}

/**
 * Idempotency-Key checkout açılışında BİR KEZ üretilir ve sekme boyunca saklanır:
 * çift tıklama, ağ yeniden denemesi veya sayfa yenilemesi aynı rezervasyonu döndürür.
 */
function useStableIdempotencyKey(scope: string): string | null {
  const [key, setKey] = useState<string | null>(null);
  useEffect(() => {
    const storageKey = `checkout-idem:${scope}`;
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
  }, [scope]);
  return key;
}

function CheckoutContent() {
  const t = useTranslations("checkout");
  const router = useRouter();
  const searchParams = useSearchParams();

  const propertyId = searchParams.get("propertyId") ?? "";
  const roomId = searchParams.get("roomId") ?? "";
  const checkIn = searchParams.get("checkIn") ?? "";
  const checkOut = searchParams.get("checkOut") ?? "";
  const guestCount = Number(searchParams.get("guestCount") ?? "1");
  const ratePlanId = searchParams.get("ratePlanId") ?? undefined;

  const [property, setProperty] = useState<CheckoutProperty | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [couponCode, setCouponCode] = useState("");

  const idempotencyKey = useStableIdempotencyKey(
    `${propertyId}:${roomId}:${checkIn}:${checkOut}:${guestCount}:${couponCode.toUpperCase()}`
  );
  const {
    quote,
    loading: quoteLoading,
    error: quoteError,
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
        if (active) setProperty(data);
      })
      .catch(() => {
        if (active) setLoadError(t("loadFailed"));
      });
    return () => {
      active = false;
    };
  }, [propertyId, t]);

  const room = property?.rooms.find((r) => r.id === roomId) ?? null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quote || !idempotencyKey) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
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

      if (res.status === 401) {
        router.replace(
          `/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`
        );
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        if (data.code === "COUPON_EXHAUSTED" || data.code === "COUPON_NOT_APPLICABLE") {
          setRefreshKey((k) => k + 1);
          throw new Error(data.error ?? t("createFailed"));
        }
        if (data.code === "PRICE_CHANGED" || data.code === "QUOTE_EXPIRED") {
          setRefreshKey((k) => k + 1);
          throw new Error(data.code === "PRICE_CHANGED" ? t("priceChanged") : t("quoteExpired"));
        }
        throw new Error(data.error ?? t("createFailed"));
      }
      const bookingId = data?.booking?.id;
      if (!bookingId) throw new Error(t("invalidResponse"));
      router.push(`/booking/${bookingId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("createFailed"));
      setSubmitting(false);
    }
  };

  if (!propertyId || !roomId || !checkIn || !checkOut || loadError) {
    return (
      <main
        id="main"
        className="mx-auto flex min-h-[60vh] max-w-3xl items-center justify-center px-4"
      >
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900">{t("missingTitle")}</h1>
          <p className="mt-2 text-gray-600">{loadError ?? t("missingHint")}</p>
          <Link href="/" className="mt-4 inline-block text-primary-600 hover:underline">
            {t("backHome")}
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main id="main" className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900">{t("title")}</h1>

      <form onSubmit={handleSubmit} className="mt-6 space-y-6">
        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">{t("stayDetails")}</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-600">{t("stay")}</dt>
              <dd className="font-medium text-gray-900">{property?.title ?? "…"}</dd>
            </div>
            {property && (
              <div className="flex justify-between">
                <dt className="text-gray-600">{t("location")}</dt>
                <dd className="font-medium text-gray-900">
                  {property.location.city}, {property.location.country}
                </dd>
              </div>
            )}
            {room && (
              <div className="flex justify-between">
                <dt className="text-gray-600">{t("room")}</dt>
                <dd className="font-medium text-gray-900">
                  {room.name} ({room.bedType})
                </dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-gray-600">{t("dates")}</dt>
              <dd className="font-medium text-gray-900">
                {checkIn} → {checkOut}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-600">{t("guests")}</dt>
              <dd className="font-medium text-gray-900">{guestCount}</dd>
            </div>
          </dl>
        </section>

        <section
          className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"
          aria-live="polite"
        >
          <h2 className="text-lg font-semibold text-gray-900">{t("priceSummary")}</h2>
          <div className="mt-4">
            {quoteLoading && <p className="text-sm text-gray-500">{t("calculating")}</p>}
            {quoteError && <p className="text-sm text-red-600">{quoteError}</p>}
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
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || !quote || !idempotencyKey}
          className="w-full rounded-lg bg-[#003580] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#002b66] disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-700"
        >
          {submitting ? t("processing") : t("title")}
        </button>
      </form>
    </main>
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
