"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { ApiError, apiFetch, isNetworkError } from "@/lib/api-client";
import BookingActions from "@/components/booking/BookingActions";
import RnplPlanCard, { type RnplPlan } from "@/components/booking/RnplPlan";
import BookingMessages from "@/components/booking/BookingMessages";
import BookingResolutionPanel, {
  RESOLUTION_PANEL_TITLE_ID,
} from "@/components/resolution/BookingResolutionPanel";
import BookingPriceSnapshot, {
  CancellationDeadlineNote,
} from "@/components/booking/BookingPriceSnapshot";
import BookingNumberText from "@/components/booking/BookingNumberText";
import { useFormat } from "@/i18n/use-format";
import { Button, focusRing, loginHref, useErrorText } from "@/components/ui/ui";

interface BookingDetail {
  id: string;
  checkIn: string;
  checkOut: string;
  guestCount: number;
  totalPriceMinor: number;
  currency: string;
  status: string;
  holdExpiresAt?: string | null;
  createdAt?: string;
  /** Rezervasyon anındaki fiyat kırılımı ve iptal politikası (JSON anlık görüntü). */
  priceBreakdown?: unknown;
  policySnapshot?: unknown;
  property: {
    id: string;
    title: string;
    /** Tesisin yerel giriş/çıkış saati (SS:DD). */
    checkInTime?: string;
    checkOutTime?: string;
    timeZone?: string;
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

/** Ödemesi alınmamış ya da artık geçerli olmayan durumlar: başlığın altında açıklama gösterilir. */
const HINT_KEYS = ["HELD", "PENDING", "CANCELLED", "EXPIRED"] as const;
type HintKey = (typeof HINT_KEYS)[number];

function isHintKey(status: string): status is HintKey {
  return (HINT_KEYS as readonly string[]).includes(status);
}

/** Mesaj geçmişi olabilecek durumlar (onaydan sonra iptal edilen rezervasyon dahil). */
const MESSAGE_STATUSES = ["CONFIRMED", "COMPLETED", "CANCELLED"];
const SETTLED_STATUSES = ["CONFIRMED", "COMPLETED"];
/** Ödemesi/onayı beklenen durumlar: mesajlaşmanın neden henüz açılmadığı açıklanır. */
const AWAITING_STATUSES = ["HELD", "PENDING"];
/** Henüz iptal edilebilen durumlar: ücretsiz iptal son anı gösterilir. */
const CANCELLABLE_STATUSES = ["HELD", "PENDING", "CONFIRMED"];

/** Tüm rezervasyonların (iptal ve geçmiş dahil) listelendiği bölüm. */
const MY_BOOKINGS_HREF = "/account#account-bookings";

/** setTimeout üst sınırı (~24,8 gün); daha uzak tutma bitişi için zamanlayıcı kurulmaz. */
const MAX_TIMEOUT_MS = 2_147_483_647;

/** Yükleme hatası; 404 (yok ya da başkasına ait) yeniden denenmez, ayrı başlıkla gösterilir. */
interface LoadFailure {
  text: string;
  retryable: boolean;
  notFound: boolean;
}

const skeletonBlock = "rounded-lg bg-gray-200 motion-safe:animate-pulse";

/** Yükleme isteği askıda kalırsa "Yükleniyor..." sonsuza dek durmasın diye zaman aşımı. */
const LOAD_TIMEOUT_MS = 15_000;

/** Durumu yalnız renkle değil biçimle de anlatan simge (✓ onaylı, saat: bekliyor, ✕ geçersiz). */
const STATUS_ICON_PATHS: Record<StatusKey, string> = {
  CONFIRMED: "M8.5 12.5l2.5 2.5 4.5-5",
  COMPLETED: "M8.5 12.5l2.5 2.5 4.5-5",
  HELD: "M12 7v5l3 2",
  PENDING: "M12 7v5l3 2",
  CANCELLED: "M15 9l-6 6M9 9l6 6",
  EXPIRED: "M15 9l-6 6M9 9l6 6",
};

function StatusIcon({ status }: { status: string }) {
  if (!isStatusKey(status)) return null;
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="mt-0.5 h-7 w-7 shrink-0"
    >
      <circle cx="12" cy="12" r="9" />
      <path d={STATUS_ICON_PATHS[status]} />
    </svg>
  );
}

/** Yüklenirken kartın düzenini taklit eden iskelet (ekran okuyucudan gizli). */
function BookingSkeleton() {
  return (
    <div aria-hidden="true" className="overflow-hidden rounded-2xl bg-white shadow-sm">
      <div className="space-y-2 px-4 py-6 sm:px-8">
        <div className={`h-8 w-2/3 ${skeletonBlock}`} />
        <div className={`h-4 w-1/2 ${skeletonBlock}`} />
      </div>
      <div className="space-y-6 px-4 py-6 sm:px-8">
        <div className="space-y-2">
          <div className={`h-6 w-1/2 ${skeletonBlock}`} />
          <div className={`h-4 w-1/3 ${skeletonBlock}`} />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className={`h-20 ${skeletonBlock}`} />
          <div className={`h-20 ${skeletonBlock}`} />
          <div className={`h-20 ${skeletonBlock}`} />
        </div>
        <div className={`h-8 ${skeletonBlock}`} />
        <div className={`h-64 ${skeletonBlock}`} />
      </div>
    </div>
  );
}

export default function BookingConfirmationPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("booking");
  const tc = useTranslations("common");
  const tChat = useTranslations("chat");
  const tResolution = useTranslations("resolution");
  const tTitles = useTranslations("titles");
  const f = useFormat();
  const errorText = useErrorText();
  const [booking, setBooking] = useState<BookingDetail | null>(null);
  const [plan, setPlan] = useState<RnplPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<LoadFailure | null>(null);
  const [retrying, setRetrying] = useState(false);
  /** İptal/süresi dolmuş rezervasyonun giriş tarihi geçmediyse aynı tarihler yeniden aranabilir. */
  const [canRebook, setCanRebook] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(false);
  /** Ödeme/iptal sonrası durum değişikliği duyurusu (her zaman mount edilen canlı bölge). */
  const [announcement, setAnnouncement] = useState("");
  /** Süresi dolan tutmanın bitiş anı: sunucu durumu güncelleyene dek başlık "süre doldu" olur. */
  const [lapsedHold, setLapsedHold] = useState<string | null>(null);
  const prevStatus = useRef<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusHeading = useRef(false);

