import Link from "next/link";
import { getTranslations } from "next-intl/server";

/** Service worker'ın çevrimdışı yedek sayfası (P1-12); JS olmadan da okunur. */
export default async function OfflinePage() {
  const t = await getTranslations("pwa");
  return (
    <main
      id="main"
      className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 px-4"
    >
      <h1 className="text-2xl font-bold text-gray-900">{t("offline.title")}</h1>
      <p className="text-gray-700">{t("offline.body")}</p>
      <Link href="/trips" className="font-semibold text-[#003580] underline">
        {t("trips.title")}
      </Link>
    </main>
  );
}
