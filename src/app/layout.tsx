import type { Metadata } from "next";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
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
  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
