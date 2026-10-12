import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { cookies, headers } from "next/headers";
import Link from "next/link";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import SessionExpiredDialog from "@/components/auth/SessionExpiredDialog";
import CookieConsent from "@/components/privacy/CookieConsent";
import ServiceWorkerRegistrar from "@/components/pwa/ServiceWorkerRegistrar";
import { THEME_COLOR } from "@/lib/pwa/manifest";
import { isDemoMode } from "@/lib/config/demo";
import { THEME_COOKIE, resolveTheme, themeAttribute } from "@/lib/ui/theme";
import "../styles/globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return {
    // WCAG 2.4.2: alt segmentler kendi başlığını verir; ana sayfa varsayılanı kullanır.
    title: { default: t("meta.title"), template: `%s — ${t("brand")}` },
    description: t("meta.description"),
    // P1-12 PWA: kurulabilir uygulama bildirimi + ikonlar.
    manifest: "/manifest.webmanifest",
    icons: {
      icon: [{ url: "/icons/icon.svg", type: "image/svg+xml" }],
      apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
    },
    appleWebApp: { capable: true, title: t("brand"), statusBarStyle: "default" },
  };
}

// P2-1a: tarayıcı denetimleri (kaydırma çubuğu, form) iki temayı da desteklesin.
export const viewport: Viewport = { themeColor: THEME_COLOR, colorScheme: "light dark" };

export default async function RootLayout({ children }: { children: ReactNode }) {
  // İstek başına CSP nonce'u (proxy üretir) — başlığın okunması sayfaları dinamik render'a zorlar.
  await headers();
  const locale = await getLocale();
  const messages = await getMessages();
  const demo = isDemoMode();
  const t = await getTranslations("common");
  const tNav = await getTranslations("nav");
  // Tema tercihi çerezden: sistem → öznitelik yok (medya sorgusu), light/dark → data-theme.
  const theme = themeAttribute(resolveTheme((await cookies()).get(THEME_COOKIE)?.value));
  return (
    <html lang={locale} data-demo={demo ? "true" : "false"} data-theme={theme}>
      <body>
        {/* WCAG 2.4.1: her sayfada ilk odaklanabilir öğe "İçeriğe geç" bağlantısı. */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[60] focus:rounded focus:bg-white focus:px-3 focus:py-2 focus:text-brand focus:ring-2 focus:ring-brand"
        >
          {tNav("skipToContent")}
        </a>
        {demo && (
          // Kalıcı DEMO şeridi (v4#5): kaydırmada da üstte kalır, kapatılamaz. Landmark içinde
          // (axe region); dar ekranda kısa metin, şerit tek satırda kalır.
          <aside
            aria-label={t("demo.ariaLabel")}
            data-testid="demo-ribbon"
            className="sticky top-0 z-50 bg-[#febb02] px-4 py-1 text-center text-xs font-semibold text-black"
          >
            <span className="mr-2 rounded bg-black px-1.5 py-0.5 text-xs tracking-wider text-[#febb02]">
              {t("demo.tag")}
            </span>
            <span className="sm:hidden">{t("demo.bannerShort")}</span>
            <span className="hidden sm:inline">{t("demo.banner")}</span>
            {/* Doğrulama/sıfırlama e-postaları demo posta kutusunda; herkes için tek giriş noktası. */}
            <Link
              href="/dev/mailbox"
              className="ml-2 whitespace-nowrap underline focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-1"
            >
              {tNav("mailbox")}
            </Link>
          </aside>
        )}
        <NextIntlClientProvider locale={locale} messages={messages}>
          {/* Çerez bandı görsel olarak altta (fixed) ama sekme sırasında içerikten önce gelir. */}
          <CookieConsent />
          {children}
          <SessionExpiredDialog />
          <ServiceWorkerRegistrar />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
