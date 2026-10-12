"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
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

/** Bandı yeniden açan pencere olayı; tetikleyen kod bu modülü içe aktarmak zorunda değildir. */
export const COOKIE_CONSENT_OPEN_EVENT = "cookie-consent:open";

/**
 * Kayıtlı tercihi silmeden ve sayfayı yenilemeden bandı özelleştirme görünümünde yeniden açar:
 * onay, verildiği kadar kolay geri çekilebilir (KVKK/GDPR). Mevcut seçim önceden işaretli gelir.
 */
export function openCookiePreferences() {
  window.dispatchEvent(new Event(COOKIE_CONSENT_OPEN_EVENT));
}

/**
 * Altbilgi / gizlilik sayfaları için "Çerez tercihlerini değiştir" düğmesi. Sunucu bileşenlerinden
 * de kullanılabilir; görünüm `className` ile, metin istenirse `children` ile verilir.
 */
export function CookiePreferencesTrigger({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  const t = useTranslations("cookie");
  return (
    <button type="button" className={className} onClick={openCookiePreferences}>
      {children ?? t("manage")}
    </button>
  );
}

/**
 * Çerez onay bandı (P2-5): zorunlu çerezler (oturum, güvenlik) her zaman açıktır;
 * analitik çerezler yalnızca açık onayla. Tercih `cookie_consent` çerezinde tutulur.
 * Modal değildir (sayfayı kilitlemez); tüm kontroller klavyeyle kullanılabilir.
 * Görünürken sayfanın altına bant yüksekliği kadar boşluk ve scroll-padding verilir ki
 * Tab ile odaklanan öğeler bandın altında kalmasın (WCAG 2.4.11). Escape = "Yalnızca zorunlu";
 * `openCookiePreferences()` ile yeniden açıldığında Escape tercihi değiştirmeden kapatır.
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
  // Onay verilmişken kullanıcı tercihini değiştirmek için bandı yeniden açtı.
  const [reopened, setReopened] = useState(false);
  const [openCount, setOpenCount] = useState(0);
  const t = useTranslations("cookie");
  const bandRef = useRef<HTMLElement>(null);
  const analyticsRef = useRef<HTMLInputElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const visible = !hasConsent || reopened;

  useEffect(() => {
    const onOpen = () => {
      const active = document.activeElement;
      openerRef.current = active instanceof HTMLElement && active !== document.body ? active : null;
      setAnalytics(readConsent(document.cookie) === "necessary,analytics");
      setReopened(true);
      setCustomizing(true);
      setOpenCount((n) => n + 1);
    };
    window.addEventListener(COOKIE_CONSENT_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(COOKIE_CONSENT_OPEN_EVENT, onOpen);
  }, []);

  useEffect(() => {
    const band = bandRef.current;
    if (!visible || !band) return;
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
  }, [visible]);

  // "Özelleştir" kaybolur ya da bant yeniden açılır; odak ilk seçilebilir kategoriye taşınır.
  useEffect(() => {
    if (customizing) analyticsRef.current?.focus();
  }, [customizing, openCount]);

  if (!visible) return null;

  /**
   * Bant kapanmadan önce odak bandın içindeyse bandı açan düğmeye, o yoksa ana içeriğe taşınır
   * (odak <body>'ye düşmesin).
   */
  const close = () => {
    if (bandRef.current?.contains(document.activeElement)) {
      const opener = openerRef.current;
      const main = document.getElementById("main");
      if (opener?.isConnected) {
        opener.focus();
      } else if (main) {
        if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
        main.focus({ preventScroll: true });
      }
    }
    openerRef.current = null;
    setReopened(false);
    setCustomizing(false);
  };

  const decide = (value: ConsentValue) => {
    close();
    writeConsent(value);
  };

  const privacyLink = (chunks: ReactNode) => (
    <Link href="/privacy" className={`font-semibold text-[#003580] underline ${focusRing}`}>
      {chunks}
    </Link>
  );

  // Mobilde düğmeler tek satırda eşit genişlikte (bant ekranın daha azını kaplar).
  const buttonBase = `flex-1 rounded-md px-3 py-2 text-sm font-semibold sm:flex-none sm:px-4 ${focusRing}`;
  // Kabul ve ret eşit görsel ağırlıkta (EDPB/KVKK: karanlık desen yok).
  const outlineButton = `${buttonBase} border border-[#003580] text-[#003580] hover:bg-blue-50`;

  return (
    <section
      ref={bandRef}
      role="region"
      aria-labelledby="cookie-consent-title"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          if (hasConsent) close();
          else decide("necessary");
        }
      }}
      className="fixed inset-x-0 bottom-0 z-50 max-h-[60vh] overflow-y-auto border-t border-gray-300 bg-white p-4 shadow-lg"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="text-sm text-gray-900">
          <h2 id="cookie-consent-title" className="text-base font-semibold">
            {t("title")}
          </h2>
          <p className="mt-1">
            <span className="sm:hidden">{t.rich("bodyShort", { link: privacyLink })}</span>
            <span className="hidden sm:inline">{t.rich("body", { link: privacyLink })}</span>
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
              <div className="flex items-start gap-2">
                <input
                  ref={analyticsRef}
                  id="consent-analytics"
                  type="checkbox"
                  className={`mt-0.5 h-4 w-4 ${focusRing}`}
                  checked={analytics}
                  aria-describedby="consent-analytics-hint"
                  onChange={(e) => setAnalytics(e.target.checked)}
                />
                <div>
                  <label htmlFor="consent-analytics">{t("analytics")}</label>
                  <p id="consent-analytics-hint" className="text-xs">
                    {t("analyticsHint")}
                  </p>
                </div>
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
            <button type="button" className={outlineButton} onClick={() => setCustomizing(true)}>
              {t("customize")}
            </button>
          )}
          <button type="button" className={outlineButton} onClick={() => decide("necessary")}>
            {t("necessaryOnly")}
          </button>
          {/* Özelleştirmede tek kaydetme yolu kutu durumunu izleyen "Tercihleri kaydet"tir. */}
          {!customizing && (
            <button
              type="button"
              className={outlineButton}
              onClick={() => decide("necessary,analytics")}
            >
              {t("acceptAll")}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
