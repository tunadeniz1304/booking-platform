"use client";

import type { ReactNode } from "react";

/**
 * F186: çerez bandını mevcut seçimle yeniden açar (CookieConsent'teki COOKIE_CONSENT_OPEN_EVENT).
 * Olay adı burada yazılıdır; CookieConsent içe aktarılırsa CookieConsent → ui → Footer döngüsü oluşur.
 */
export default function FooterCookiePreferencesButton({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={className}
      onClick={() => window.dispatchEvent(new Event("cookie-consent:open"))}
    >
      {children}
    </button>
  );
}
