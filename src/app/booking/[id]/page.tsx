"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { ApiError, apiFetch } from "@/lib/api-client";
import BookingActions from "@/components/booking/BookingActions";
import RnplPlanCard, { type RnplPlan } from "@/components/booking/RnplPlan";
import BookingMessages from "@/components/booking/BookingMessages";
import BookingResolutionPanel from "@/components/resolution/BookingResolutionPanel";
import { useFormat } from "@/i18n/use-format";

interface BookingDetail {
  id: string;
  checkIn: string;
  checkOut: string;
  guestCount: number;
  totalPriceMinor: number;
  currency: string;
  status: string;
  holdExpiresAt?: string | null;
  property: {
    id: string;
    title: string;
    location: { city: string; country: string };
  };
  room: { name: string };
}

/** Başlığı çevrilen rezervasyon durumları; bilinmeyen durum ham hâliyle gösterilir. */
const STATUS_KEYS = ["HELD", "PENDING", "CONFIRMED", "COMPLETED", "CANCELLED", "EXPIRED"] as const;
type StatusKey = (typeof STATUS_KEYS)[number];

function isStatusKey(status: string): status is StatusKey {
  return (STATUS_KEYS as readonly string[]).includes(status);
}

export default function BookingConfirmationPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("booking");
  const f = useFormat();
  const [booking, setBooking] = useState<BookingDetail | null>(null);
  const [plan, setPlan] = useState<RnplPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const data = await apiFetch<{ booking: BookingDetail; paymentPlan?: RnplPlan | null }>(
        `/api/bookings/${id}`
      );
      setBooking(data.booking);
      setPlan(data.paymentPlan ?? null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setNeedsLogin(true);
      setError(err instanceof Error ? err.message : t("detail.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  if (needsLogin) {
    return (
      <div className="flex min-h-screen flex-col bg-gray-50">
        <Header />
        <main id="main" className="mx-auto flex max-w-3xl flex-1 items-center justify-center px-4">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-gray-900">{t("detail.loginRequiredTitle")}</h1>
            <p className="mt-2 text-gray-600">{t("detail.loginRequiredText")}</p>
            <Link
              href="/login"
              className="mt-4 inline-block rounded-lg bg-[#003580] px-6 py-3 text-sm font-semibold text-white"
            >
              {t("detail.login")}
            </Link>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  const formatDate = (d: string) => f.date(d, "long");

  const print = () => window.print();

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <Header />
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        {loading ? (
          <p className="text-center text-gray-500">{t("detail.loading")}</p>
        ) : error ? (
          <div className="rounded-2xl bg-white p-8 text-center shadow-sm">
            <h1 className="text-xl font-bold text-red-600">{t("detail.error")}</h1>
            <p className="mt-2 text-gray-600">{error}</p>
            <Link
              href="/"
              className="mt-4 inline-block text-sm font-semibold text-[#003580] hover:underline"
            >
              {t("detail.backHome")}
            </Link>
          </div>
        ) : booking ? (
          <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
            <div className="bg-green-700 px-8 py-6 text-white">
              <h1 className="text-2xl font-bold">
                {isStatusKey(booking.status) ? t(`status.${booking.status}`) : booking.status}
              </h1>
              <p className="mt-1 text-sm text-green-50">
                {t.rich("detail.bookingNumber", {
                  id: booking.id,
                  b: (chunks) => <span className="font-semibold">{chunks}</span>,
                })}
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
                  <dt className="text-gray-500">{t("detail.checkIn")}</dt>
                  <dd className="mt-1 font-medium text-gray-900">{formatDate(booking.checkIn)}</dd>
                </div>
                <div className="rounded-lg bg-gray-50 p-4">
                  <dt className="text-gray-500">{t("detail.checkOut")}</dt>
                  <dd className="mt-1 font-medium text-gray-900">{formatDate(booking.checkOut)}</dd>
                </div>
                <div className="rounded-lg bg-gray-50 p-4">
                  <dt className="text-gray-500">{t("detail.roomGuests")}</dt>
                  <dd className="mt-1 font-medium text-gray-900">
                    {t("detail.roomGuestsValue", {
                      room: booking.room.name,
                      count: booking.guestCount,
                    })}
                  </dd>
                </div>
              </dl>

              <div className="flex items-center justify-between border-t border-gray-100 pt-4">
                <span className="text-sm text-gray-600">{t("detail.total")}</span>
                <span className="text-xl font-bold text-gray-900">
                  {f.money(booking.totalPriceMinor, booking.currency)}
                </span>
              </div>

              <RnplPlanCard plan={plan} />

              <BookingActions
                bookingId={booking.id}
                status={booking.status}
                holdExpiresAt={booking.holdExpiresAt}
                amountMinor={booking.totalPriceMinor}
                currency={booking.currency}
                onChanged={() => void load()}
              />

              {["CONFIRMED", "COMPLETED"].includes(booking.status) && (
                <BookingMessages bookingId={booking.id} />
              )}

              {["CONFIRMED", "COMPLETED"].includes(booking.status) && (
                <BookingResolutionPanel bookingId={booking.id} />
              )}

              <div className="flex flex-wrap gap-3 border-t border-gray-100 pt-6">
                <Link
                  href={`/property/${booking.property.id}`}
                  className="rounded-lg bg-[#003580] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#002b66]"
                >
                  {t("detail.viewProperty")}
                </Link>
                <Link
                  href="/account"
                  className="rounded-lg border border-gray-300 px-6 py-3 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
                >
                  {t("detail.myBookings")}
                </Link>
                <button
                  onClick={print}
                  className="rounded-lg border border-gray-300 px-6 py-3 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
                >
                  {t("detail.print")}
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
