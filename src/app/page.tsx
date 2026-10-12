import { Suspense } from "react";
import Link from "next/link";
import { cookies, headers } from "next/headers";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import SearchBar from "@/components/search/SearchBar";
import DestinationCardImage from "@/components/home/DestinationCardImage";
import HomeDestinationLink from "@/components/home/HomeDestinationLink";
import HomeFeaturedCard from "@/components/home/HomeFeaturedCard";
import { getLocale, getTranslations } from "next-intl/server";
import { getPopularProperties } from "@/lib/search";
import { getAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { propertyTypeKey } from "@/lib/i18n/property-type";
import { localizeCountryName, placeCityKey } from "@/lib/i18n/place-display-names";
import { logger, errorFields } from "@/lib/observability/logger";

export const dynamic = "force-dynamic";

const FEATURED_COUNT = 6;

/**
 * `city`/`country` veritabanındaki (Türkçe) adlardır: arama bağlantısında aynen kullanılır, ekranda
 * dile göre çevrilir. `imageUrl` yalnızca destinasyonu gerçekten gösteren bir fotoğraf olabilir;
 * doğrulanmış fotoğraf yoksa `null` kalır ve kartta nötr yer tutucu çizilir.
 */
const popularDestinations: ReadonlyArray<{
  city: string;
  country: string;
  imageUrl: string | null;
}> = [
  {
    city: "İstanbul",
    country: "Türkiye",
    imageUrl: "https://images.unsplash.com/photo-1541432901042-2d8bd64b4a9b?w=400&h=300&fit=crop",
  },
  { city: "Antalya", country: "Türkiye", imageUrl: null },
  { city: "Kapadokya", country: "Türkiye", imageUrl: null },
  { city: "Bodrum", country: "Türkiye", imageUrl: null },
];

interface HomeViewer {
  /** Oturum açmış kullanıcının rolü; oturum yoksa ya da okunamazsa `null`. */
  role: string | null;
  /** Favori ilan id'leri; oturum yoksa ya da okunamazsa boş küme. */
  favoriteIds: ReadonlySet<string>;
}

async function loadViewer(): Promise<HomeViewer> {
  let role: string | null = null;
  try {
    const [headerList, cookieStore] = await Promise.all([headers(), cookies()]);
    const claims = await getAuth({ headers: headerList, cookies: cookieStore });
    if (!claims) return { role, favoriteIds: new Set() };
    role = claims.role;
    const rows = await prisma.favorite.findMany({
      where: { userId: claims.userId },
      select: { propertyId: true },
    });
    return { role, favoriteIds: new Set(rows.map((row) => row.propertyId)) };
  } catch (error) {
    logger.warn(errorFields(error), "home favorite ids failed");
    return { role, favoriteIds: new Set() };
  }
}

const homeLinkClass =
  "inline-flex min-h-[44px] items-center rounded-sm px-2 font-semibold underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#003580] focus-visible:ring-offset-2";

function FeaturedSkeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true" className="mt-6">
      <p role="status" className="sr-only">
        {label}
      </p>
      <div aria-hidden="true" className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: FEATURED_COUNT }, (_, index) => (
          <div
            key={index}
            className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm"
          >
            <div className="h-48 bg-gray-100 motion-safe:animate-pulse" />
            <div className="space-y-3 p-4">
              <div className="h-4 w-3/4 rounded-sm bg-gray-100 motion-safe:animate-pulse" />
              <div className="h-3 w-1/2 rounded-sm bg-gray-100 motion-safe:animate-pulse" />
              <div className="h-6 w-1/3 rounded-sm bg-gray-100 motion-safe:animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

async function FeaturedProperties() {
  const [popular, viewer, t, tSearch, locale] = await Promise.all([
    // Öne çıkanlar sorgusu başarısız olsa da arama formu kullanılabilir kalmalı.
    getPopularProperties(FEATURED_COUNT).catch((error: unknown) => {
      logger.error(errorFields(error), "home popular properties failed");
      return null;
    }),
    loadViewer(),
    getTranslations("home"),
    getTranslations("search"),
    getLocale(),
  ]);
  const typeLabel = (type: string) => {
    const key = propertyTypeKey(type);
    return key ? tSearch(`types.${key}`) : type;
  };
  const cityName = (city: string) => {
    const key = placeCityKey(city);
    return key ? t(`places.${key}`) : city;
  };
  const locationLabel = (city: string, country: string) =>
    `${cityName(city)}, ${localizeCountryName(country, locale)}`;

  if (popular === null) {
    return (
      <div className="mt-6 rounded-lg bg-gray-50 p-12 text-center">
        <p role="status" className="text-gray-500">
          {t("featuredError")}
        </p>
        <Link href="/" className={`mt-3 ${homeLinkClass}`}>
          {t("retry")}
        </Link>
      </div>
    );
  }

  if (popular.length === 0) {
    return (
      <div className="mt-6 rounded-lg bg-gray-50 p-12 text-center">
        <p className="text-gray-500">{t("empty")}</p>
        {/* Boş katalogda bir sonraki adım: aramaya geç ya da ev sahibiyse ilan oluştur (F1285). */}
        <div className="mt-3 flex flex-wrap justify-center gap-x-4">
          <Link href="/search" className={homeLinkClass}>
            {t("emptySearch")}
          </Link>
          {viewer.role === "HOST" || viewer.role === "ADMIN" ? (
            <Link href="/host" className={homeLinkClass}>
              {t("emptyCreateListing")}
            </Link>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {popular.map((property) => (
        <HomeFeaturedCard
          key={property.id}
          id={property.id}
          title={property.title}
          location={locationLabel(property.location.city, property.location.country)}
          imageUrl={property.images?.[0] ?? null}
          priceMinor={property.basePriceMinor}
          currency={property.currency}
          rating={property.ratingAvg}
          reviewCount={property.ratingCount}
          propertyType={typeLabel(property.propertyType)}
          initialFavorite={viewer.favoriteIds.has(property.id)}
        />
      ))}
    </div>
  );
}

export default async function HomePage() {
  const [t, tFooter, locale] = await Promise.all([
    getTranslations("home"),
    getTranslations("footer"),
    getLocale(),
  ]);
  const cityName = (city: string) => {
    const key = placeCityKey(city);
    return key ? t(`places.${key}`) : city;
  };

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
          {/* Mobilde iki sütun ve alçak kart: öne çıkanlara uzun kaydırma gerekmesin (F1120). */}
          <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {popularDestinations.map((dest) => {
              const city = cityName(dest.city);
              const country = localizeCountryName(dest.country, locale);
              return (
                <HomeDestinationLink
                  key={dest.city}
                  destination={dest.city}
                  aria-label={t("destinationLinkLabel", { city, country })}
                  className="group relative overflow-hidden rounded-lg"
                >
                  {/* Görsel yüklenirken ya da yüklenemezse kutu boş beyaz görünmesin (F1283). */}
                  <div className="relative h-32 w-full bg-gray-100 sm:h-48">
                    <DestinationCardImage
                      src={dest.imageUrl}
                      sizes="(max-width: 1024px) 50vw, 25vw"
                    />
                  </div>
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                  <div className="absolute bottom-0 p-3 text-white sm:p-4">
                    <h3 className="text-base font-semibold sm:text-lg">{city}</h3>
                    <p className="text-sm text-white/80">{country}</p>
                  </div>
                </HomeDestinationLink>
              );
            })}
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 pb-16 sm:px-6 lg:px-8">
          <h2 className="text-2xl font-bold text-gray-900">{t("featured")}</h2>
          {/* Seçim ölçütü açık: liste yalnız misafir puanına göre sıralanır (F1284). */}
          <p className="mt-1 text-sm text-gray-600">
            {t("featuredHint")}{" "}
            <Link
              href="/ranking"
              className="rounded-sm font-semibold underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#003580] focus-visible:ring-offset-2"
            >
              {tFooter("ranking")}
            </Link>
          </p>
          {/* Öne çıkanlar akışla gelir: hero ve arama formu sorguyu beklemeden gönderilir. */}
          <Suspense fallback={<FeaturedSkeleton label={t("featuredLoading")} />}>
            <FeaturedProperties />
          </Suspense>
        </section>
      </main>
      <Footer />
    </div>
  );
}
