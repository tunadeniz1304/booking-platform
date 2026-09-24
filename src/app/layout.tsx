import type { Metadata } from "next";
import type { ReactNode } from "react";
import "../styles/globals.css";

export const metadata: Metadata = {
  title: "Booking.com | Oteller, Evler ve Çok Daha Fazlası",
  description:
    "Konaklama arayın, karşılaştırın ve rezervasyon yapın. Oteller, daireler, villalar ve daha fazlası.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
