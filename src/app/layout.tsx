import type { Metadata } from "next";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import CookieConsent from "@/components/privacy/CookieConsent";
import { isDemoMode } from "@/lib/config/demo";
import "../styles/globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return { title: t("meta.title"), description: t("meta.description") };
}

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
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
