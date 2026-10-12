"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { ApiError, apiFetch, logout } from "@/lib/api-client";
import {
  Button,
  ErrorText,
  PageShell,
  Status,
  focusRing,
  loginHref,
  useErrorText,
  usePageHeadingFocus,
} from "@/components/ui/ui";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { ResendVerificationButton } from "@/components/auth/AuthCard";
import { setSessionUserCache } from "@/components/layout/useSessionUserCache";
import RatingBadge from "@/components/property/RatingBadge";
import { invalidateFavoriteIds } from "@/components/property/useFavoriteIds";
import PasskeyManager from "@/components/account/PasskeyManager";
import IdentityVerification from "@/components/account/IdentityVerification";
import AgentMandates from "@/components/account/AgentMandates";
import WalletPanel from "@/components/account/WalletPanel";
import BookingStatusBadge from "@/components/booking/BookingStatusBadge";
import { useFormat } from "@/i18n/use-format";

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl?: string | null;
  role: string;
  /** `/api/user/me`: e-posta doğrulandı mı. */
  emailVerified?: boolean;
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
  holdExpiresAt?: string | null;
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

/** Bağımsız yüklenen bölümler: biri düşerse diğerleri ve güvenlik panelleri çalışmaya devam eder. */
type SectionKey = "user" | "bookings" | "favorites";

const SECTION_ERROR_KEYS = {
  user: "errors.userLoad",
  bookings: "errors.bookingsLoad",
  favorites: "errors.favoritesLoad",
} as const;

/** Favorilerden kaldırılan ilan ve listedeki yeri ("Geri al" için). */
interface RemovedFavorite {
  favorite: Favorite;
  index: number;
}

const isUnauthorized = (err: unknown) => err instanceof ApiError && err.status === 401;

interface BookingsPage {
  items: Booking[];
  nextCursor: string | null;
}

const BOOKINGS_TIMEOUT_MS = 20_000;

/**
 * Rezervasyonların bir sayfası (sunucu varsayılanı 50). Sonraki sayfanın imleci `X-Next-Cursor`
 * başlığındadır ve apiFetch başlıkları döndürmez; başarısız yanıtta (401'de oturum yenileme,
 * yerelleştirilebilir hata) apiFetch'e devredilir.
 */
async function fetchBookingsPage(cursor?: string | null): Promise<BookingsPage> {
  const path = cursor ? `/api/bookings?cursor=${encodeURIComponent(cursor)}` : "/api/bookings";
  const read = async (): Promise<BookingsPage | null> => {
    const res = await fetch(path, {
      credentials: "same-origin",
      ...(typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
        ? { signal: AbortSignal.timeout(BOOKINGS_TIMEOUT_MS) }
        : {}),
    });
    if (!res.ok) return null;
    const items = (await res.json()) as Booking[];
    return { items, nextCursor: res.headers.get("X-Next-Cursor") };
  };
  const page = await read().catch(() => null);
  if (page) return page;
  const items = await apiFetch<Booking[]>(path);
  return (await read().catch(() => null)) ?? { items, nextCursor: null };
}

const skeletonBlock = "rounded-md bg-gray-100 motion-safe:animate-pulse";

const secondaryLinkClass = `inline-flex min-h-[44px] items-center rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 sm:min-h-0 ${focusRing}`;
const primaryLinkClass = `inline-flex min-h-[44px] items-center rounded-md bg-[#003580] px-4 py-2 text-sm font-semibold text-white hover:bg-[#002b66] sm:min-h-0 ${focusRing}`;
const sectionNavLinkClass = `inline-flex min-h-[44px] items-center whitespace-nowrap rounded-full border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 sm:min-h-0 ${focusRing}`;

