import { getTranslations } from "next-intl/server";
import Header from "@/components/layout/Header";

// F915: yavaş ağda ilan açılırken iskelet (başlık, 16:9 galeri, rezervasyon formu) ve
// ekran okuyucu duyurusu. Hareket azaltma tercihinde nabız animasyonu kapalı. F400: `main`'e
// aria-busy verilmez; bazı ekran okuyucular meşgul alt ağaçtaki durum duyurusunu bastırır.
const block = "rounded-lg bg-gray-200 motion-safe:animate-pulse";

export default async function PropertyLoading() {
  const t = await getTranslations("property");
  return (
    <div className="min-h-screen bg-white">
      <Header />
      <main id="main" className="mx-auto max-w-7xl px-4 py-8">
        <p role="status" className="sr-only">
          {t("loading")}
        </p>
        <div aria-hidden="true">
          <div className={`h-4 w-48 ${block}`} />
          <div className={`mt-6 h-4 w-32 ${block}`} />
          <div className={`mt-2 h-9 w-3/4 max-w-xl ${block}`} />
          <div className={`mt-3 h-6 w-40 ${block}`} />
          <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-3">
            <div className={`aspect-video lg:col-span-2 ${block}`} />
            <div className={`h-96 ${block}`} />
          </div>
        </div>
      </main>
    </div>
  );
}
