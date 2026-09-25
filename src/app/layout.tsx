import type { Metadata } from "next";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import CookieConsent from "@/components/privacy/CookieConsent";
import { isDemoMode } from "@/lib/config/demo";
import "../styles/globals.css";

export const metadata: Metadata = {
  title: "booking-platform — konaklama arama ve rezervasyon (demo)",
  description:
    "Portföy/demo projesi: konaklama arayın, karşılaştırın ve rezervasyon yapın. Gerçek ödeme alınmaz.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // İstek başına CSP nonce'u (proxy üretir) — başlığın okunması sayfaları dinamik render'a zorlar.
  await headers();
  const locale = await getLocale();
  const messages = await getMessages();
  const demo = isDemoMode();
  return (
    <html lang={locale} data-demo={demo ? "true" : "false"}>
      <body>
        {demo && (
          <div
            role="note"
            className="bg-[#febb02] px-4 py-1 text-center text-xs font-semibold text-gray-900"
          >
            <span className="mr-2 rounded bg-gray-900 px-1.5 py-0.5 text-[10px] tracking-wider text-[#febb02]">
              DEMO
            </span>
            {locale === "en"
              ? "Demo environment — no real payments are taken, no real stays are sold."
              : "Demo ortamı — gerçek ödeme alınmaz, gerçek konaklama satılmaz."}
          </div>
        )}
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
          <CookieConsent />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
