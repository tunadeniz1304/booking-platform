/**
 * Popüler destinasyonların tek kaynağı: ana sayfa kartları ilk `HOME_POPULAR_COUNT` tanesini,
 * "Nereye?" öneri listesi tamamını aynı sırayla gösterir. `city`/`country` veritabanındaki
 * (Türkçe) adlardır: aramada aynen kullanılır, ekranda `@/lib/i18n/place-display-names`
 * yardımcılarıyla dile göre çevrilir.
 */
export interface PopularDestination {
  city: string;
  country: string;
  /** Destinasyonu gerçekten gösteren doğrulanmış fotoğraf; yoksa `null` (nötr yer tutucu). */
  imageUrl: string | null;
}

export const POPULAR_DESTINATIONS: readonly PopularDestination[] = [
  {
    city: "İstanbul",
    country: "Türkiye",
    imageUrl: "https://images.unsplash.com/photo-1541432901042-2d8bd64b4a9b?w=400&h=300&fit=crop",
  },
  { city: "Antalya", country: "Türkiye", imageUrl: null },
  { city: "Kapadokya", country: "Türkiye", imageUrl: null },
  { city: "Bodrum", country: "Türkiye", imageUrl: null },
  { city: "Paris", country: "Fransa", imageUrl: null },
  { city: "Roma", country: "İtalya", imageUrl: null },
  { city: "Barselona", country: "İspanya", imageUrl: null },
  { city: "Dubai", country: "BAE", imageUrl: null },
];

/** Ana sayfada kart olarak gösterilen popüler destinasyon sayısı. */
export const HOME_POPULAR_COUNT = 4;
