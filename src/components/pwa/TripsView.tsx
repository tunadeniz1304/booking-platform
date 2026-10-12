"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useFormat } from "@/i18n/use-format";
import type { Formatter } from "@/lib/i18n/format";
import { Button, ButtonLink, focusRing, loginHref } from "@/components/ui/ui";
import { refreshSessionUser } from "@/components/layout/useSessionUserCache";
import BookingNumberText from "@/components/booking/BookingNumberText";
import { APP_RECONNECT_EVENT } from "@/components/pwa/NetworkStatusBanner";

interface ItineraryItem {
  id: string;
  code: string;
  qrDataUrl: string;
  propertyTitle: string;
  city: string;
  country: string;
  roomName: string;
  checkIn: string;
  checkOut: string;
  checkInTime: string;
  /** Eski önbellek kopyalarında yok. */
  checkOutTime?: string;
  guestCount: number;
}

interface Itinerary {
  items: ItineraryItem[];
  generatedAt: string;
}

type State =
  | { kind: "loading" }
  | { kind: "unauthorized" }
  | { kind: "offline-empty" }
  | { kind: "error" }
  | { kind: "ready"; data: Itinerary; fromCache: boolean };

/** Yanıt bu süreyi aşarsa istek kesilir ve "Tekrar dene" gösterilir. */
const LOAD_TIMEOUT_MS = 20_000;
const DAY_MS = 86_400_000;
/** /trips yalnız yaklaşan onaylı rezervasyonları gösterir; tam liste hesap sayfasındadır. */
const ALL_BOOKINGS_HREF = "/account#account-bookings";

async function loadItinerary(signal: AbortSignal): Promise<Response> {
  const init: RequestInit = { credentials: "same-origin", signal };
  const res = await fetch("/api/itinerary", init);
  if (res.status !== 401) return res;
  // Oturum yenileme apiFetch'in tekil isteğiyle yapılır (başlığın /api/user/me isteğiyle ortak).
  const user = await refreshSessionUser();
  return user ? fetch("/api/itinerary", init) : res;
}

/** "14:00" gibi tesis saatini etkin dile göre biçimlendirir. */
function propertyTime(fmt: Formatter, hhmm: string): string {
  return /^\d{2}:\d{2}$/.test(hhmm) ? fmt.time(`1970-01-01T${hhmm}:00.000Z`, "UTC") : hhmm;
}

function stayNights(checkIn: string, checkOut: string): number {
  const diff = Date.parse(`${checkOut}T00:00:00.000Z`) - Date.parse(`${checkIn}T00:00:00.000Z`);
  return Number.isFinite(diff) ? Math.max(0, Math.round(diff / DAY_MS)) : 0;
}

/**
 * Seyahat kartları (P1-12). Veri service worker üzerinden network-first gelir; ağ yoksa son
 * kaydedilen kopya (`x-sw-cache: hit`) "çevrimdışı" bandıyla gösterilir. QR yalnızca imzalı
 * rezervasyon kodunu içerir; kartta detay sayfası ve e-postayla aynı rezervasyon numarası yazar.
 */
