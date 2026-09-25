import type { ReactNode } from "react";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";

/** Kimlik sayfaları (giriş, sıfırlama, doğrulama) için ortak kart düzeni. */
export default function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <Header />
      <main
        id="main"
        className="mx-auto flex w-full max-w-md flex-1 items-center justify-center px-4 py-16"
      >
        <div className="w-full rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
          <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-gray-600">{subtitle}</p>}
          {children}
        </div>
      </main>
      <Footer />
    </div>
  );
}

/** Sonuç / hata mesajı kutusu (ekran okuyucu için canlı bölge). */
export function Notice({ kind, children }: { kind: "error" | "success"; children: ReactNode }) {
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className={`mt-4 rounded-lg px-4 py-3 text-sm ${
        kind === "error" ? "bg-red-50 text-red-700" : "bg-green-50 text-green-800"
      }`}
    >
      {children}
    </div>
  );
}
