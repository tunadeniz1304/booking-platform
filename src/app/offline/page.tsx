import Link from "next/link";
import { getTranslations } from "next-intl/server";
import OfflineReloadOnReconnect from "@/components/pwa/OfflineReloadOnReconnect";

// Sunucu bileşeni: ui.tsx ("use client") sabitleri burada dize olarak kullanılamaz.
const focusRing =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-[#003580] focus-visible:ring-offset-2";
const linkClass = `inline-flex min-h-[44px] items-center font-semibold text-[#003580] underline ${focusRing}`;

/** Service worker'ın çevrimdışı yedek sayfası (P1-12); JS olmadan da okunur. */
export default async function OfflinePage() {
  const t = await getTranslations("pwa");
  return (
    <>
      <header className="mx-auto w-full max-w-xl px-4 pt-6">
        <Link
          href="/"
          className={`inline-flex min-h-[44px] items-center rounded-sm text-xl font-bold tracking-tight text-[#003580] ${focusRing}`}
        >
          {t("manifest.shortName")}
        </Link>
      </header>
      <main id="main" className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 py-8 sm:py-12">
        <h1 className="text-2xl font-bold text-gray-900">{t("offline.title")}</h1>
        <p className="text-gray-700">{t("offline.body")}</p>
        <p className="text-gray-700">{t("offline.reconnect")}</p>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          {/* Boş href geçerli adresi yeniden ister; JS olmadan da çalışır. */}
          <a
            href=""
            className={`inline-flex min-h-[44px] items-center justify-center rounded-md bg-[#003580] px-4 py-2 text-sm font-semibold text-white hover:bg-[#002b66] ${focusRing}`}
          >
            {t("offline.retry")}
          </a>
          <Link href="/trips" className={linkClass}>
            {t("trips.title")}
          </Link>
          <Link href="/" className={linkClass}>
            {t("offline.home")}
          </Link>
        </div>
        <OfflineReloadOnReconnect />
      </main>
    </>
  );
}