export default function AccountPage() {
  const t = useTranslations("account");
  const tCommon = useTranslations("common");
  const tPwa = useTranslations("pwa.trips");
  const tRes = useTranslations("resolution");
  const tPrivacy = useTranslations("privacy");
  const tNav = useTranslations("nav");
  const tProperty = useTranslations("property");
  const tPayment = useTranslations("payment");
  const fmt = useFormat();
  const router = useRouter();
  const errorText = useErrorText();
  const headingRef = usePageHeadingFocus();
  const { confirm, confirmDialog } = useConfirm();
  const [user, setUser] = useState<User | null>(null);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [bookingsCursor, setBookingsCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [loading, setLoading] = useState(true);
  const [sectionErrors, setSectionErrors] = useState<Partial<Record<SectionKey, string>>>({});
  const [retryingSection, setRetryingSection] = useState<SectionKey | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [notice, setNotice] = useState<ActionNotice | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [favoritingId, setFavoritingId] = useState<string | null>(null);
  const [removedFavorite, setRemovedFavorite] = useState<RemovedFavorite | null>(null);
  const [favoritesFeedback, setFavoritesFeedback] = useState<ActionNotice | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  // Öğe listeden kalktığında odak <body>'ye düşmesin: bir sonraki çizimde bu kimliğe taşınır.
  const pendingFocusId = useRef<string | null>(null);

  useEffect(() => {
    const id = pendingFocusId.current;
    if (!id) return;
    const el = document.getElementById(id);
    if (el) {
      pendingFocusId.current = null;
      el.focus();
    }
  });

  useEffect(() => {
    let active = true;
    async function loadData() {
      // apiFetch: süresi dolan erişim belirtecinde bir kez yenileyip yeniden dener.
      const [userRes, bookingsRes, favoritesRes] = await Promise.allSettled([
        apiFetch<User>("/api/user/me"),
        fetchBookingsPage(),
        apiFetch<Favorite[]>("/api/favorites"),
      ]);
      if (!active) return;
      const results = [userRes, bookingsRes, favoritesRes];
      if (results.some((r) => r.status === "rejected" && isUnauthorized(r.reason))) {
        setSessionExpired(true);
        setLoading(false);
        return;
      }
      const errors: Partial<Record<SectionKey, string>> = {};
      if (userRes.status === "fulfilled") setUser(userRes.value);
      else errors.user = errorText(userRes.reason, t(SECTION_ERROR_KEYS.user));
      if (bookingsRes.status === "fulfilled") {
        setBookings(bookingsRes.value.items);
        setBookingsCursor(bookingsRes.value.nextCursor);
      } else errors.bookings = errorText(bookingsRes.reason, t(SECTION_ERROR_KEYS.bookings));
      if (favoritesRes.status === "fulfilled") setFavorites(favoritesRes.value);
      else errors.favorites = errorText(favoritesRes.reason, t(SECTION_ERROR_KEYS.favorites));
      setSectionErrors(errors);
      setSessionExpired(false);
      setLoading(false);
    }

    loadData();
    return () => {
      active = false;
    };
  }, [errorText, t]);

  /** Yalnız düşen bölümü yeniden yükler; sayfanın geri kalanı yerinde kalır. */
  const retrySection = async (key: SectionKey) => {
    setRetryingSection(key);
    try {
      if (key === "user") setUser(await apiFetch<User>("/api/user/me"));
      else if (key === "bookings") {
        const page = await fetchBookingsPage();
        setBookings(page.items);
        setBookingsCursor(page.nextCursor);
      } else setFavorites(await apiFetch<Favorite[]>("/api/favorites"));
      setSectionErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    } catch (err) {
      if (isUnauthorized(err)) {
        setSessionExpired(true);
      } else {
        setSectionErrors((prev) => ({
          ...prev,
          [key]: errorText(err, t(SECTION_ERROR_KEYS[key])),
        }));
      }
    } finally {
      setRetryingSection(null);
    }
  };

  /** Sonraki rezervasyon sayfasını listenin sonuna ekler; odak ilk yeni rezervasyona taşınır. */
  const loadMoreBookings = async () => {
    if (!bookingsCursor || loadingMore) return;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const page = await fetchBookingsPage(bookingsCursor);
      if (page.items[0]) pendingFocusId.current = `booking-link-${page.items[0].id}`;
      setBookings((prev) => {
        const seen = new Set(prev.map((b) => b.id));
        return [...prev, ...page.items.filter((b) => !seen.has(b.id))];
      });
      setBookingsCursor(page.nextCursor);
    } catch (err) {
      if (isUnauthorized(err)) setSessionExpired(true);
      else setLoadMoreError(errorText(err, t(SECTION_ERROR_KEYS.bookings)));
    } finally {
      setLoadingMore(false);
    }
  };

  const toggleFavorite = async (propertyId: string, noticeKey: string) => {
    if (favoritingId) return;
    setFavoritingId(propertyId);
    setNotice(null);
    setRemovedFavorite(null);
    setFavoritesFeedback(null);
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
        text: errorText(err, isFavorite ? t("errors.favoriteRemove") : t("errors.favoriteAdd")),
      });
    } finally {
      setFavoritingId(null);
    }
  };

  /** Favoriler listesinden kaldırır; "Geri al" sunar ve odağı sonraki karta taşır. */
  const removeFavorite = async (favorite: Favorite, index: number) => {
    if (favoritingId) return;
    setFavoritingId(favorite.propertyId);
    setNotice(null);
    setRemovedFavorite(null);
    setFavoritesFeedback(null);
    try {
      await apiFetch(`/api/favorites?propertyId=${encodeURIComponent(favorite.propertyId)}`, {
        method: "DELETE",
      });
      const neighbour = favorites[index + 1] ?? favorites[index - 1];
      pendingFocusId.current = neighbour ? `favorite-remove-${neighbour.id}` : "favorite-undo";
      setFavorites((prev) => prev.filter((f) => f.id !== favorite.id));
      setRemovedFavorite({ favorite, index });
      setFavoritesFeedback({
        key: "favorites",
        kind: "info",
        text: t("favorites.removed", { title: favorite.property.title }),
      });
    } catch (err) {
      setNotice({
        key: `favorite-${favorite.id}`,
        kind: "error",
        text: errorText(err, t("errors.favoriteRemove")),
      });
    } finally {
      setFavoritingId(null);
    }
  };

  const undoRemoveFavorite = async () => {
    if (!removedFavorite || undoing) return;
    const { favorite, index } = removedFavorite;
    setUndoing(true);
    try {
      const restored = await apiFetch<Favorite>("/api/favorites", {
        method: "POST",
        body: JSON.stringify({ propertyId: favorite.propertyId }),
      });
      const entry: Favorite = {
        ...favorite,
        ...restored,
        property: restored.property ?? favorite.property,
      };
      setFavorites((prev) => {
        const next = prev.filter((f) => f.propertyId !== entry.propertyId);
        next.splice(Math.min(index, next.length), 0, entry);
        return next;
      });
      pendingFocusId.current = `favorite-remove-${entry.id}`;
      setRemovedFavorite(null);
      setFavoritesFeedback({
        key: "favorites",
        kind: "info",
        text: t("favorites.restored", { title: favorite.property.title }),
      });
    } catch (err) {
      setFavoritesFeedback({
        key: "favorites",
        kind: "error",
        text: errorText(err, t("errors.favoriteAdd")),
      });
    } finally {
      setUndoing(false);
    }
  };

  // Header'daki çıkışla aynı sonuç: başlık önbelleği boşalır, sunucu bileşenleri yenilenir.
  // Başarıda düğme yönlendirmeye kadar "Çıkış yapılıyor…" kalır (çift tıklama yok).
  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await logout();
    } catch {
      setLoggingOut(false);
      return;
    }
    setSessionUserCache(null);
    invalidateFavoriteIds();
    router.push("/");
    router.refresh();
  };

  const cancelBooking = async (booking: Booking) => {
    if (cancellingId) return;
    const ok = await confirm({
      // F2-42: rezervasyon sayfasındaki iptal penceresiyle aynı başlık, düğmeler ve uyarı.
      title: tPayment("cancel.dialogTitle"),
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
          <p className="mt-2">{tPayment("cancel.irreversible")}</p>
        </>
      ),
      confirmLabel: tPayment("cancel.confirmButton"),
      cancelLabel: tPayment("cancel.keep"),
      tone: "danger",
    });
    if (!ok) return;

    setCancellingId(booking.id);
    setNotice(null);
    try {
      const res = await apiFetch<{
        refund?: { refundMinor: number; currency: string; refundPercent: number };
      }>(`/api/bookings/${booking.id}`, { method: "DELETE" });
      // İptal düğmesi kalkar: odak aynı kartın ayrıntı bağlantısına taşınır.
      pendingFocusId.current = `booking-details-${booking.id}`;
      setBookings((prev) =>
        prev.map((b) => (b.id === booking.id ? { ...b, status: "CANCELLED" } : b))
      );
      const refund = res?.refund;
      // Ödeme öncesi durumlarda (PENDING/HELD) tahsilat yoktur: "iade yok" yanıltıcı olur.
      const notCharged = booking.status === "PENDING" || booking.status === "HELD";
      setNotice({
        key: `booking-${booking.id}`,
        kind: "info",
        text:
          refund && refund.refundMinor > 0
            ? t("bookings.cancelDone.refunded", {
                amount: formatPrice(refund.refundMinor, refund.currency),
                percent: String(refund.refundPercent),
              })
            : notCharged
              ? tPayment("cancel.cancelledNoCharge")
              : refund
                ? t("bookings.cancelDone.noRefund")
                : t("bookings.cancelDone.plain"),
      });
    } catch (err) {
      pendingFocusId.current = null;
      setNotice({
        key: `booking-${booking.id}`,
        kind: "error",
        text: errorText(err, t("errors.cancelFailed")),
      });
    } finally {
      setCancellingId(null);
    }
  };

  const formatDate = (dateStr: string) => fmt.date(dateStr, "long");

  const formatPrice = (minor: number, currency: string) => fmt.money(minor, currency);

  // Kalıcı canlı bölge: içerik sonradan eklendiğinde ekran okuyucu duyurur.
  const renderNotice = (key: string) => {
    const current = notice?.key === key ? notice : null;
    return (
      <div aria-live="polite" className="text-sm">
        {current?.kind === "error" && <ErrorText className="mt-3">{current.text}</ErrorText>}
        {current?.kind === "info" && <p className="mt-3 text-green-800">{current.text}</p>}
      </div>
    );
  };

  // Bölüm hatası: yalnız ilgili bölümün yerine gösterilir, yeniden deneme o bölümü yükler.
  const renderSectionError = (key: SectionKey, className = "") => (
    <div className={`rounded-2xl bg-white p-6 shadow-sm ${className}`}>
      <Status error={sectionErrors[key]} />
      <Button
        variant="secondary"
        busy={retryingSection === key}
        onClick={() => retrySection(key)}
        className="mt-3 min-h-[44px] sm:min-h-0"
      >
        {t("retry")}
      </Button>
    </div>
  );

  // Yükleme iskeleti: sayfa ve alt paneller hemen çizilir, her bölüm kendi yerini tutar.
  const renderCardSkeletons = () => (
    <div aria-hidden="true" className="space-y-4">
      {[0, 1].map((i) => (
        <div key={i} className="space-y-3 rounded-2xl bg-white p-6 shadow-sm">
          <div className={`h-5 w-2/3 ${skeletonBlock}`} />
          <div className={`h-4 w-1/2 ${skeletonBlock}`} />
          <div className={`h-10 ${skeletonBlock}`} />
        </div>
      ))}
    </div>
  );

  const emptyState = (text: string) => (
    <div className="rounded-2xl bg-white p-8 text-center shadow-sm">
      <p className="text-gray-500">{text}</p>
      <Link href="/" className={`mt-4 ${primaryLinkClass}`}>
        {tCommon("notFound.search")}
      </Link>
    </div>
  );

  const userRole = user?.role;
  // Yönetici hesabında boş misafir bölümleri gösterilmez (yönetim işleri /admin'de).
  const hideEmptyGuestSections = userRole === "ADMIN" && !loading;
  const showBookings = !hideEmptyGuestSections || !!sectionErrors.bookings || bookings.length > 0;
  const showFavorites =
    !hideEmptyGuestSections ||
    !!sectionErrors.favorites ||
    favorites.length > 0 ||
    !!removedFavorite ||
    !!favoritesFeedback;

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

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main id="main" className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="text-3xl font-bold text-gray-900 focus:outline-none"
        >
          {t("title")}
        </h1>
        <p role="status" className="sr-only">
          {loading ? tCommon("loading") : ""}
        </p>

        {/* Bölüm menüsü: mobilde yatay kaydırılır; alt sayfalar (gizlilik dahil) burada. */}
        <nav aria-label={t("sections.navLabel")} className="mt-4">
          <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 py-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
            {showBookings && (
              <li>
                <a href="#account-bookings" className={sectionNavLinkClass}>
                  {t("bookings.title")}
                </a>
              </li>
            )}
            {showFavorites && (
              <li>
                <a href="#account-favorites" className={sectionNavLinkClass}>
                  {t("favorites.title")}
                </a>
              </li>
            )}
            <li>
              <a href="#account-wallet" className={sectionNavLinkClass}>
                {t("sections.wallet")}
              </a>
            </li>
            <li>
              <a href="#account-security" className={sectionNavLinkClass}>
                {t("sections.security")}
              </a>
            </li>
            <li>
              <Link href="/trips" className={sectionNavLinkClass}>
                {tNav("trips")}
              </Link>
            </li>
            <li>
              <Link href="/account/sessions" className={sectionNavLinkClass}>
                {t("sessions.title")}
              </Link>
            </li>
            <li>
              <Link href="/account/privacy" className={sectionNavLinkClass}>
                {tPrivacy("accountPage.title")}
              </Link>
            </li>
            {/* Rol bağlantıları: ev sahibi ve yönetici kendi paneline ve talep kuyruğuna gider. */}
            {userRole === "HOST" && (
              <li>
                <Link href="/host" className={sectionNavLinkClass}>
                  {tNav("host")}
                </Link>
              </li>
            )}
            {userRole === "ADMIN" && (
              <li>
                <Link href="/admin" className={sectionNavLinkClass}>
                  {tNav("admin")}
                </Link>
              </li>
            )}
            <li>
              {userRole === "ADMIN" ? (
                <Link href="/admin/claims" className={sectionNavLinkClass}>
                  {tRes("adminLink")}
                </Link>
              ) : (
                <Link href="/resolution" className={sectionNavLinkClass}>
                  {userRole === "HOST" ? tRes("hostLink") : tRes("link")}
                </Link>
              )}
            </li>
          </ul>
        </nav>

        {/* Profil Kartı */}
        {sectionErrors.user && renderSectionError("user", "mt-6")}
        {loading && (
          <div
            aria-hidden="true"
            className="mt-6 flex items-center gap-4 rounded-2xl bg-white p-6 shadow-sm"
          >
            <div className="h-16 w-16 shrink-0 rounded-full bg-gray-100 motion-safe:animate-pulse" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className={`h-5 w-48 max-w-full ${skeletonBlock}`} />
              <div className={`h-4 w-64 max-w-full ${skeletonBlock}`} />
            </div>
          </div>
        )}
        {user && (
          <div className="mt-6 rounded-2xl bg-white p-6 shadow-sm">
            <div className="flex items-center gap-4">
              {user.avatarUrl && !avatarFailed ? (
                // Harici avatar adresi: next/image alan adı yapılandırması gerektirmesin.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={user.avatarUrl}
                  alt=""
                  onError={() => setAvatarFailed(true)}
                  className="h-16 w-16 shrink-0 rounded-full object-cover"
                />
              ) : (
                <div
                  aria-hidden="true"
                  className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-primary-600 text-2xl font-bold text-white"
                >
                  {`${user.firstName.charAt(0)}${user.lastName.charAt(0)}`.toUpperCase()}
                </div>
              )}
              <div>
                <h2 className="text-xl font-semibold text-gray-900">
                  {user.firstName} {user.lastName}
                </h2>
                <p className="text-sm text-gray-500">{user.email}</p>
                <div className="mt-1 flex flex-wrap gap-2">
                  <span className="inline-block rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                    {user.role === "HOST"
                      ? t("role.host")
                      : user.role === "ADMIN"
                        ? t("role.admin")
                        : t("role.user")}
                  </span>
                  {user.emailVerified !== undefined && (
                    <span className="inline-block rounded-full border border-gray-300 px-2 py-0.5 text-xs font-medium text-gray-700">
                      {user.emailVerified
                        ? t("profile.emailVerified")
                        : t("profile.emailNotVerified")}
                    </span>
                  )}
                </div>
                {user.emailVerified === false && (
                  <ResendVerificationButton className="mt-3 sm:max-w-xs" />
                )}
              </div>
            </div>
          </div>
        )}

        {/* Sık kullanılan bölümler (rezervasyonlar, favoriler) gelişmiş panellerden önce gelir. */}
        {(showBookings || showFavorites) && (
          <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-2">
            {/* Rezervasyonlar */}
            {showBookings && (
              <section id="account-bookings" aria-labelledby="account-bookings-title">
                <h2 id="account-bookings-title" className="text-xl font-semibold text-gray-900">
                  {t("bookings.title")}
                </h2>
                <p className="mt-1 text-sm text-gray-600">
                  {tPwa.rich("accountQrHint", {
                    link: (chunks) => (
                      <Link href="/trips" className={`font-semibold underline ${focusRing}`}>
                        {chunks}
                      </Link>
                    ),
                  })}
                </p>
                <div className="mt-4">
                  {loading ? (
                    renderCardSkeletons()
                  ) : sectionErrors.bookings ? (
                    renderSectionError("bookings")
                  ) : bookings.length === 0 ? (
                    emptyState(t("bookings.empty"))
                  ) : (
                    <ul role="list" className="space-y-4">
                      {bookings.map((booking) => (
                        <li key={booking.id} className="rounded-2xl bg-white p-6 shadow-sm">
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <h3 className="text-lg font-semibold text-gray-900">
                                <Link
                                  id={`booking-link-${booking.id}`}
                                  href={`/booking/${booking.id}`}
                                  className={`hover:underline ${focusRing}`}
                                >
                                  {booking.property.title}
                                </Link>
                              </h3>
                              <p className="text-sm text-gray-500">
                                {booking.property.location.city},{" "}
                                {booking.property.location.country}
                              </p>
                              <p className="mt-1 text-sm text-gray-600">
                                {t("bookings.room", { name: booking.room.name })}
                              </p>
                            </div>
                            <BookingStatusBadge status={booking.status} />
                          </div>

                          <dl className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
                            <div>
                              <dt className="text-gray-500">{t("bookings.checkIn")}</dt>
                              <dd className="font-medium text-gray-900">
                                {formatDate(booking.checkIn)}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-gray-500">{t("bookings.checkOut")}</dt>
                              <dd className="font-medium text-gray-900">
                                {formatDate(booking.checkOut)}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-gray-500">{t("bookings.guests")}</dt>
                              <dd className="font-medium text-gray-900">{booking.guestCount}</dd>
                            </div>
                            <div>
                              <dt className="text-gray-500">{t("bookings.total")}</dt>
                              <dd className="font-medium text-gray-900">
                                {formatPrice(booking.totalPriceMinor, booking.currency)}
                              </dd>
                            </div>
                          </dl>

                          {booking.status === "HELD" && booking.holdExpiresAt && (
                            <p className="mt-4 text-sm text-gray-700">
                              {t("bookings.holdUntil", {
                                time: fmt.dateTime(booking.holdExpiresAt),
                              })}
                            </p>
                          )}

                          <div className="mt-4 flex flex-wrap gap-3">
                            {booking.status === "HELD" && (
                              <Link href={`/booking/${booking.id}`} className={primaryLinkClass}>
                                {t("bookings.completePayment")}
                                <span className="sr-only">: {booking.property.title}</span>
                              </Link>
                            )}
                            <Link
                              id={`booking-details-${booking.id}`}
                              href={`/booking/${booking.id}`}
                              className={secondaryLinkClass}
                            >
                              {t("bookings.details")}
                              <span className="sr-only">: {booking.property.title}</span>
                            </Link>
                            {(booking.status === "PENDING" || booking.status === "CONFIRMED") && (
                              <button
                                type="button"
                                onClick={() => cancelBooking(booking)}
                                aria-disabled={cancellingId === booking.id || undefined}
                                aria-busy={cancellingId === booking.id || undefined}
                                className={`min-h-[44px] rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 sm:min-h-0 ${focusRing}`}
                              >
                                {cancellingId === booking.id
                                  ? t("bookings.cancelling")
                                  : t("bookings.cancel")}
                                <span className="sr-only">: {booking.property.title}</span>
                              </button>
                            )}
                            {/* Favoriler yüklenemediyse durum bilinmez: yanlış "Ekle" gösterilmez. */}
                            {!sectionErrors.favorites && (
                              <button
                                type="button"
                                onClick={() =>
                                  toggleFavorite(booking.propertyId, `booking-${booking.id}`)
                                }
                                aria-disabled={favoritingId === booking.propertyId || undefined}
                                aria-busy={favoritingId === booking.propertyId || undefined}
                                className={`min-h-[44px] rounded-md border px-4 py-2 text-sm font-medium transition-colors aria-disabled:cursor-not-allowed aria-disabled:opacity-50 sm:min-h-0 ${focusRing} ${
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
                                <span className="sr-only">: {booking.property.title}</span>
                              </button>
                            )}
                          </div>
                          {renderNotice(`booking-${booking.id}`)}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {/* Sunucu sayfa sayfa döndürür: daha eski rezervasyonlar sessizce kaybolmaz. */}
                {!loading && !sectionErrors.bookings && bookingsCursor && (
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <Button
                      variant="secondary"
                      busy={loadingMore}
                      onClick={loadMoreBookings}
                      className="min-h-[44px] sm:min-h-0"
                    >
                      {loadingMore ? tCommon("loading") : t("bookings.loadMore")}
                    </Button>
                    <p className="text-sm text-gray-700">
                      {t("bookings.shown", { count: bookings.length })}
                    </p>
                  </div>
                )}
                <div className="mt-2">
                  <Status error={loadMoreError} />
                </div>
              </section>
            )}

            {/* Favoriler */}
            {showFavorites && (
              <section id="account-favorites" aria-labelledby="account-favorites-title">
                <h2 id="account-favorites-title" className="text-xl font-semibold text-gray-900">
                  {t("favorites.title")}
                </h2>
                {/* Kaldırma/geri alma sonucu: kalıcı canlı bölge + "Geri al" (süre sınırı yok). */}
                <div className="flex flex-wrap items-center gap-x-3 text-sm">
                  <div role="status">
                    {favoritesFeedback && (
                      <p
                        className={`mt-3 ${
                          favoritesFeedback.kind === "error" ? "text-red-700" : "text-gray-800"
                        }`}
                      >
                        {favoritesFeedback.text}
                      </p>
                    )}
                  </div>
                  {removedFavorite && (
                    <Button
                      id="favorite-undo"
                      variant="secondary"
                      busy={undoing}
                      onClick={undoRemoveFavorite}
                      className="mt-3 min-h-[44px] sm:min-h-0"
                    >
                      {t("favorites.undo")}
                      <span className="sr-only">: {removedFavorite.favorite.property.title}</span>
                    </Button>
                  )}
                </div>
                <div className="mt-4">
                  {loading ? (
                    renderCardSkeletons()
                  ) : sectionErrors.favorites ? (
                    renderSectionError("favorites")
                  ) : favorites.length === 0 ? (
                    emptyState(t("favorites.empty"))
                  ) : (
                    <ul role="list" className="space-y-4">
                      {favorites.map((favorite, index) => (
                        <li key={favorite.id} className="rounded-2xl bg-white p-6 shadow-sm">
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
                                {favorite.property.location.city},{" "}
                                {favorite.property.location.country}
                              </p>
                              <div className="mt-2 flex items-center gap-2">
                                {favorite.property.ratingCount > 0 ? (
                                  <>
                                    <RatingBadge value={favorite.property.ratingAvg} size="sm" />
                                    <span className="text-xs text-gray-500">
                                      {t("favorites.reviews", {
                                        count: favorite.property.ratingCount,
                                      })}
                                    </span>
                                  </>
                                ) : (
                                  <span className="text-xs text-gray-500">
                                    {tProperty("noRatingYet")}
                                  </span>
                                )}
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
                              id={`favorite-remove-${favorite.id}`}
                              type="button"
                              onClick={() => removeFavorite(favorite, index)}
                              aria-disabled={favoritingId === favorite.propertyId || undefined}
                              aria-busy={favoritingId === favorite.propertyId || undefined}
                              className={`min-h-[44px] shrink-0 rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 sm:min-h-0 ${focusRing}`}
                            >
                              {favoritingId === favorite.propertyId
                                ? t("favorites.removing")
                                : t("favorites.remove")}
                              <span className="sr-only">: {favorite.property.title}</span>
                            </button>
                          </div>
                          {renderNotice(`favorite-${favorite.id}`)}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>
            )}
          </div>
        )}

        <div id="account-wallet">
          <WalletPanel />
        </div>

        {/* Güvenlik: kimlik doğrulama, passkey'ler, oturumlar ve çıkış bir arada. */}
        <div id="account-security">
          <IdentityVerification role={user?.role} />

          <PasskeyManager />

          <section
            aria-labelledby="account-session-title"
            className="mt-8 rounded-xl bg-white p-6 shadow-sm"
          >
            <h2 id="account-session-title" className="text-xl font-semibold text-gray-900">
              {t("sessions.title")}
            </h2>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Link href="/account/sessions" className={secondaryLinkClass}>
                {t("sessions.manageLink")}
              </Link>
              <Button
                variant="secondary"
                busy={loggingOut}
                onClick={handleLogout}
                className="min-h-[44px] sm:min-h-0"
              >
                {loggingOut ? tNav("loggingOut") : tNav("logout")}
              </Button>
            </div>
          </section>
        </div>

        {/* İleri düzey: varsayılan kapalı, sayfayı kısaltır. */}
        <details id="account-advanced" className="mt-8">
          <summary
            className={`min-h-[44px] cursor-pointer rounded-md py-2 text-lg font-semibold text-gray-900 ${focusRing}`}
          >
            {t("sections.advancedSummary")}
          </summary>
          <div className="mt-4">
            <AgentMandates />
          </div>
        </details>
      </main>
      <Footer />
      {confirmDialog}
    </div>
  );
}
