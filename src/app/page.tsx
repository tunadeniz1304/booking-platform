import Link from "next/link";
import Image from "next/image";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import SearchBar from "@/components/search/SearchBar";
import PropertyCard from "@/components/property/PropertyCard";
import { getTranslations } from "next-intl/server";
import { getPopularProperties } from "@/lib/search";
import { logger, errorFields } from "@/lib/observability/logger";

export const dynamic = "force-dynamic";

const popularDestinations = [
  {
    city: "İstanbul",
    country: "Türkiye",
    imageUrl: "https://images.unsplash.com/photo-1541432901042-2d8bd64b4a9b?w=400&h=300&fit=crop",
  },
  {
    city: "Antalya",
    country: "Türkiye",
    imageUrl: "https://images.unsplash.com/photo-1587329310686-91414b8e3cb7?w=400&h=300&fit=crop",
  },
  {
    city: "Kapadokya",
    country: "Türkiye",
    imageUrl: "https://images.unsplash.com/photo-1539776185620-1c12f6a4090f?w=400&h=300&fit=crop",
  },
  {
    city: "Bodrum",
    country: "Türkiye",
    imageUrl: "https://images.unsplash.com/photo-1587061949409-02df41d5e562?w=400&h=300&fit=crop",
  },
];

/** Mülk türü → `search.types.*` çeviri anahtarı (arama sayfasıyla aynı eşleme). */
const TYPE_KEYS: Record<string, string> = {
  HOTEL: "hotel",
  APARTMENT: "apartment",
  VILLA: "villa",
  HOSTEL: "hostel",
  BED_AND_BREAKFAST: "bedAndBreakfast",
};

export default async function HomePage() {
  // Öne çıkanlar sorgusu başarısız olsa da arama formu kullanılabilir kalmalı.
  const popular = await getPopularProperties(6).catch((error: unknown) => {
    logger.error(errorFields(error), "home popular properties failed");
    return null;
  });
  const t = await getTranslations("home");
  const tSearch = await getTranslations("search");
  const typeLabel = (type: string) =>
    TYPE_KEYS[type] ? tSearch(`types.${TYPE_KEYS[type]}`) : type;

  return (
    <div className="min-h-screen bg-white">
      <Header />
      <main id="main">
        <section className="bg-[#003580] pb-16 pt-8">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <h1 className="text-3xl font-bold text-white sm:text-4xl">{t("title")}</h1>
            <p className="mt-2 text-white/80">{t("subtitle")}</p>
            <div className="mt-8">
              <SearchBar />
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <h2 className="text-2xl font-bold text-gray-900">{t("popularDestinations")}</h2>
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {popularDestinations.map((dest) => (
              <Link
                key={dest.city}
                href={`/search?destination=${encodeURIComponent(dest.city)}`}
                className="group relative overflow-hidden rounded-lg"
              >
                <div className="relative h-48 w-full">
                  <Image
                    src={dest.imageUrl}
                    alt={dest.city}
                    fill
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
                    className="object-cover transition duration-300 group-hover:scale-105"
                  />
                </div>
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                <div className="absolute bottom-0 p-4 text-white">
                  <h3 className="text-lg font-semibold">{dest.city}</h3>
                  <p className="text-sm text-white/80">{dest.country}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 pb-16 sm:px-6 lg:px-8">
          <h2 className="text-2xl font-bold text-gray-900">{t("featured")}</h2>
          {popular === null ? (
            <div className="mt-6 rounded-lg bg-gray-50 p-12 text-center">
              <p role="status" className="text-gray-500">
                {t("featuredError")}
              </p>
              <Link
                href="/"
                className="mt-3 inline-flex min-h-[44px] items-center rounded-sm px-2 font-semibold underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#003580] focus-visible:ring-offset-2"
              >
                {t("retry")}
              </Link>
            </div>
          ) : popular.length > 0 ? (
            <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {popular.map((property) => (
                <PropertyCard
                  key={property.id}
                  id={property.id}
                  title={property.title}
                  location={`${property.location.city}, ${property.location.country}`}
                  imageUrl={
                    property.images?.[0] ??
                    "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=600&h=400&fit=crop"
                  }
                  priceMinor={property.basePriceMinor}
                  currency={property.currency}
                  rating={property.ratingAvg}
                  reviewCount={property.ratingCount}
                  propertyType={typeLabel(property.propertyType)}
                />
              ))}
            </div>
          ) : (
            <div className="mt-6 rounded-lg bg-gray-50 p-12 text-center">
              <p className="text-gray-500">{t("empty")}</p>
            </div>
          )}
        </section>
      </main>
      <Footer />
    </div>
  );
}
