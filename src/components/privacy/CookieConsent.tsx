"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
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

  if (hasConsent) return null;

  const buttonBase = `rounded-md px-4 py-2 text-sm font-semibold ${focusRing}`;

  return (
    <section
      role="region"
      aria-labelledby="cookie-consent-title"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-gray-300 bg-white p-4 shadow-lg"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="text-sm text-gray-900">
          <h2 id="cookie-consent-title" className="text-base font-semibold">
            Çerez tercihleri
          </h2>
          <p className="mt-1">
            Zorunlu çerezler oturum ve güvenlik için gereklidir. Analitik çerezler yalnızca
            onayınızla kullanılır. Ayrıntılar için{" "}
            <Link href="/privacy" className={`font-semibold text-[#003580] underline ${focusRing}`}>
              aydınlatma metni
            </Link>
            .
          </p>
          {customizing && (
            <fieldset className="mt-2 space-y-1">
              <legend className="sr-only">Çerez kategorileri</legend>
              <div className="flex items-center gap-2">
                <input
                  id="consent-necessary"
                  type="checkbox"
                  checked
                  disabled
                  className="h-4 w-4"
                />
                <label htmlFor="consent-necessary">Zorunlu (her zaman açık)</label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="consent-analytics"
                  type="checkbox"
                  className={`h-4 w-4 ${focusRing}`}
                  checked={analytics}
                  onChange={(e) => setAnalytics(e.target.checked)}
                />
                <label htmlFor="consent-analytics">Analitik</label>
              </div>
            </fieldset>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {customizing ? (
            <button
              type="button"
              className={`${buttonBase} bg-[#003580] text-white hover:bg-[#002b66]`}
              onClick={() => writeConsent(analytics ? "necessary,analytics" : "necessary")}
            >
              Tercihleri kaydet
            </button>
          ) : (
            <button
              type="button"
              className={`${buttonBase} border border-[#003580] text-[#003580] hover:bg-blue-50`}
              aria-expanded={customizing}
              onClick={() => setCustomizing(true)}
            >
              Özelleştir
            </button>
          )}
          <button
            type="button"
            className={`${buttonBase} border border-[#003580] text-[#003580] hover:bg-blue-50`}
            onClick={() => writeConsent("necessary")}
          >
            Yalnızca zorunlu
          </button>
          <button
            type="button"
            className={`${buttonBase} bg-[#003580] text-white hover:bg-[#002b66]`}
            onClick={() => writeConsent("necessary,analytics")}
          >
            Tümünü kabul et
          </button>
        </div>
      </div>
    </section>
  );
}