export default function TripsView() {
  const t = useTranslations("pwa.trips");
  const tc = useTranslations("common");
  const fmt = useFormat();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [copy, setCopy] = useState<{ id: string; ok: boolean } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const focusAfterRetry = useRef(false);
  /** Bağlantı dönünce yapılan arka plan yenilemesi (başarısızsa eldeki kopya korunur). */
  const backgroundRefresh = useRef(false);

  useEffect(() => {
    let active = true;
    let timer = 0;
    const background = backgroundRefresh.current;
    backgroundRefresh.current = false;
    const controller = new AbortController();
    const finish = (next: State) => {
      if (!active) return;
      active = false;
      window.clearTimeout(timer);
      setRetrying(false);
      setState((prev) =>
        background && prev.kind === "ready" && next.kind !== "ready" ? prev : next
      );
    };
    timer = window.setTimeout(() => {
      controller.abort();
      finish({ kind: "error" });
    }, LOAD_TIMEOUT_MS);
    loadItinerary(controller.signal)
      .then(async (res) => {
        if (res.status === 401) return finish({ kind: "unauthorized" });
        if (res.status === 503) {
          const body = (await res.json().catch(() => ({}))) as { code?: string };
          if (body.code === "OFFLINE") return finish({ kind: "offline-empty" });
        }
        if (!res.ok) return finish({ kind: "error" });
        const data = (await res.json()) as Itinerary;
        const fromCache = res.headers.get("x-sw-cache") === "hit" || !navigator.onLine;
        finish({ kind: "ready", data, fromCache });
      })
      .catch(() => finish({ kind: navigator.onLine ? "error" : "offline-empty" }));
    return () => {
      active = false;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [attempt]);

  // Tekrar dene başarılı olunca düğme kalkar; odak listeye taşınır (<body>'ye düşmez).
  useEffect(() => {
    if (!focusAfterRetry.current) return;
    focusAfterRetry.current = false;
    if (state.kind === "ready") listRef.current?.focus();
  }, [state]);

  // Çevrimdışı kopya ya da boş çevrimdışı durumda bağlantı dönünce liste kendiliğinden yenilenir.
  const stale = (state.kind === "ready" && state.fromCache) || state.kind === "offline-empty";
  useEffect(() => {
    if (!stale) return;
    const onReconnect = () => {
      backgroundRefresh.current = true;
      setAttempt((n) => n + 1);
    };
    window.addEventListener(APP_RECONNECT_EVENT, onReconnect);
    return () => window.removeEventListener(APP_RECONNECT_EVENT, onReconnect);
  }, [stale]);

  const retry = () => {
    focusAfterRetry.current = true;
    setRetrying(true);
    setAttempt((n) => n + 1);
  };

  const copyNumber = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      setCopy({ id, ok: true });
    } catch {
      setCopy({ id, ok: false });
    }
  };

  if (state.kind === "loading") {
    return (
      <p aria-live="polite" className="text-sm text-gray-700">
        {t("loading")}
      </p>
    );
  }
  if (state.kind === "unauthorized") {
    return (
      <p className="text-sm text-gray-800">
        {t("loginRequired")}{" "}
        <Link href={loginHref()} className={`font-semibold text-[#003580] underline ${focusRing}`}>
          {t("loginLink")}
        </Link>
      </p>
    );
  }
  if (state.kind === "offline-empty") {
    return (
      <p role="status" className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
        {t("offlineUnavailable")}
      </p>
    );
  }
  if (state.kind === "error") {
    return (
      <div className="space-y-3">
        <p key={attempt} role="alert" className="text-sm text-red-700">
          {t("loadError")}
        </p>
        <Button variant="secondary" busy={retrying} onClick={retry}>
          {tc("errorPage.retry")}
        </Button>
      </div>
    );
  }

  const { data, fromCache } = state;
  return (
    <div ref={listRef} tabIndex={-1} className="space-y-4 focus:outline-none" data-testid="trips">
      {fromCache && (
        <p
          role="status"
          data-testid="offline-banner"
          className="rounded-md bg-amber-50 p-3 text-sm text-amber-900"
        >
          {t("offlineBanner", { time: fmt.dateTime(data.generatedAt) })}
        </p>
      )}
      {data.items.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-700">
          <p>{t("empty")}</p>
          <p className="mt-1 text-xs text-gray-600">{t("emptyNote")}</p>
          <div className="mt-4 flex flex-wrap justify-center gap-3">
            <ButtonLink href="/">{tc("notFound.search")}</ButtonLink>
            <ButtonLink href={ALL_BOOKINGS_HREF} variant="secondary">
              {t("allBookingsLink")}
            </ButtonLink>
          </div>
        </div>
      ) : (
        <>
          <p className="text-xs text-gray-700">{t("qrHint")}</p>
          <ul className="space-y-4">
            {data.items.map((item) => {
              const titleId = `trip-${item.id}-title`;
              const numberId = `trip-${item.id}-number`;
              return (
                <li
                  key={item.id}
                  data-testid="trip-card"
                  className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm sm:flex-row"
                >
                  <div className="flex-1 space-y-2">
                    <h2 id={titleId} className="text-lg font-semibold text-gray-900">
                      {item.propertyTitle}
                    </h2>
                    <Link
                      href={`/booking/${item.id}`}
                      aria-describedby={titleId}
                      className={`inline-block text-sm font-semibold text-[#003580] underline ${focusRing}`}
                    >
                      {t("detailsLink")}
                    </Link>
                    <p className="text-sm text-gray-700">
                      {item.city}, {item.country} · {t("room", { name: item.roomName })}
                    </p>
                    <dl className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <dt className="text-gray-600">{t("checkIn")}</dt>
                        <dd className="font-medium text-gray-900">
                          {fmt.date(item.checkIn, "long")}
                          <span className="block text-xs text-gray-600">
                            {t("checkInFrom", { time: propertyTime(fmt, item.checkInTime) })}
                          </span>
                        </dd>
                      </div>
                      <div>
                        <dt className="text-gray-600">{t("checkOut")}</dt>
                        <dd className="font-medium text-gray-900">
                          {fmt.date(item.checkOut, "long")}
                          {item.checkOutTime && (
                            <span className="block text-xs text-gray-600">
                              {t("checkOutUntil", { time: propertyTime(fmt, item.checkOutTime) })}
                            </span>
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-gray-600">{t("stay")}</dt>
                        <dd className="font-medium text-gray-900">
                          {t("nights", { count: stayNights(item.checkIn, item.checkOut) })}
                        </dd>
                      </div>
                    </dl>
                    <p className="text-sm text-gray-700">
                      {t("guests", { count: item.guestCount })}
                    </p>
                  </div>
                  <div className="flex w-full flex-col items-center gap-2 sm:w-48">
                    <figure className="flex flex-col items-center gap-2">
                      {/* data: URL — next/image optimizasyonu gerekmez */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={item.qrDataUrl}
                        alt={t("qrAlt", { property: item.propertyTitle })}
                        width={176}
                        height={176}
                        className="h-44 w-44 bg-white"
                      />
                      <figcaption className="text-center text-sm text-gray-700">
                        <span className="block text-xs font-medium">{t("codeLabel")}</span>
                        <code
                          id={numberId}
                          className="break-all font-mono text-sm text-gray-900"
                          data-testid="booking-code"
                        >
                          <BookingNumberText id={item.id} className="font-mono" />
                        </code>
                      </figcaption>
                    </figure>
                    <Button
                      variant="secondary"
                      aria-describedby={numberId}
                      onClick={() => void copyNumber(item.id)}
                    >
                      {t("copyNumber")}
                    </Button>
                    <p role="status" className="min-h-4 text-center text-xs text-gray-700">
                      {copy?.id === item.id ? t(copy.ok ? "copied" : "copyFailed") : ""}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
          <ButtonLink href={ALL_BOOKINGS_HREF} variant="secondary">
            {t("allBookingsLink")}
          </ButtonLink>
        </>
      )}
    </div>
  );
}
