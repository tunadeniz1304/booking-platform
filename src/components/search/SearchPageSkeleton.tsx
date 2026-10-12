import Header from "@/components/layout/Header";

// F966/F976: arama sayfası iskeletleri. Yerleşim sayfayla aynı (başlık kutusu, filtre paneli,
// sonuç ızgarası), içerik gelince düzen kaymaz. Hook kullanmaz: hem rota yükleme ekranında
// (sunucu) hem sayfanın Suspense yedeğinde (istemci) kullanılır. Hareket azaltma tercihinde
// nabız animasyonu kapalı.
const bar = "rounded-sm bg-gray-200 motion-safe:animate-pulse";

/** Sonuç kartı iskeletleri (görsel; yükleme durumu metinle ayrıca bildirilir). */
export function SearchResultSkeletons({ count = 6 }: { count?: number }) {
  return (
    <ul aria-hidden="true" className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: count }, (_, i) => (
        <li
          key={i}
          className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm"
        >
          <div className="h-48 bg-gray-200 motion-safe:animate-pulse" />
          <div className="space-y-2 p-4">
            <div className={`h-4 w-3/4 ${bar}`} />
            <div className={`h-3 w-1/2 ${bar}`} />
            <div className={`h-6 w-1/3 ${bar}`} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Tam sayfa iskeleti: Header + sayfa düzeni. `label` ("Yükleniyor…") ekran okuyucuya durum
 * olarak duyurulur; `main` aria-busy almaz (bazı ekran okuyucular durum duyurusunu bastırır).
 */
export function SearchPageSkeleton({ label }: { label: string }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main id="main" className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <p role="status" className="sr-only">
          {label}
        </p>
        <div aria-hidden="true">
          <div className="mb-6 rounded-lg bg-white p-4 shadow-sm">
            <div className={`h-7 w-64 max-w-full ${bar}`} />
            <div className={`mt-2 h-4 w-48 max-w-full ${bar}`} />
            <div className={`mt-3 h-4 w-32 ${bar}`} />
          </div>
          <div className="mb-6 rounded-lg bg-white p-4 shadow-sm">
            <div className={`h-10 w-full ${bar}`} />
          </div>
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-4">
            <div>
              <div className={`h-11 w-full lg:hidden ${bar}`} />
              <div className="hidden space-y-3 rounded-lg bg-white p-4 shadow-sm lg:block">
                <div className={`h-5 w-24 ${bar}`} />
                <div className={`h-8 w-full ${bar}`} />
                <div className={`h-4 w-3/4 ${bar}`} />
                <div className={`h-4 w-2/3 ${bar}`} />
                <div className={`h-4 w-3/4 ${bar}`} />
                <div className={`h-8 w-full ${bar}`} />
              </div>
            </div>
            <div className="lg:col-span-3">
              <div className={`mb-4 h-5 w-48 ${bar}`} />
              <SearchResultSkeletons />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
