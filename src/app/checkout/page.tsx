"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import QuoteBreakdown from "@/components/booking/QuoteBreakdown";
import { useQuote } from "@/components/booking/useQuote";

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
  const router = useRouter();
  const searchParams = useSearchParams();

  const propertyId = searchParams.get("propertyId") ?? "";
  const roomId = searchParams.get("roomId") ?? "";
  const checkIn = searchParams.get("checkIn") ?? "";
  const checkOut = searchParams.get("checkOut") ?? "";
  const guestCount = Number(searchParams.get("guestCount") ?? "1");

  const [property, setProperty] = useState<CheckoutProperty | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const idempotencyKey = useStableIdempotencyKey(
    `${propertyId}:${roomId}:${checkIn}:${checkOut}:${guestCount}`
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
    refreshKey,
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
        if (active) setLoadError("Konaklama bilgileri alınamadı.");
      });
    return () => {
      active = false;
    };
  }, [propertyId]);

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
        if (data.code === "PRICE_CHANGED" || data.code === "QUOTE_EXPIRED") {
          setRefreshKey((k) => k + 1);
          throw new Error(
            data.code === "PRICE_CHANGED"
              ? "Fiyat değişti. Güncel fiyatı kontrol edip tekrar onaylayın."
              : "Fiyat teklifinin süresi doldu; güncel fiyat yüklendi."
          );
        }
        throw new Error(data.error ?? "Rezervasyon oluşturulamadı.");
      }
      const bookingId = data?.booking?.id;
      if (!bookingId) throw new Error("Rezervasyon yanıtı geçersiz.");
      router.push(`/booking/${bookingId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rezervasyon oluşturulamadı.");
      setSubmitting(false);
    }
  };

  if (!propertyId || !roomId || !checkIn || !checkOut || loadError) {
    return (
      <main className="mx-auto flex min-h-[60vh] max-w-3xl items-center justify-center px-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900">Rezervasyon bilgileri eksik</h1>
          <p className="mt-2 text-gray-600">{loadError ?? "Lütfen tekrar arama yapın."}</p>
          <Link href="/" className="mt-4 inline-block text-primary-600 hover:underline">
            Ana sayfaya dön
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900">Rezervasyonu Tamamla</h1>

      <form onSubmit={handleSubmit} className="mt-6 space-y-6">
        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">Konaklama Bilgileri</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-600">Konaklama</dt>
              <dd className="font-medium text-gray-900">{property?.title ?? "…"}</dd>
            </div>
            {property && (
              <div className="flex justify-between">
                <dt className="text-gray-600">Konum</dt>
                <dd className="font-medium text-gray-900">
                  {property.location.city}, {property.location.country}
                </dd>
              </div>
            )}
            {room && (
              <div className="flex justify-between">
                <dt className="text-gray-600">Oda</dt>
                <dd className="font-medium text-gray-900">
                  {room.name} ({room.bedType})
                </dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-gray-600">Giriş – Çıkış</dt>
              <dd className="font-medium text-gray-900">
                {checkIn} → {checkOut}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-600">Misafir</dt>
              <dd className="font-medium text-gray-900">{guestCount}</dd>
            </div>
          </dl>
        </section>

        <section
          className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"
          aria-live="polite"
        >
          <h2 className="text-lg font-semibold text-gray-900">Fiyat Özeti</h2>
          <div className="mt-4">
            {quoteLoading && <p className="text-sm text-gray-500">Fiyat hesaplanıyor…</p>}
            {quoteError && <p className="text-sm text-red-600">{quoteError}</p>}
            {quote && <QuoteBreakdown quote={quote} />}
          </div>
          <p className="mt-3 text-xs text-gray-500">
            Gösterilen toplam tahsil edilecek tutarın aynısıdır (konaklama vergisi dahil).
          </p>
        </section>

        {error && (
          <div role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || !quote || !idempotencyKey}
          className="w-full rounded-lg bg-[#003580] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#002b66] disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {submitting ? "İşleniyor..." : "Rezervasyonu Tamamla"}
        </button>
      </form>
    </main>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto flex min-h-[60vh] max-w-3xl items-center justify-center px-4">
          <p className="text-gray-500">Yükleniyor...</p>
        </main>
      }
    >
      <CheckoutContent />
    </Suspense>
  );
}
