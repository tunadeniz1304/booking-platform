import type { Metadata } from "next";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import "../styles/globals.css";

export const metadata: Metadata = {
  title: "booking-platform — konaklama arama ve rezervasyon (demo)",
  description:
    "Portföy/demo projesi: konaklama arayın, karşılaştırın ve rezervasyon yapın. Gerçek ödeme alınmaz.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // İstek başına CSP nonce'u (proxy üretir) — Next betiklerine otomatik uygulanır;
  // başlığın okunması sayfaları dinamik render'a zorlar (nonce statik HTML'e gömülemez).
  await headers();
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
