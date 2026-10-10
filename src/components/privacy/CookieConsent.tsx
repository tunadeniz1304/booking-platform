"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { focusRing } from "@/components/ui/ui";
import { CONSENT_COOKIE, readConsent, type ConsentValue } from "@/lib/privacy/consent";

const MAX_AGE_SECONDS = 180 * 24 * 60 * 60;

const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function writeConsent(value: ConsentValue) {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${CONSENT_COOKIE}=${encodeURIComponent(value)}; Max-Age=${MAX_AGE_SECONDS}; Path=/; SameSite=Lax${secure}`;
  listeners.forEach((l) => l());
}

/**
 * Çerez onay bandı (P2-5): zorunlu çerezler (oturum, güvenlik) her zaman açıktır;
 * analitik çerezler yalnızca açık onayla. Tercih `cookie_consent` çerezinde tutulur.
 * Modal değildir (sayfayı kilitlemez); tüm kontroller klavyeyle kullanılabilir.
 * Görünürken sayfanın altına bant yüksekliği kadar boşluk ve scroll-padding verilir ki
 * Tab ile odaklanan öğeler bandın altında kalmasın (WCAG 2.4.11). Escape = "Yalnızca zorunlu".
 */
export default function CookieConsent() {
  // Sunucuda ve hidrasyonda bant gizli; istemcide çerez yoksa görünür.
  const hasConsent = useSyncExternalStore(
    subscribe,
    () => readConsent(document.cookie) !== null,
    () => true
  );
  const [customizing, setCustomizing] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const t = useTranslations("cookie");
  const bandRef = useRef<HTMLElement>(null);
  const analyticsRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const band = bandRef.current;
    if (hasConsent || !band) return;
    const root = document.documentElement;
    const apply = () => {
      const height = Math.ceil(band.getBoundingClientRect().height);
      root.style.scrollPaddingBottom = `${height + 16}px`;
      document.body.style.paddingBottom = `${height}px`;
    };
    apply();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(apply);
    observer?.observe(band);
    return () => {
      observer?.disconnect();
      root.style.scrollPaddingBottom = "";
      document.body.style.paddingBottom = "";
    };
  }, [hasConsent]);

  // "Özelleştir" düğmesi kaybolur; odak açılan ilk seçilebilir kategoriye taşınır.
  useEffect(() => {
    if (customizing) analyticsRef.current?.focus();
  }, [customizing]);

  if (hasConsent) return null;

  /** Bant kapanmadan önce odak bandın içindeyse ana içeriğe taşınır (odak <body>'ye düşmesin). */
  const decide = (value: ConsentValue) => {
    if (bandRef.current?.contains(document.activeElement)) {
      const main = document.getElementById("main");
      if (main) {
        if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
        main.focus({ preventScroll: true });
      }
    }
    writeConsent(value);
  };

  const buttonBase = `rounded-md px-4 py-2 text-sm font-semibold ${focusRing}`;

  return (
    <section
      ref={bandRef}
      role="region"
      aria-labelledby="cookie-consent-title"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          decide("necessary");
        }
      }}
      className="fixed inset-x-0 bottom-0 z-50 border-t border-gray-300 bg-white p-4 shadow-lg"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="text-sm text-gray-900">
          <h2 id="cookie-consent-title" className="text-base font-semibold">
            {t("title")}
          </h2>
          <p className="mt-1">
            {t.rich("body", {
              link: (chunks) => (
                <Link
                  href="/privacy"
                  className={`font-semibold text-[#003580] underline ${focusRing}`}
                >
                  {chunks}
                </Link>
              ),
            })}
          </p>
          {customizing && (
            <fieldset className="mt-2 space-y-1">
              <legend className="sr-only">{t("categories")}</legend>
              <div className="flex items-center gap-2">
                <input
                  id="consent-necessary"
                  type="checkbox"
                  checked
                  disabled
                  className="h-4 w-4"
                />
                <label htmlFor="consent-necessary">{t("necessary")}</label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  ref={analyticsRef}
                  id="consent-analytics"
                  type="checkbox"
                  className={`h-4 w-4 ${focusRing}`}
                  checked={analytics}
                  onChange={(e) => setAnalytics(e.target.checked)}
                />
                <label htmlFor="consent-analytics">{t("analytics")}</label>
              </div>
            </fieldset>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {customizing ? (
            <button
              type="button"
              className={`${buttonBase} bg-[#003580] text-white hover:bg-[#002b66]`}
              onClick={() => decide(analytics ? "necessary,analytics" : "necessary")}
            >
              {t("save")}
            </button>
          ) : (
            <button
              type="button"
              className={`${buttonBase} border border-[#003580] text-[#003580] hover:bg-blue-50`}
              onClick={() => setCustomizing(true)}
            >
              {t("customize")}
            </button>
          )}
          <button
            type="button"
            className={`${buttonBase} border border-[#003580] text-[#003580] hover:bg-blue-50`}
            onClick={() => decide("necessary")}
          >
            {t("necessaryOnly")}
          </button>
          <button
            type="button"
            className={`${buttonBase} bg-[#003580] text-white hover:bg-[#002b66]`}
            onClick={() => decide("necessary,analytics")}
          >
            {t("acceptAll")}
          </button>
        </div>
      </div>
    </section>
  );
}
