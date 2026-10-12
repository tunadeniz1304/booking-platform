import type { Metadata } from "next";
import { cache } from "react";
import { minorFromDb } from "@/lib/money/money";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { marketRulesFor } from "@/lib/compliance/market-rules";
import { LISTABLE_PROPERTY } from "@/lib/compliance/listing";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import PropertyGallery from "@/components/property/PropertyGallery";
import BookingWidget, { BookingWidgetRoom } from "@/components/booking/BookingWidget";
import ReviewsSection from "@/components/property/ReviewsSection";
import AccessibilitySection from "@/components/property/AccessibilitySection";
import PropertyDetailActions from "@/components/property/PropertyDetailActions";
import RatingBadge from "@/components/property/RatingBadge";
import { listPublicFeatures } from "@/lib/compliance/accessibility";
import PriceCalendar from "@/components/property/PriceCalendar";
import { toSnapshot, type PolicySnapshot } from "@/lib/booking/cancellation";

interface PropertyPageProps {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

// ui.tsx "use client" modülü; sunucu bileşeninde aynı focusRing sınıfları yerel kopya.
const focusRing =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-[#003580] focus-visible:ring-offset-2";

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

/** Sorgu parametresinden en az `min` olan tam sayı; geçersizse undefined. */
const toCount = (v: string | string[] | undefined, min: number) => {
  const n = Math.floor(Number(one(v)));
  return Number.isFinite(n) && n >= min ? n : undefined;
};

// F921: yapışkan DEMO şeridi (≈26px) varken çapa hedefleri ve rezervasyon kutusu altında kalmasın.
const anchorOffset = "scroll-mt-6 [[data-demo=true]_&]:scroll-mt-12";

interface PropertyDetail {
  id: string;
  title: string;
  description: string;
  propertyType: string;
  location: { city: string; country: string };
  licenseNumber: string | null;
  basePriceMinor: number;
  currency: string;
  ratingAvg: number;
  ratingCount: number;
  amenities: { name: string; icon: string | null }[];
  images: string[];
  rooms: BookingWidgetRoom[];
  timeZone: string;
  checkInTime: string;
  checkOutTime: string;
  cancellationPolicy: { kind: string; version: number; rules: unknown } | null;
}

async function loadProperty(id: string): Promise<PropertyDetail | null> {
  const property = await prisma.property.findFirst({
    where: { id, ...LISTABLE_PROPERTY },
    select: {
      id: true,
      title: true,
      description: true,
      propertyType: true,
      licenseNumber: true,
      basePriceMinor: true,
      currency: true,
      ratingAvg: true,
      ratingCount: true,
      images: true,
      timeZone: true,
      checkInTime: true,
      checkOutTime: true,
      cancellationPolicy: { select: { kind: true, version: true, rules: true } },
      location: { select: { city: true, country: true } },
      amenities: { select: { name: true, icon: true } },
      rooms: {
        select: {
          id: true,
          name: true,
          description: true,
          maxOccupancy: true,
          units: true,
          ratePlans: {
            where: { active: true },
            select: {
              id: true,
              name: true,
              mealPlan: true,
              refundable: true,
              priceModifierBps: true,
              isDefault: true,
            },
            orderBy: { priceModifierBps: "asc" },
          },
          bedType: true,
          priceModifierMinor: true,
          available: true,
        },
        orderBy: { name: "asc" },
      },
    },
  });
  if (!property) return null;

  return {
    ...property,
    basePriceMinor: minorFromDb(property.basePriceMinor),
    rooms: property.rooms.map((room) => ({
      ...room,
      capacity: room.maxOccupancy,
      priceModifierMinor: minorFromDb(room.priceModifierMinor),
    })),
  };
}

// F915: generateMetadata ve sayfa aynı istekte tek ilan sorgusunu paylaşır.
const getProperty = cache(loadProperty);

export async function generateMetadata({ params }: PropertyPageProps): Promise<Metadata> {
  const { id } = await params;
  const property = await getProperty(id);
  const t = await getTranslations("property");
  return {
    title: property ? t("metaTitle", { title: property.title }) : t("notFoundTitle"),
  };
}

export default async function PropertyPage({ params, searchParams }: PropertyPageProps) {
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  // F364: arama/sepetle aynı misafir modeli (yetişkin + çocuk); yalnız `guests` varsa
  // yetişkin sayısı odur. `guests` her zaman toplamdır.
  const adults = toCount(sp.adults, 1) ?? toCount(sp.guests, 1);
  const children = toCount(sp.children, 0);
  const initial = {
    checkIn: one(sp.checkIn),
    checkOut: one(sp.checkOut),
    guests: adults !== undefined ? adults + (children ?? 0) : undefined,
    adults,
    children,
    roomId: one(sp.roomId),
    ratePlanId: one(sp.ratePlanId),
  };
  const [property, t, tc, ta] = await Promise.all([
    getProperty(id),
    getTranslations("property"),
    getTranslations("compliance.report"),
    getTranslations("compliance.accessibility"),
  ]);

  if (!property) {
    notFound();
  }
  // P1-13(e): yalnız doğrulanmış erişilebilirlik özellikleri. Başlıktaki puan, aşağıda
  // listelenen yayımlanmış yorumlarla tutarlı olsun (F132). İki sorgu paralel (F915).
  const [accessibility, ratingAgg] = await Promise.all([
    listPublicFeatures(property.id),
    prisma.review.aggregate({
      where: { propertyId: property.id, moderationStatus: "PUBLISHED" },
      _avg: { rating: true },
      _count: { _all: true },
    }),
  ]);
  const reviewCount = ratingAgg._count._all;
  const reviewAvg = ratingAgg._avg.rating ?? 0;
  // P1-7: kayıt no gösterimi ve toplam fiyat notu tesis pazarının kuralından.
  const market = marketRulesFor(property.location.country);
  const registrationLabel =
    market.registration.scheme === "tr-7464"
      ? t("registration.trPermit")
      : market.registration.scheme === "eu-2024-1028"
        ? t("registration.euRegistration")
        : t("registration.platform");

  // İptal politikası (atanmamışsa varsayılan); kurallar okunamazsa bölüm yalnız saatleri gösterir.
  let policy: PolicySnapshot | null;
  try {
    policy = toSnapshot(property.cancellationPolicy);
  } catch {
    policy = null;
  }
  const tiers = policy ? [...policy.rules.tiers].sort((a, b) => b.hoursBefore - a.hoursBefore) : [];
  const tierText = (tier: { hoursBefore: number; refundPercent: number }) => {
    const percent = tier.refundPercent;
    if (tiers.length === 1) return t("policies.tierAny", { percent });
    if (tier.hoursBefore <= 0) return t("policies.tierLater", { percent });
    if (tier.hoursBefore % 24 === 0) {
      return t("policies.tierDays", { days: tier.hoursBefore / 24, percent });
    }
    return t("policies.tierHours", { hours: tier.hoursBefore, percent });
  };
  // F918: kırıntıdaki şehir araması tarih/misafir bağlamını korur. `from` önceki aramanın
  // sorgu dizgesidir; yol sabit (/search), açık yönlendirme yok.
  const cityParams = new URLSearchParams({ destination: property.location.city });
  if (initial.checkIn && initial.checkOut) {
    cityParams.set("checkIn", initial.checkIn);
    cityParams.set("checkOut", initial.checkOut);
  }
  if (initial.guests) cityParams.set("guests", String(initial.guests));
  const from = one(sp.from);
  const fromQuery = from ? new URLSearchParams(from.slice(from.indexOf("?") + 1)).toString() : "";
  const crumbLink = `inline-flex min-h-[44px] items-center underline hover:text-[#003580] sm:min-h-0 ${focusRing}`;

  const amenityName = (amenity: { name: string; icon: string | null }) =>
    amenity.icon && t.has(`amenityNames.${amenity.icon}`)
      ? t(`amenityNames.${amenity.icon}`)
      : null;

  // F321: Destek bağlantısı konuyu ve ilanı ön doldurur (AccessibilitySection ile aynı sorgu).
  const supportQuery = new URLSearchParams({
    topic: "accessibility",
    propertyId: property.id,
    propertyTitle: property.title,
  });
  const accessibilitySupportHref = `/support?${supportQuery.toString()}`;

  // F1328: uzun sayfada bölüm içi gezinme; sıra mobildeki sayfa sırasıyla aynı.
  const sectionLinks: { href: string; label: string }[] = [
    { href: "#booking", label: t("sectionNav.booking") },
    { href: "#policies", label: t("sectionNav.policies") },
    ...(property.amenities.length > 0 ? [{ href: "#amenities-title", label: t("amenities") }] : []),
    { href: "#accessibility-title", label: ta("title") },
    { href: "#price-calendar-title", label: t("sectionNav.prices") },
    { href: "#reviews-title", label: t("sectionNav.reviews") },
  ];

  return (
    <div className="min-h-screen bg-white">
      <Header />
      <main
        id="main"
        className="mx-auto max-w-7xl px-4 py-8 [&_h2[id]]:scroll-mt-6 [[data-demo=true]_&_h2[id]]:scroll-mt-12"
      >
        <nav aria-label={t("breadcrumb.label")} className="mb-4 text-sm text-gray-600">
          {fromQuery && (
            <p className="mb-1">
              <Link href={`/search?${fromQuery}`} className={crumbLink}>
                <span aria-hidden="true">←&nbsp;</span>
                {t("breadcrumb.backToResults")}
              </Link>
            </p>
          )}
          <ol className="flex flex-wrap items-center gap-x-2">
            <li>
              <Link href="/" className={crumbLink}>
                {t("breadcrumb.home")}
              </Link>
            </li>
            <li className="flex items-center gap-x-2">
              <span aria-hidden="true">›</span>
              <Link href={`/search?${cityParams.toString()}`} className={crumbLink}>
                {t("breadcrumb.cityStays", { city: property.location.city })}
              </Link>
            </li>
            <li className="flex min-w-0 max-w-full items-center gap-x-2">
              <span aria-hidden="true">›</span>
              <span aria-current="page" className="truncate text-gray-900">
                {property.title}
              </span>
            </li>
          </ol>
        </nav>
        <div className="mb-6">
          <p className="text-sm text-gray-500">
            {property.location.city}, {property.location.country}
          </p>
          <h1 className="mt-1 text-3xl font-bold text-gray-900">{property.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            {reviewCount > 0 ? (
              // F920/F1132: görünür "4,5/5" + ekran okuyucuya "5 üzerinden 4,5" (RatingBadge);
              // rozet ve sayı birlikte yorumlara giden tek bağlantı.
              <a
                href="#reviews-title"
                className={`inline-flex min-h-[44px] items-center gap-2 text-sm text-gray-600 sm:min-h-0 ${focusRing}`}
              >
                <RatingBadge value={reviewAvg} />
                <span className="underline">{t("ratingCount", { count: reviewCount })}</span>
              </a>
            ) : (
              <span className="text-sm text-gray-600">{t("noRatingYet")}</span>
            )}
          </div>
          {/* F917/F536: karşılaştır, favori, paylaş ve bildir başlığın hemen altında. */}
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
            <PropertyDetailActions
              propertyId={property.id}
              title={property.title}
              checkIn={initial.checkIn}
              checkOut={initial.checkOut}
              guests={initial.guests}
            />
            <Link
              href={`/report?propertyId=${encodeURIComponent(property.id)}`}
              className={`inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-gray-700 underline hover:text-[#003580] sm:min-h-[24px] ${focusRing}`}
            >
              <svg
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9"
                />
              </svg>
              {tc("reportListing")}
            </Link>
          </div>
          {property.licenseNumber && (
            <p className="mt-2 text-sm text-gray-600" data-testid="registration-number">
              {registrationLabel}: <span className="font-mono">{property.licenseNumber}</span>
            </p>
          )}
          {market.totalPriceDisplay === "required" && (
            <p className="mt-1 text-xs text-gray-500">{t("totalPriceNote")}</p>
          )}
          <nav aria-label={t("sectionNav.label")} className="mt-2">
            <ul className="flex flex-wrap items-center gap-x-4 text-sm">
              {sectionLinks.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    className={`inline-flex min-h-[44px] items-center text-gray-600 underline hover:text-[#003580] sm:min-h-[32px] ${focusRing}`}
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        {/* Mobilde sıra: galeri → rezervasyon formu → ayrıntılar; masaüstünde form sağ sütunda. */}
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          <div className="lg:col-span-2 lg:col-start-1 lg:row-start-1">
            <PropertyGallery images={property.images} title={property.title} />
          </div>

          <div
            id="booking"
            tabIndex={-1}
            className={`focus:outline-none lg:col-span-1 lg:col-start-3 lg:row-span-2 lg:row-start-1 ${anchorOffset}`}
          >
            <div className="lg:sticky lg:top-6 lg:-m-1 lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto lg:overscroll-contain lg:p-1 lg:[[data-demo=true]_&]:top-12 lg:[[data-demo=true]_&]:max-h-[calc(100dvh-4.5rem)]">
              <BookingWidget
                propertyId={property.id}
                rooms={property.rooms}
                basePriceMinor={property.basePriceMinor}
                currency={property.currency}
                initial={initial}
              />
            </div>
          </div>

          <div className="lg:col-span-2 lg:col-start-1 lg:row-start-2">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">{t("description")}</h2>
              <p className="mt-2 whitespace-pre-line text-gray-700">{property.description}</p>
            </div>

            <section
              id="policies"
              aria-labelledby="policies-title"
              className={`mt-8 ${anchorOffset}`}
            >
              <h2 id="policies-title" className="text-xl font-semibold text-gray-900">
                {t("policies.title")}
              </h2>
              <ul className="mt-2 space-y-1 text-sm text-gray-700">
                <li>{t("policies.checkIn", { time: property.checkInTime })}</li>
                <li>{t("policies.checkOut", { time: property.checkOutTime })}</li>
              </ul>
              <p className="mt-1 text-xs text-gray-500">
                {t("policies.localTime", { timeZone: property.timeZone })}
              </p>
              {policy && (
                <>
                  <h3 className="mt-4 text-sm font-medium text-gray-800">
                    {t("policies.cancellationTitle", {
                      kind: t(`policies.kinds.${policy.kind}`),
                    })}
                  </h3>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-700">
                    {policy.rules.graceHours ? (
                      <li>{t("policies.grace", { hours: policy.rules.graceHours })}</li>
                    ) : null}
                    {tiers.map((tier) => (
                      <li key={tier.hoursBefore}>{tierText(tier)}</li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-gray-500">{t("policies.note")}</p>
                </>
              )}
            </section>

            {property.amenities.length > 0 && (
              <div className="mt-8">
                <h2 id="amenities-title" className="text-xl font-semibold text-gray-900">
                  {t("amenities")}
                </h2>
                <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {property.amenities.map((amenity) => {
                    const translated = amenityName(amenity);
                    return (
                      <li
                        key={amenity.name}
                        className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700"
                      >
                        {translated ?? <span lang="tr">{amenity.name}</span>}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {/* F447: bölüm her zaman görünür; doğrulanmış özellik yoksa bunu söyler. */}
            {accessibility.length > 0 ? (
              <AccessibilitySection
                features={accessibility}
                propertyId={property.id}
                propertyTitle={property.title}
              />
            ) : (
              <section className="mt-8" aria-labelledby="accessibility-title">
                <h2 id="accessibility-title" className="text-xl font-semibold text-gray-900">
                  {ta("title")}
                </h2>
                <p className="mt-1 text-sm text-gray-600">
                  {ta("noneVerified")}{" "}
                  <Link
                    href={accessibilitySupportHref}
                    className={`inline-flex min-h-[44px] items-center text-[#003580] underline sm:min-h-0 ${focusRing}`}
                  >
                    {ta("askSupport")}
                  </Link>
                </p>
              </section>
            )}

            <PriceCalendar propertyId={property.id} initialCheckIn={initial.checkIn} />

            <ReviewsSection propertyId={property.id} />

            {/* P1-13b: DSA md. 16 bildirim bağlantısı */}
            <p className="mt-8 text-sm">
              <Link
                href={`/report?propertyId=${encodeURIComponent(property.id)}`}
                className="text-gray-600 underline hover:text-[#003580]"
              >
                {tc("reportListing")}
              </Link>
            </p>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
