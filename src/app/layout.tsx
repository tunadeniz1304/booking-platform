import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import CookieConsent from "@/components/privacy/CookieConsent";
import ServiceWorkerRegistrar from "@/components/pwa/ServiceWorkerRegistrar";
import { THEME_COLOR } from "@/lib/pwa/manifest";
import { isDemoMode } from "@/lib/config/demo";
import "../styles/globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return {
    title: t("meta.title"),
    description: t("meta.description"),
    // P1-12 PWA: kurulabilir uygulama bildirimi + ikonlar.
    manifest: "/manifest.webmanifest",
    icons: {
      icon: [{ url: "/icons/icon.svg", type: "image/svg+xml" }],
      apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
    },
    appleWebApp: { capable: true, title: "Booking", statusBarStyle: "default" },
  };
}

export const viewport: Viewport = { themeColor: THEME_COLOR };

export default async function RootLayout({ children }: { children: ReactNode }) {
  // İstek başına CSP nonce'u (proxy üretir) — başlığın okunması sayfaları dinamik render'a zorlar.
  await headers();
  const locale = await getLocale();
  const messages = await getMessages();
  const demo = isDemoMode();
  const t = await getTranslations("common");
  return (
    <html lang={locale} data-demo={demo ? "true" : "false"}>
      <body>
        {demo && (
          // Kalıcı DEMO şeridi (v4#5): kaydırmada da üstte kalır, kapatılamaz.
          <div
            role="note"
            aria-label={t("demo.ariaLabel")}
            data-testid="demo-ribbon"
            className="sticky top-0 z-50 bg-[#febb02] px-4 py-1 text-center text-xs font-semibold text-gray-900"
          >
            <span className="mr-2 rounded bg-gray-900 px-1.5 py-0.5 text-[10px] tracking-wider text-[#febb02]">
              {t("demo.tag")}
            </span>
            {t("demo.banner")}
          </div>
        )}
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
          <CookieConsent />
          <ServiceWorkerRegistrar />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