  const load = useCallback(
    async (focusOnSuccess = false) => {
      if (!id) return;
      try {
        const data = await apiFetch<{ booking: BookingDetail; paymentPlan?: RnplPlan | null }>(
          `/api/bookings/${id}`,
          {
            signal:
              typeof AbortSignal.timeout === "function"
                ? AbortSignal.timeout(LOAD_TIMEOUT_MS)
                : undefined,
          }
        );
        const next = data.booking.status;
        if (prevStatus.current !== null && prevStatus.current !== next) {
          setAnnouncement(
            next === "CONFIRMED"
              ? t("detail.statusChanged.CONFIRMED")
              : next === "CANCELLED"
                ? t("detail.statusChanged.CANCELLED")
                : t("detail.statusChanged.other", {
                    status: isStatusKey(next) ? t(`status.${next}`) : next,
                  })
          );
          // Ödeme formu gibi odaktaki öğe DOM'dan kalkabileceği için odak başlığa taşınır.
          focusHeading.current = true;
        }
        // "Tekrar dene" düğmesi başarıda DOM'dan kalkar; odak başlığa taşınır.
        if (focusOnSuccess) focusHeading.current = true;
        prevStatus.current = next;
        // Açılışta tutma süresi zaten dolmuşsa başlık zamanlayıcıyı beklemeden güncellenir.
        const hold = next === "HELD" ? data.booking.holdExpiresAt : null;
        if (hold && Date.parse(hold) <= Date.now()) setLapsedHold(hold);
        setError(null);
        setBooking(data.booking);
        setPlan(data.paymentPlan ?? null);
        setCanRebook(Date.parse(data.booking.checkIn) > Date.now());
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) setNeedsLogin(true);
        const notFound = err instanceof ApiError && err.status === 404;
        const timedOut =
          err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
        // Ham `message` (ör. "Failed to fetch", Türkçe sunucu metni) arayüz diline çevrilir.
        setError({
          text: notFound
            ? t("detail.notFound")
            : timedOut
              ? tc("errors.network")
              : err instanceof ApiError || isNetworkError(err)
                ? errorText(err, t("detail.tryLater"))
                : t("detail.tryLater"),
          retryable: !notFound,
          notFound,
        });
      } finally {
        setLoading(false);
      }
    },
    [id, t, tc, errorText]
  );

  const retry = async () => {
    setRetrying(true);
    await load(true);
    setRetrying(false);
  };

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (!focusHeading.current) return;
    focusHeading.current = false;
    // Durum bandı ekran dışında kalmış olabilir (ör. ödeme formunun altı): görünür kılınır.
    headingRef.current?.focus({ preventScroll: true });
    headingRef.current?.scrollIntoView({ block: "start" });
  }, [booking]);

  // Tutma süresi dolunca sayfa yeniden çekilir; sunucu hâlâ HELD dönerse başlık yine güncellenir.
  const holdEnd = booking?.status === "HELD" ? (booking.holdExpiresAt ?? null) : null;
  useEffect(() => {
    if (!holdEnd) return;
    const ms = Date.parse(holdEnd) - Date.now();
    if (!Number.isFinite(ms) || ms > MAX_TIMEOUT_MS) return;
    // Saat farkı payı: sunucu tutmayı bir saniye sonra kesin olarak bırakmış sayar.
    const delay = Math.max(0, ms) + 1000;
    const timer = setTimeout(() => {
      setLapsedHold(holdEnd);
      void load();
    }, delay);
    return () => clearTimeout(timer);
  }, [holdEnd, load]);

  if (needsLogin) {
    return (
      <div className="flex min-h-screen flex-col bg-gray-50">
        <Header />
        <main id="main" className="mx-auto flex max-w-3xl flex-1 items-center justify-center px-4">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-gray-900">{t("detail.loginRequiredTitle")}</h1>
            <p className="mt-2 text-gray-600">{t("detail.loginRequiredText")}</p>
            <Link
              href={loginHref()}
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

  const secondaryAction =
    "rounded-lg border border-gray-300 px-6 py-3 text-sm font-semibold text-gray-700 transition hover:bg-gray-50";

  /** Kısa yol bağlantıları: dikey dolgu dokunma hedefini ~28px yapar. */
  const shortcutLink = `inline-block rounded py-1 font-semibold text-[#003580] hover:underline ${focusRing}`;

  const supportHref = booking ? `/support?bookingId=${encodeURIComponent(booking.id)}` : "/support";

  /** Tutma süresi istemcide dolduysa sunucu güncellenene dek "süresi doldu" gösterilir. */
  const shownStatus =
    booking?.status === "HELD" && lapsedHold !== null && lapsedHold === booking.holdExpiresAt
      ? "EXPIRED"
      : (booking?.status ?? "");

  /** İptal/süresi dolmuş ve tarihi geçmemiş rezervasyonda tesis bağlantısı aynı tarihleri taşır. */
  const rebookQuery =
    booking && canRebook && ["CANCELLED", "EXPIRED"].includes(shownStatus)
      ? new URLSearchParams({
          checkIn: booking.checkIn.slice(0, 10),
          checkOut: booking.checkOut.slice(0, 10),
          guests: String(booking.guestCount),
        }).toString()
      : null;

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <div className="print:hidden">
        <Header />
      </div>
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        <p role="status" className="sr-only">
          {loading ? t("detail.loading") : announcement}
        </p>
        {loading ? (
          <>
            <h1 className="sr-only">{tTitles("booking")}</h1>
            <BookingSkeleton />
          </>
        ) : error && !booking ? (
          <div className="rounded-2xl bg-white p-4 text-center shadow-sm sm:p-8">
            <h1 className="text-xl font-bold text-red-600">
              {error.notFound ? t("detail.notFoundTitle") : t("detail.loadFailed")}
            </h1>
            <p role="alert" className="mt-2 text-gray-600">
              {error.text}
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
              {error.retryable && (
                <Button busy={retrying} onClick={() => void retry()}>
                  {tc("errorPage.retry")}
                </Button>
              )}
              <Link
                href={MY_BOOKINGS_HREF}
                className="text-sm font-semibold text-[#003580] hover:underline"
              >
                {t("detail.myBookings")}
              </Link>
              <Link href="/" className="text-sm font-semibold text-[#003580] hover:underline">
                {t("detail.backHome")}
              </Link>
            </div>
          </div>
        ) : booking ? (
          <>
            {error && (
              // Rezervasyon zaten gösteriliyorsa yenileme hatası sayfanın yerine geçmez.
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 print:hidden">
                <p role="alert">
                  {t("detail.refreshFailed")} {error.text}
                </p>
                {error.retryable && (
                  <Button variant="secondary" busy={retrying} onClick={() => void retry()}>
                    {tc("errorPage.retry")}
                  </Button>
                )}
              </div>
            )}
            <div className="overflow-hidden rounded-2xl bg-white shadow-sm print:shadow-none">
              {/* Baskıda arka plan düşer; beyaz başlık okunur kalsın diye renk korunur. */}
              <div className="flex items-start gap-3 bg-green-700 px-4 py-6 text-white [print-color-adjust:exact] sm:px-8">
                <StatusIcon status={shownStatus} />
                <div className="min-w-0">
                  {/* Ekran okuyucuda hangi rezervasyon olduğu başlıktan anlaşılsın. */}
                  <h1 ref={headingRef} tabIndex={-1} className="scroll-mt-16 text-2xl font-bold">
                    {t.rich("detail.heading", {
                      status: isStatusKey(shownStatus) ? t(`status.${shownStatus}`) : shownStatus,
                      property: booking.property.title,
                      sr: (chunks) => <span className="sr-only">{chunks}</span>,
                    })}
                  </h1>
                  {isHintKey(shownStatus) && (
                    <p className="mt-1 text-sm text-green-50">
                      {t(`detail.statusHint.${shownStatus}`)}
                    </p>
                  )}
                  <p className="mt-1 text-sm text-green-50">
                    {t.rich("detail.bookingNumber", {
                      id: booking.id,
                      b: () => <BookingNumberText id={booking.id} />,
                    })}
                  </p>
                </div>
              </div>

              {/* Uzun sayfada alttaki bölümlere ve sık kullanılan işlemlere kısa yol. */}
              <nav
                aria-label={t("detail.shortcuts")}
                className="border-b border-gray-100 px-4 py-3 sm:px-8 print:hidden"
              >
                <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
                  {MESSAGE_STATUSES.includes(booking.status) && (
                    <li>
                      <a href="#msg-title" className={shortcutLink}>
                        {tChat("title")}
                      </a>
                    </li>
                  )}
                  {SETTLED_STATUSES.includes(booking.status) && (
                    <li>
                      <a href={`#${RESOLUTION_PANEL_TITLE_ID}`} className={shortcutLink}>
                        {tResolution("panel.title")}
                      </a>
                    </li>
                  )}
                  <li>
                    <Link href={supportHref} className={shortcutLink}>
                      {t("supportLink")}
                    </Link>
                  </li>
                  <li>
                    <button type="button" onClick={print} className={shortcutLink}>
                      {t("detail.print")}
                    </button>
                  </li>
                </ul>
              </nav>

              <div className="space-y-6 px-4 py-6 sm:px-8">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">{booking.property.title}</h2>
                  <p className="text-sm text-gray-500">
                    {booking.property.location.city}, {booking.property.location.country}
                  </p>
                </div>

                <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
                  <div className="rounded-lg bg-gray-50 p-4">
                    <dt className="text-gray-500">{t("detail.checkIn")}</dt>
                    <dd className="mt-1 font-medium text-gray-900">
                      {formatDate(booking.checkIn)}
                      {booking.property.checkInTime && (
                        <span className="block font-normal text-gray-600">
                          {t("detail.checkInTime", { time: booking.property.checkInTime })}
                        </span>
                      )}
                    </dd>
                  </div>
                  <div className="rounded-lg bg-gray-50 p-4">
                    <dt className="text-gray-500">{t("detail.checkOut")}</dt>
                    <dd className="mt-1 font-medium text-gray-900">
                      {formatDate(booking.checkOut)}
                      {booking.property.checkOutTime && (
                        <span className="block font-normal text-gray-600">
                          {t("detail.checkOutTime", { time: booking.property.checkOutTime })}
                        </span>
                      )}
                    </dd>
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

                <div className="space-y-4">
                  <BookingPriceSnapshot
                    breakdown={booking.priceBreakdown}
                    chargeCurrency={booking.currency}
                  />
                  <div className="flex items-center justify-between border-t border-gray-100 pt-4">
                    <span className="text-sm text-gray-600">{t("detail.total")}</span>
                    <span className="text-xl font-bold text-gray-900">
                      {f.money(booking.totalPriceMinor, booking.currency)}
                    </span>
                  </div>
                </div>

                <RnplPlanCard plan={plan} />

                {CANCELLABLE_STATUSES.includes(shownStatus) && (
                  <CancellationDeadlineNote
                    policy={booking.policySnapshot}
                    checkIn={booking.checkIn}
                    createdAt={booking.createdAt}
                    timeZone={booking.property.timeZone}
                    checkInTime={booking.property.checkInTime}
                  />
                )}

                {/* Etkileşimli bölümler baskıda gizlenir (çıktı yalnız rezervasyon özeti). */}
                <div className="space-y-6 empty:hidden print:hidden">
                  <BookingActions
                    bookingId={booking.id}
                    status={booking.status}
                    holdExpiresAt={booking.holdExpiresAt}
                    amountMinor={booking.totalPriceMinor}
                    currency={booking.currency}
                    onChanged={() => void load()}
                  />

                  {/* İptalden sonra da geçmiş okunur; yazma izni sunucunun `canWrite` alanında.
                      `key`: durum değişince konu yeniden çekilir (yazma izni güncellenir). */}
                  {MESSAGE_STATUSES.includes(booking.status) && (
                    <BookingMessages key={booking.status} bookingId={booking.id} />
                  )}

                  {AWAITING_STATUSES.includes(shownStatus) && (
                    <p className="text-sm text-gray-600">
                      {t.rich("detail.messagingAfterConfirm", {
                        link: (chunks) => (
                          <Link
                            href={supportHref}
                            className={`font-semibold text-[#003580] underline ${focusRing}`}
                          >
                            {chunks}
                          </Link>
                        ),
                      })}
                    </p>
                  )}

                  {SETTLED_STATUSES.includes(booking.status) && (
                    <BookingResolutionPanel bookingId={booking.id} />
                  )}
                </div>

                <div className="flex flex-wrap gap-3 border-t border-gray-100 pt-6 print:hidden">
                  <Link
                    href={
                      rebookQuery
                        ? `/property/${booking.property.id}?${rebookQuery}`
                        : `/property/${booking.property.id}`
                    }
                    className="rounded-lg bg-[#003580] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#002b66]"
                  >
                    {rebookQuery ? t("detail.rebook") : t("detail.viewProperty")}
                  </Link>
                  {SETTLED_STATUSES.includes(booking.status) && (
                    <a
                      href={`/api/bookings/${booking.id}/invoice`}
                      download
                      type="application/pdf"
                      className={secondaryAction}
                    >
                      {t("detail.invoice")}
                    </a>
                  )}
                  <Link href={MY_BOOKINGS_HREF} className={secondaryAction}>
                    {t("detail.myBookings")}
                  </Link>
                  <button type="button" onClick={print} className={secondaryAction}>
                    {t("detail.print")}
                  </button>
                </div>
              </div>
            </div>
          </>
        ) : null}
      </main>
      {/* Yüklenirken altbilgi çizilmez: içerik gelince aşağı kayıp düzen kaymasına yol açmasın. */}
      {!loading && (
        <div className="print:hidden">
          <Footer />
        </div>
      )}
    </div>
  );
}
