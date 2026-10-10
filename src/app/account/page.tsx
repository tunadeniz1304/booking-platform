"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { ApiError, apiFetch, logout } from "@/lib/api-client";
import { Button, PageShell, Status, focusRing, loginHref, useErrorText } from "@/components/ui/ui";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import PasskeyManager from "@/components/account/PasskeyManager";
import IdentityVerification from "@/components/account/IdentityVerification";
import AgentMandates from "@/components/account/AgentMandates";
import WalletPanel from "@/components/account/WalletPanel";
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
  basePriceMinor: number;
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
  totalPriceMinor: number;
  currency: string;
  status: string;
}

interface Favorite {
  id: string;
  propertyId: string;
  property: Property;
}

/** Kart içi eylem sonucu (iptal/favori): sayfayı hata ekranına çevirmeden ilgili kartta gösterilir. */
interface ActionNotice {
  key: string;
  kind: "error" | "info";
  text: string;
}

const secondaryLinkClass = `inline-flex min-h-[44px] items-center rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 sm:min-h-0 ${focusRing}`;
const primaryLinkClass = `inline-flex min-h-[44px] items-center rounded-md bg-[#003580] px-4 py-2 text-sm font-semibold text-white hover:bg-[#002b66] sm:min-h-0 ${focusRing}`;

