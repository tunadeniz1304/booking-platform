"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { logout } from "@/lib/api-client";
import PasskeyManager from "@/components/account/PasskeyManager";
import { useFormat } from "@/i18n/use-format";

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl?: string | null;
  role: string;
}

interface Location {
  city: string;
  country: string;
}

interface Property {
  id: string;
  title: string;
  location: Location;
  basePrice: number;
  currency: string;
  ratingAvg: number;
  ratingCount: number;
}

interface Booking {
  id: string;
  propertyId: string;
  property: Property;
  room: { name: string };
  checkIn: string;
  checkOut: string;
  guestCount: number;
  totalPrice: number;
  currency: string;
  status: string;
}

interface Favorite {
  id: string;
  propertyId: string;
  property: Property;
}

export default function AccountPage() {
  const t = useTranslations("account");
  const fmt = useFormat();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [favoritingId, setFavoritingId] = useState<string | null>(null);

  const fetchFavorites = useCallback(async () => {
    const res = await fetch("/api/favorites");
    if (!res.ok) throw new Error(t("errors.favoritesLoad"));
    return res.json() as Promise<Favorite[]>;
  }, [t]);

  useEffect(() => {
    async function loadData() {
      try {
        const [userRes, bookingsRes] = await Promise.all([
          fetch("/api/user/me"),
          fetch("/api/bookings"),
        ]);

        if (!userRes.ok || !bookingsRes.ok) {
          throw new Error(t("errors.userLoad"));
        }

        const [userData, bookingsData] = await Promise.all([
          userRes.json() as Promise<User>,
          bookingsRes.json() as Promise<Booking[]>,
        ]);

        const favoritesData = await fetchFavorites();

        setUser(userData);
        setBookings(bookingsData);
        setFavorites(favoritesData);
      } catch (err) {
        setError(err instanceof Error ? err.message : t("errors.generic"));
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [fetchFavorites, t]);

  const toggleFavorite = async (propertyId: string) => {
    setFavoritingId(propertyId);
    try {
      const isFavorite = favorites.some((f) => f.propertyId === propertyId);

      if (isFavorite) {
        const res = await fetch(`/api/favorites?propertyId=${propertyId}`, {
          method: "DELETE",
        });
        if (!res.ok) throw new Error(t("errors.favoriteRemove"));
        setFavorites((prev) => prev.filter((f) => f.propertyId !== propertyId));
      } else {
        const res = await fetch("/api/favorites", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ propertyId }),
        });
        if (!res.ok) throw new Error(t("errors.favoriteAdd"));
        const newFavorite = (await res.json()) as Favorite;
        setFavorites((prev) => [newFavorite, ...prev]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.favoriteFailed"));
    } finally {
      setFavoritingId(null);
    }
  };

  const cancelBooking = async (bookingId: string) => {
    setCancellingId(bookingId);
    try {
      const res = await fetch(`/api/bookings/${bookingId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(t("errors.cancelBooking"));
      setBookings((prev) =>
        prev.map((b) => (b.id === bookingId ? { ...b, status: "CANCELLED" } : b))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.cancelFailed"));
    } finally {
      setCancellingId(null);
    }
  };

  const formatDate = (dateStr: string) => fmt.date(dateStr, "long");

  const formatPrice = (price: number, currency: string) => fmt.decimal(price, currency);

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      PENDING: t("status.pending"),
      CONFIRMED: t("status.confirmed"),
      CANCELLED: t("status.cancelled"),
      COMPLETED: t("status.completed"),
    };
    return labels[status] || status;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "CONFIRMED":
        return "bg-green-100 text-green-800";
      case "CANCELLED":
        return "bg-red-100 text-red-800";
      case "COMPLETED":
        return "bg-gray-100 text-gray-800";
      default:
        return "bg-yellow-100 text-yellow-800";
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="rounded-lg bg-red-50 p-6 text-center">
          <p className="text-red-600">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 rounded-md bg-primary-600 px-4 py-2 text-white hover:bg-primary-700"
          >
            {t("retry")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold text-gray-900">{t("title")}</h1>
          <button
            onClick={async () => {
              await logout();
              router.push("/");
            }}
            className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
          >
            {t("logout")}
          </button>
        </div>

        {/* Profil Kartı */}
        {user && (
          <div className="mt-6 rounded-2xl bg-white p-6 shadow-sm">
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary-600 text-2xl font-bold text-white">
                {user.firstName.charAt(0)}
                {user.lastName.charAt(0)}
              </div>
              <div>
                <h2 className="text-xl font-semibold text-gray-900">
                  {user.firstName} {user.lastName}
                </h2>
                <p className="text-sm text-gray-500">{user.email}</p>
                <span className="mt-1 inline-block rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                  {user.role === "HOST"
                    ? t("role.host")
                    : user.role === "ADMIN"
                      ? t("role.admin")
                      : t("role.user")}
                </span>
              </div>
            </div>
          </div>
        )}

        <PasskeyManager />

        <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-2">
          {/* Rezervasyonlar */}
          <section>
            <h2 className="text-2xl font-semibold text-gray-900">{t("bookings.title")}</h2>
            <div className="mt-4 space-y-4">
              {bookings.length === 0 ? (
                <div className="rounded-2xl bg-white p-8 text-center shadow-sm">
                  <p className="text-gray-500">{t("bookings.empty")}</p>
                </div>
              ) : (
                bookings.map((booking) => (
                  <div key={booking.id} className="rounded-2xl bg-white p-6 shadow-sm">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900">
                          {booking.property.title}
                        </h3>
                        <p className="text-sm text-gray-500">
                          {booking.property.location.city}, {booking.property.location.country}
                        </p>
                        <p className="mt-1 text-sm text-gray-600">
                          {t("bookings.room", { name: booking.room.name })}
                        </p>
                      </div>
                      <span
                        className={`inline-flex shrink-0 items-center rounded-full px-3 py-1 text-xs font-medium ${getStatusColor(
                          booking.status
                        )}`}
                      >
                        {getStatusLabel(booking.status)}
                      </span>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
                      <div>
                        <p className="text-gray-500">{t("bookings.checkIn")}</p>
                        <p className="font-medium text-gray-900">{formatDate(booking.checkIn)}</p>
                      </div>
                      <div>
                        <p className="text-gray-500">{t("bookings.checkOut")}</p>
                        <p className="font-medium text-gray-900">{formatDate(booking.checkOut)}</p>
                      </div>
                      <div>
                        <p className="text-gray-500">{t("bookings.guests")}</p>
                        <p className="font-medium text-gray-900">{booking.guestCount}</p>
                      </div>
                      <div>
                        <p className="text-gray-500">{t("bookings.total")}</p>
                        <p className="font-medium text-gray-900">
                          {formatPrice(booking.totalPrice, booking.currency)}
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-3">
                      {(booking.status === "PENDING" || booking.status === "CONFIRMED") && (
                        <button
                          onClick={() => cancelBooking(booking.id)}
                          disabled={cancellingId === booking.id}
                          className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {cancellingId === booking.id
                            ? t("bookings.cancelling")
                            : t("bookings.cancel")}
                        </button>
                      )}
                      <button
                        onClick={() => toggleFavorite(booking.propertyId)}
                        disabled={favoritingId === booking.propertyId}
                        className={`rounded-md border px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                          favorites.some((f) => f.propertyId === booking.propertyId)
                            ? "border-primary-600 bg-primary-50 text-primary-700 hover:bg-primary-100"
                            : "border-gray-300 text-gray-700 hover:bg-gray-50"
                        }`}
                      >
                        {favoritingId === booking.propertyId
                          ? t("bookings.processing")
                          : favorites.some((f) => f.propertyId === booking.propertyId)
                            ? t("bookings.removeFavorite")
                            : t("bookings.addFavorite")}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          {/* Favoriler */}
          <section>
            <h2 className="text-2xl font-semibold text-gray-900">{t("favorites.title")}</h2>
            <div className="mt-4 space-y-4">
              {favorites.length === 0 ? (
                <div className="rounded-2xl bg-white p-8 text-center shadow-sm">
                  <p className="text-gray-500">{t("favorites.empty")}</p>
                </div>
              ) : (
                favorites.map((favorite) => (
                  <div key={favorite.id} className="rounded-2xl bg-white p-6 shadow-sm">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900">
                          {favorite.property.title}
                        </h3>
                        <p className="text-sm text-gray-500">
                          {favorite.property.location.city}, {favorite.property.location.country}
                        </p>
                        <div className="mt-2 flex items-center gap-2">
                          <span className="inline-flex items-center rounded bg-primary-600 px-2 py-0.5 text-xs font-semibold text-white">
                            {favorite.property.ratingAvg.toFixed(1)}
                          </span>
                          <span className="text-xs text-gray-500">
                            {t("favorites.reviews", { count: favorite.property.ratingCount })}
                          </span>
                        </div>
                        <p className="mt-2 text-lg font-semibold text-gray-900">
                          {formatPrice(favorite.property.basePrice, favorite.property.currency)}
                          <span className="text-sm font-normal text-gray-500">
                            {" "}
                            {t("favorites.perNight")}
                          </span>
                        </p>
                      </div>
                      <button
                        onClick={() => toggleFavorite(favorite.propertyId)}
                        disabled={favoritingId === favorite.propertyId}
                        className="shrink-0 rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {favoritingId === favorite.propertyId
                          ? t("favorites.removing")
                          : t("favorites.remove")}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </div>
      <Footer />
    </div>
  );
}
