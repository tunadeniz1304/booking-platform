"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { ApiError, apiFetch } from "@/lib/api-client";

interface BookingDetail {
  id: string;
  checkIn: string;
  checkOut: string;
  guestCount: number;
  totalPrice: number;
  currency: string;
  status: string;
  property: {
    id: string;
    title: string;
    location: { city: string; country: string };
  };
  room: { name: string };
}

export default function BookingConfirmationPage() {
  const { id } = useParams<{ id: string }>();
  const [booking, setBooking] = useState<BookingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const data = await apiFetch<{ booking: BookingDetail }>(`/api/bookings/${id}`);
      setBooking(data.booking);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setNeedsLogin(true);
      setError(err instanceof Error ? err.message : "Rezervasyon yüklenemedi");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  if (needsLogin) {
    return (
      <div className="flex min-h-screen flex-col bg-gray-50">
        <Header />
        <main className="mx-auto flex max-w-3xl flex-1 items-center justify-center px-4">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-gray-900">Giriş gerekli</h1>
            <p className="mt-2 text-gray-600">Rezervasyonunuzu görüntülemek için giriş yapın.</p>
            <Link
              href="/login"
              className="mt-4 inline-block rounded-lg bg-[#003580] px-6 py-3 text-sm font-semibold text-white"
            >
              Giriş Yap
            </Link>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" });

  const print = () => window.print();

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <Header />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        {loading ? (
          <p className="text-center text-gray-500">Yükleniyor...</p>
        ) : error ? (
          <div className="rounded-2xl bg-white p-8 text-center shadow-sm">
            <h1 className="text-xl font-bold text-red-600">Hata</h1>
            <p className="mt-2 text-gray-600">{error}</p>
            <Link
              href="/"
              className="mt-4 inline-block text-sm font-semibold text-[#003580] hover:underline"
            >
              Ana sayfaya dön
            </Link>
          </div>
        ) : booking ? (
          <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
            <div className="bg-green-600 px-8 py-6 text-white">
              <h1 className="text-2xl font-bold">Rezervasyonunuz Onaylandı</h1>
              <p className="mt-1 text-sm text-green-100">
                Rezervasyon numarası: <span className="font-semibold">{booking.id}</span>
              </p>
            </div>

            <div className="space-y-6 px-8 py-6">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">{booking.property.title}</h2>
                <p className="text-sm text-gray-500">
                  {booking.property.location.city}, {booking.property.location.country}
                </p>
              </div>

              <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
                <div className="rounded-lg bg-gray-50 p-4">
                  <dt className="text-gray-500">Giriş</dt>
                  <dd className="mt-1 font-medium text-gray-900">{formatDate(booking.checkIn)}</dd>
                </div>
                <div className="rounded-lg bg-gray-50 p-4">
                  <dt className="text-gray-500">Çıkış</dt>
                  <dd className="mt-1 font-medium text-gray-900">{formatDate(booking.checkOut)}</dd>
                </div>
                <div className="rounded-lg bg-gray-50 p-4">
                  <dt className="text-gray-500">Oda / Misafir</dt>
                  <dd className="mt-1 font-medium text-gray-900">
                    {booking.room.name} · {booking.guestCount} kişi
                  </dd>
                </div>
              </dl>

              <div className="flex items-center justify-between border-t border-gray-100 pt-4">
                <span className="text-sm text-gray-600">Toplam Tutar</span>
                <span className="text-xl font-bold text-gray-900">
                  {new Intl.NumberFormat("tr-TR", {
                    style: "currency",
                    currency: booking.currency,
                  }).format(booking.totalPrice)}
                </span>
              </div>

              <div className="flex flex-wrap gap-3 border-t border-gray-100 pt-6">
                <Link
                  href={`/property/${booking.property.id}`}
                  className="rounded-lg bg-[#003580] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#002b66]"
                >
                  Konaklamayı Görüntüle
                </Link>
                <Link
                  href="/account"
                  className="rounded-lg border border-gray-300 px-6 py-3 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
                >
                  Rezervasyonlarım
                </Link>
                <button
                  onClick={print}
                  className="rounded-lg border border-gray-300 px-6 py-3 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
                >
                  Yazdır
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </main>
      <Footer />
    </div>
  );
}
