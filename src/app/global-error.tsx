"use client";

import "../styles/globals.css";

/**
 * Kök layout dahil her şey çöktüğünde gösterilir (F51). Sağlayıcı (next-intl) yok:
 * kısa statik TR + EN metin, "Tekrar dene" ve ana sayfa bağlantısı.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const action =
    "inline-flex min-h-[44px] items-center justify-center rounded-md px-4 py-2 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-[#003580] focus-visible:ring-offset-2";

  return (
    <html lang="tr">
      <head>
        <title>Bir sorun oluştu / Something went wrong — booking-platform</title>
      </head>
      <body>
        <main id="main" className="mx-auto w-full max-w-2xl space-y-6 px-4 py-12">
          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-gray-900">Bir sorun oluştu</h1>
            <p className="text-sm text-gray-700">
              Sayfa yüklenemedi. Lütfen tekrar deneyin ya da ana sayfaya dönün.
            </p>
          </div>
          <div lang="en" className="space-y-2">
            <h2 className="text-lg font-semibold text-gray-900">Something went wrong</h2>
            <p className="text-sm text-gray-700">
              The page could not be loaded. Please try again or go back to the home page.
            </p>
          </div>
          {error.digest && (
            <p className="text-xs text-gray-700">
              Referans kodu / Reference code: <span className="font-mono">{error.digest}</span>
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => retry()}
              className={`${action} bg-[#003580] text-white hover:bg-[#002b66]`}
            >
              Tekrar dene / Try again
            </button>
            {/* Kök layout çöktüğü için istemci yönlendirmesi yerine tam sayfa yükleme. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/"
              className={`${action} border border-[#003580] bg-white text-[#003580] hover:bg-blue-50`}
            >
              Ana sayfa / Home
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