export default function AccountPage() {
  const t = useTranslations("account");
  const tCommon = useTranslations("common");
  const tPwa = useTranslations("pwa.trips");
  const tRes = useTranslations("resolution");
  const fmt = useFormat();
  const router = useRouter();
  const errorText = useErrorText();
  const { confirm, confirmDialog } = useConfirm();
  const [user, setUser] = useState<User | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [notice, setNotice] = useState<ActionNotice | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [favoritingId, setFavoritingId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function loadData() {
      try {
        // apiFetch: süresi dolan erişim belirtecinde bir kez yenileyip yeniden dener.
        const [userData, bookingsData, favoritesData] = await Promise.all([
          apiFetch<User>("/api/user/me"),
          apiFetch<Booking[]>("/api/bookings"),
          apiFetch<Favorite[]>("/api/favorites"),
        ]);
        if (!active) return;
        setUser(userData);
        setBookings(bookingsData);
        setFavorites(favoritesData);
        setError(null);
        setSessionExpired(false);
      } catch (err) {
        if (!active) return;
        if (err instanceof ApiError && err.status === 401) {
          setSessionExpired(true);
        } else {
          setError(err instanceof ApiError ? errorText(err) : t("errors.userLoad"));
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    loadData();
    return () => {
      active = false;
    };
  }, [errorText, t, reloadKey]);

  const retry = () => {
    setLoading(true);
    setError(null);
    setReloadKey((k) => k + 1);
  };

  const toggleFavorite = async (propertyId: string, noticeKey: string) => {
    setFavoritingId(propertyId);
    setNotice(null);
    const isFavorite = favorites.some((f) => f.propertyId === propertyId);
    try {
      if (isFavorite) {
        await apiFetch(`/api/favorites?propertyId=${encodeURIComponent(propertyId)}`, {
          method: "DELETE",
        });
        setFavorites((prev) => prev.filter((f) => f.propertyId !== propertyId));
      } else {
        const newFavorite = await apiFetch<Favorite>("/api/favorites", {
          method: "POST",
          body: JSON.stringify({ propertyId }),
        });
        setFavorites((prev) => [newFavorite, ...prev]);
      }
    } catch (err) {
      setNotice({
        key: noticeKey,
        kind: "error",
        text:
          err instanceof ApiError
            ? errorText(err)
            : isFavorite
              ? t("errors.favoriteRemove")
              : t("errors.favoriteAdd"),
      });
    } finally {
      setFavoritingId(null);
    }
  };

  const cancelBooking = async (booking: Booking) => {
    const ok = await confirm({
      title: t("bookings.cancelConfirm.title"),
      body: (
        <>
          <p className="font-medium text-gray-900">{booking.property.title}</p>
          <p>
            {t("bookings.cancelConfirm.summary", {
              checkIn: formatDate(booking.checkIn),
              checkOut: formatDate(booking.checkOut),
              total: formatPrice(booking.totalPriceMinor, booking.currency),
            })}
          </p>
          <p className="mt-2">
            {t.rich("bookings.cancelConfirm.refundNote", {
              link: (chunks) => (
                <Link
                  href={`/booking/${booking.id}`}
                  className={`font-medium text-blue-700 underline ${focusRing}`}
                >
                  {chunks}
                </Link>
              ),
            })}
          </p>
        </>
      ),
      confirmLabel: t("bookings.cancelConfirm.confirm"),
      cancelLabel: t("bookings.cancelConfirm.keep"),
      tone: "danger",
    });
    if (!ok) return;

    setCancellingId(booking.id);
    setNotice(null);
    try {
      const res = await apiFetch<{
        refund?: { refundMinor: number; currency: string; refundPercent: number };
      }>(`/api/bookings/${booking.id}`, { method: "DELETE" });
      setBookings((prev) =>
        prev.map((b) => (b.id === booking.id ? { ...b, status: "CANCELLED" } : b))
      );
      const refund = res?.refund;
      setNotice({
        key: `booking-${booking.id}`,
        kind: "info",
        text:
          refund && refund.refundMinor > 0
            ? t("bookings.cancelDone.refunded", {
                amount: formatPrice(refund.refundMinor, refund.currency),
                percent: String(refund.refundPercent),
              })
            : refund
              ? t("bookings.cancelDone.noRefund")
              : t("bookings.cancelDone.plain"),
      });
    } catch (err) {
      setNotice({
        key: `booking-${booking.id}`,
        kind: "error",
        text: err instanceof ApiError ? errorText(err) : t("errors.cancelFailed"),
      });
    } finally {
      setCancellingId(null);
    }
  };

  const formatDate = (dateStr: string) => fmt.date(dateStr, "long");

  const formatPrice = (minor: number, currency: string) => fmt.money(minor, currency);

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      HELD: t("status.held"),
      PENDING: t("status.pending"),
      CONFIRMED: t("status.confirmed"),
      CANCELLED: t("status.cancelled"),
      COMPLETED: t("status.completed"),
      EXPIRED: t("status.expired"),
    };
    return labels[status] ?? t("status.unknown");
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

  // Kalıcı canlı bölge: içerik sonradan eklendiğinde ekran okuyucu duyurur.
  const renderNotice = (key: string) => {
    const current = notice?.key === key ? notice : null;
    return (
      <div aria-live="polite" className="text-sm">
        {current?.kind === "error" && (
          <p role="alert" className="mt-3 text-red-700">
            {current.text}
          </p>
        )}
        {current?.kind === "info" && <p className="mt-3 text-green-800">{current.text}</p>}
      </div>
    );
  };

  if (loading) {
    return (
      <PageShell title={t("title")}>
        <div className="flex items-center gap-3" role="status">
          <div
            aria-hidden="true"
            className="h-8 w-8 animate-spin rounded-full border-4 border-primary-600 border-t-transparent"
          />
          <p className="text-sm text-gray-700">{tCommon("loading")}</p>
        </div>
      </PageShell>
    );
  }

  if (sessionExpired) {
    return (
      <PageShell title={t("title")}>
        <p className="text-sm text-gray-800">
          {t.rich("errors.sessionExpired", {
            link: (chunks) => (
              <Link
                href={loginHref("/account")}
                className={`font-semibold text-[#003580] underline ${focusRing}`}
              >
                {chunks}
              </Link>
            ),
          })}
        </p>
      </PageShell>
    );
  }

  if (error) {
    return (
      <PageShell title={t("title")}>
        <Status error={error} />
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={retry} className="min-h-[44px] sm:min-h-0">
            {t("retry")}
          </Button>
          <Link href="/" className={secondaryLinkClass}>
            {t("backHome")}
          </Link>
        </div>
      </PageShell>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main id="main" className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold text-gray-900">{t("title")}</h1>
          <button
            type="button"
            onClick={async () => {
              await logout();
              router.push("/");
            }}
            className={`min-h-[44px] rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 sm:min-h-0 ${focusRing}`}
          >
            {t("logout")}
          </button>
        </div>

        {/* Profil Kartı */}
        {user && (
          <div className="mt-6 rounded-2xl bg-white p-6 shadow-sm">
            <div className="flex items-center gap-4">
              <div
                aria-hidden="true"
                className="flex h-16 w-16 items-center justify-center rounded-full bg-primary-600 text-2xl font-bold text-white"
              >
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

        <p className="mt-4 text-sm">
          <Link href="/account/sessions" className="font-medium text-blue-700 hover:underline">
            {t("sessions.manageLink")}
          </Link>
          {" · "}
          <Link href="/trips" className="font-medium text-blue-700 hover:underline">
            {tPwa("accountLink")}
          </Link>
          {" · "}
          <Link href="/resolution" className="font-medium text-blue-700 hover:underline">
            {tRes("link")}
          </Link>
        </p>

        {/* Sık kullanılan bölümler (rezervasyonlar, favoriler) gelişmiş panellerden önce gelir. */}
        <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-2">
          {/* Rezervasyonlar */}
          <section aria-labelledby="account-bookings-title">
            <h2 id="account-bookings-title" className="text-2xl font-semibold text-gray-900">
              {t("bookings.title")}
            </h2>
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
                          <Link
                            href={`/booking/${booking.id}`}
                            className={`hover:underline ${focusRing}`}
                          >
                            {booking.property.title}
                          </Link>
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
                          {formatPrice(booking.totalPriceMinor, booking.currency)}
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-3">
                      {booking.status === "HELD" && (
                        <Link href={`/booking/${booking.id}`} className={primaryLinkClass}>
                          {t("bookings.completePayment")}
                          <span className="sr-only">: {booking.property.title}</span>
                        </Link>
                      )}
                      <Link href={`/booking/${booking.id}`} className={secondaryLinkClass}>
                        {t("bookings.details")}
                        <span className="sr-only">: {booking.property.title}</span>
                      </Link>
                      {(booking.status === "PENDING" || booking.status === "CONFIRMED") && (
                        <button
                          type="button"
                          onClick={() => cancelBooking(booking)}
                          disabled={cancellingId === booking.id}
                          aria-busy={cancellingId === booking.id || undefined}
                          className={`min-h-[44px] rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-0 ${focusRing}`}
                        >
                          {cancellingId === booking.id
                            ? t("bookings.cancelling")
                            : t("bookings.cancel")}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => toggleFavorite(booking.propertyId, `booking-${booking.id}`)}
                        disabled={favoritingId === booking.propertyId}
                        aria-busy={favoritingId === booking.propertyId || undefined}
                        aria-pressed={favorites.some((f) => f.propertyId === booking.propertyId)}
                        className={`min-h-[44px] rounded-md border px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-0 ${focusRing} ${
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
                    {renderNotice(`booking-${booking.id}`)}
                  </div>
                ))
              )}
            </div>
          </section>

          {/* Favoriler */}
          <section aria-labelledby="account-favorites-title">
            <h2 id="account-favorites-title" className="text-2xl font-semibold text-gray-900">
              {t("favorites.title")}
            </h2>
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
                          <Link
                            href={`/property/${favorite.propertyId}`}
                            className={`hover:underline ${focusRing}`}
                          >
                            {favorite.property.title}
                          </Link>
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
                          {formatPrice(
                            favorite.property.basePriceMinor,
                            favorite.property.currency
                          )}
                          <span className="text-sm font-normal text-gray-500">
                            {" "}
                            {t("favorites.perNight")}
                          </span>
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          toggleFavorite(favorite.propertyId, `favorite-${favorite.id}`)
                        }
                        disabled={favoritingId === favorite.propertyId}
                        aria-busy={favoritingId === favorite.propertyId || undefined}
                        className={`min-h-[44px] shrink-0 rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-0 ${focusRing}`}
                      >
                        {favoritingId === favorite.propertyId
                          ? t("favorites.removing")
                          : t("favorites.remove")}
                        <span className="sr-only">: {favorite.property.title}</span>
                      </button>
                    </div>
                    {renderNotice(`favorite-${favorite.id}`)}
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

        <WalletPanel />

        <IdentityVerification role={user?.role} />

        <PasskeyManager />

        <AgentMandates />
      </main>
      <Footer />
      {confirmDialog}
    </div>
  );
}
