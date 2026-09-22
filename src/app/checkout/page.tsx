"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

interface CheckoutRoom {
  id: string;
  name: string;
  capacity: number;
  bedType: string;
  priceModifier: number;
}

interface CheckoutProperty {
  id: string;
  title: string;
  location: { city: string; country: string };
  basePrice: number;
  currency: string;
  rooms: CheckoutRoom[];
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
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      router.replace("/login");
      return;
    }

    if (!propertyId || !roomId || !checkIn || !checkOut) {
      setError("Rezervasyon bilgileri eksik.");
      setLoading(false);
      return;
    }

    fetch(`/api/properties/${propertyId}`, { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error("Property yüklenemedi.");
        return res.json();
      })
      .then((data: CheckoutProperty) => {
        setProperty(data);
        setLoading(false);
      })
      .catch(() => {
        setError("Property bilgileri alınamadı.");
        setLoading(false);
      });
  }, [propertyId, roomId, checkIn, checkOut, router]);

  const room = useMemo(() => {
    if (!property) return null;
    return property.rooms.find((r) => r.id === roomId) ?? null;
  }, [property, roomId]);

  const nights = useMemo(() => {
    if (!checkIn || !checkOut) return 0;
    const start = new Date(checkIn);
    const end = new Date(checkOut);
    const diff = end.getTime() - start.getTime();
    return Math.max(0, Math.round(diff / (1000 * 60 * 60 * 24)));
  }, [checkIn, checkOut]);

  const totalPrice = useMemo(() => {
    if (!property || !room || nights <= 0) return 0;
    return (property.basePrice + room.priceModifier) * nights;
  }, [property, room, nights]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!property || !room) return;

    const token = localStorage.getItem("token");
    if (!token) {
      router.replace("/login");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      // Aynı form gönderiminin ikilenmesini önlemek için Idempotency-Key
      const idempotencyKey = crypto.randomUUID();
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          propertyId: property.id,
          roomId: room.id,
          checkIn,
          checkOut,
          guestCount,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Rezervasyon oluşturulamadı.");
      }

      const bookingId = data?.booking?.id ?? data?.id;
      if (!bookingId) {
        throw new Error("Rezervasyon yanıtı geçersiz.");
      }

      router.push(`/booking/${bookingId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rezervasyon oluşturulamadı.");
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <main className="mx-auto flex min-h-[60vh] max-w-3xl items-center justify-center px-4">
        <p className="text-gray-500">Yükleniyor...</p>
      </main>
    );
  }

  if (error && !property) {
    return (
      <main className="mx-auto flex min-h-[60vh] max-w-3xl items-center justify-center px-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900">Hata</h1>
          <p className="mt-2 text-gray-600">{error}</p>
          <Link
            href="/"
            className="mt-4 inline-block text-primary-600 hover:underline"
          >
            Ana sayfaya dön
          </Link>
        </div>
      </main>
    );
  }

  if (!property || !room) {
    return (
      <main className="mx-auto flex min-h-[60vh] max-w-3xl items-center justify-center px-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900">
            Rezervasyon bilgileri eksik
          </h1>
          <p className="mt-2 text-gray-600">Lütfen tekrar arama yapın.</p>
          <Link
            href="/"
            className="mt-4 inline-block text-primary-600 hover:underline"
          >
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
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">
            Konaklama Bilgileri
          </h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-600">Property</dt>
              <dd className="font-medium text-gray-900">{property.title}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-600">Konum</dt>
              <dd className="font-medium text-gray-900">
                {property.location.city}, {property.location.country}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-600">Oda</dt>
              <dd className="font-medium text-gray-900">
                {room.name} ({room.bedType})
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-600">Giriş</dt>
              <dd className="font-medium text-gray-900">{checkIn}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-600">Çıkış</dt>
              <dd className="font-medium text-gray-900">{checkOut}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-600">Gece Sayısı</dt>
              <dd className="font-medium text-gray-900">{nights}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-600">Misafir Sayısı</dt>
              <dd className="font-medium text-gray-900">{guestCount}</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">Fiyat Özeti</h2>
          <div className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between text-gray-600">
              <span>
                {new Intl.NumberFormat("tr-TR", {
                  style: "currency",
                  currency: property.currency,
                }).format(property.basePrice + room.priceModifier)}{" "}
                x {nights} gece
              </span>
              <span>
                {new Intl.NumberFormat("tr-TR", {
                  style: "currency",
                  currency: property.currency,
                }).format(totalPrice)}
              </span>
            </div>
            <div className="flex justify-between border-t border-gray-200 pt-3 text-base font-semibold text-gray-900">
              <span>Toplam</span>
              <span>
                {new Intl.NumberFormat("tr-TR", {
                  style: "currency",
                  currency: property.currency,
                }).format(totalPrice)}
              </span>
            </div>
          </div>
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-lg bg-primary-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-primary-700 disabled:cursor-not-allowed disabled:bg-gray-300"
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
