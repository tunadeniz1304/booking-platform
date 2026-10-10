"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { Button, focusRing } from "@/components/ui/ui";

/**
 * Rota hata sınırı (F51): yerelleştirilmiş başlık, "Tekrar dene" (retry) ve ana sayfa çıkışı.
 * Ekran okuyucuya duyuru için role=alert yerine başlığa odak taşınır.
 */
export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const t = useTranslations("common");
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Sunucu hataları sunucu günlüğüne düşer; istemcide konsol günlüğü yok (observability testi).
  useEffect(() => {
    headingRef.current?.focus();
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <Header />
      <main id="main" className="mx-auto w-full max-w-5xl flex-1 space-y-6 px-4 py-8">
        <div>
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="text-2xl font-bold text-gray-900 focus:outline-none"
          >
            {t("errorPage.title")}
          </h1>
          <p className="mt-1 text-sm text-gray-700">{t("errorPage.description")}</p>
          {error.digest && (
            <p className="mt-2 text-xs text-gray-700">
              {t("errorPage.reference", { digest: error.digest })}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-3">
          <Button onClick={() => retry()} className="min-h-[44px]">
            {t("errorPage.retry")}
          </Button>
          <Link
            href="/"
            className={`inline-flex min-h-[44px] items-center justify-center rounded-md border border-[#003580] bg-white px-4 py-2 text-sm font-semibold text-[#003580] hover:bg-blue-50 ${focusRing}`}
          >
            {t("errorPage.home")}
          </Link>
        </div>
      </main>
      <Footer />
    </div>
  );
}
