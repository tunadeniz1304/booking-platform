"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useFormat } from "@/i18n/use-format";
import { focusRing } from "@/components/ui/ui";

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

async function loadItinerary(): Promise<Response> {
  const res = await fetch("/api/itinerary", { credentials: "same-origin" });
  if (res.status !== 401) return res;
  const refreshed = await fetch("/api/auth/refresh", {
    method: "POST",
    credentials: "same-origin",
  })
    .then((r) => r.ok)
    .catch(() => false);
  return refreshed ? fetch("/api/itinerary", { credentials: "same-origin" }) : res;
}

/**
 * Seyahat kartları (P1-12). Veri service worker üzerinden network-first gelir; ağ yoksa son
 * kaydedilen kopya (`x-sw-cache: hit`) "çevrimdışı" bandıyla gösterilir. QR yalnızca imzalı
 * rezervasyon kodunu içerir.
 */
export default function TripsView() {
  const t = useTranslations("pwa.trips");
  const fmt = useFormat();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let active = true;
    loadItinerary()
      .then(async (res) => {
        if (!active) return;
        if (res.status === 401) return setState({ kind: "unauthorized" });
        if (res.status === 503) {
          const body = (await res.json().catch(() => ({}))) as { code?: string };
          if (body.code === "OFFLINE") return setState({ kind: "offline-empty" });
        }
        if (!res.ok) return setState({ kind: "error" });
        const data = (await res.json()) as Itinerary;
        const fromCache = res.headers.get("x-sw-cache") === "hit" || !navigator.onLine;
        setState({ kind: "ready", data, fromCache });
      })
      .catch(() => {
        if (active) setState({ kind: navigator.onLine ? "error" : "offline-empty" });
      });
    return () => {
      active = false;
    };
  }, []);

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
        <Link href="/login" className={`font-semibold text-[#003580] underline ${focusRing}`}>
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
      <p role="alert" className="text-sm text-red-700">
        {t("loadError")}
      </p>
    );
  }

  const { data, fromCache } = state;
  return (
    <div className="space-y-4" data-testid="trips">
      {fromCache && (
        <p
          role="status"
          data-testid="offline-banner"
          className="rounded-md bg-amber-50 p-3 text-sm text-amber-900"
        >
          {t("offlineBanner", { time: fmt.date(data.generatedAt, "long") })}
        </p>
      )}
      {data.items.length === 0 ? (
        <p className="rounded-xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-700">
          {t("empty")}
        </p>
      ) : (
        <ul className="space-y-4">
          {data.items.map((item) => (
            <li
              key={item.id}
              data-testid="trip-card"
              className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm sm:flex-row"
            >
              <div className="flex-1 space-y-2">
                <h2 className="text-lg font-semibold text-gray-900">{item.propertyTitle}</h2>
                <p className="text-sm text-gray-700">
                  {item.city}, {item.country} · {t("room", { name: item.roomName })}
                </p>
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-gray-600">{t("checkIn")}</dt>
                    <dd className="font-medium text-gray-900">
                      {fmt.date(item.checkIn, "long")}
                      <span className="block text-xs text-gray-600">
                        {t("checkInFrom", { time: item.checkInTime })}
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-gray-600">{t("checkOut")}</dt>
                    <dd className="font-medium text-gray-900">{fmt.date(item.checkOut, "long")}</dd>
                  </div>
                </dl>
                <p className="text-sm text-gray-700">{t("guests", { count: item.guestCount })}</p>
              </div>
              <figure className="flex w-full flex-col items-center gap-2 sm:w-48">
                {/* data: URL — next/image optimizasyonu gerekmez */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.qrDataUrl}
                  alt={t("qrAlt", { property: item.propertyTitle })}
                  width={176}
                  height={176}
                  className="h-44 w-44 bg-white"
                />
                <figcaption className="text-center text-xs text-gray-700">
                  <span className="block font-medium">{t("codeLabel")}</span>
                  <code className="break-all text-[11px] text-gray-900" data-testid="booking-code">
                    {item.code}
                  </code>
                </figcaption>
              </figure>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-gray-700">{t("qrHint")}</p>
    </div>
  );
}
