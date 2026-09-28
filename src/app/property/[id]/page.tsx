import type { Metadata } from "next";
import { minorFromDb } from "@/lib/money/money";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { LISTABLE_PROPERTY } from "@/lib/compliance/listing";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import PropertyGallery from "@/components/property/PropertyGallery";
import BookingWidget, { BookingWidgetRoom } from "@/components/booking/BookingWidget";
import ReviewsSection from "@/components/property/ReviewsSection";
import AccessibilitySection from "@/components/property/AccessibilitySection";
import { listPublicFeatures } from "@/lib/compliance/accessibility";
import PriceCalendar from "@/components/property/PriceCalendar";

interface PropertyPageProps {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

interface PropertyDetail {
  id: string;
  title: string;
  description: string;
  propertyType: string;
  location: { city: string; country: string };
  basePriceMinor: number;
  currency: string;
  ratingAvg: number;
  ratingCount: number;
  amenities: { name: string; icon: string | null }[];
  images: string[];
  rooms: BookingWidgetRoom[];
}

async function getProperty(id: string): Promise<PropertyDetail | null> {
  const property = await prisma.property.findFirst({
    where: { id, ...LISTABLE_PROPERTY },
    select: {
      id: true,
      title: true,
      description: true,
      propertyType: true,
      basePriceMinor: true,
      currency: true,
      ratingAvg: true,
      ratingCount: true,
      images: true,
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
  const initial = {
    checkIn: one(sp.checkIn),
    checkOut: one(sp.checkOut),
    guests: Number(one(sp.guests)) || undefined,
    roomId: one(sp.roomId),
    ratePlanId: one(sp.ratePlanId),
  };
  const property = await getProperty(id);
  const t = await getTranslations("property");
  const tc = await getTranslations("compliance.report");

  if (!property) {
    notFound();
  }
  // P1-13(e): yalnız doğrulanmış erişilebilirlik özellikleri.
  const accessibility = await listPublicFeatures(property.id);

  return (
    <div className="min-h-screen bg-white">
      <Header />
      <main id="main" className="mx-auto max-w-7xl px-4 py-8">
        <div className="mb-6">
          <p className="text-sm text-gray-500">
            {property.location.city}, {property.location.country}
          </p>
          <h1 className="mt-1 text-3xl font-bold text-gray-900">{property.title}</h1>
          <div className="mt-2 flex items-center gap-2">
            <span className="inline-flex items-center rounded-lg bg-[#003580] px-2 py-1 text-sm font-semibold text-white">
              {property.ratingAvg.toFixed(1)}
            </span>
            <span className="text-sm text-gray-600">
              {t("ratingCount", { count: property.ratingCount })}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <PropertyGallery images={property.images} title={property.title} />

            <div className="mt-8">
              <h2 className="text-xl font-semibold text-gray-900">{t("description")}</h2>
              <p className="mt-2 whitespace-pre-line text-gray-700">{property.description}</p>
            </div>

            {property.amenities.length > 0 && (
              <div className="mt-8">
                <h2 className="text-xl font-semibold text-gray-900">{t("amenities")}</h2>
                <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {property.amenities.map((amenity) => (
                    <li
                      key={amenity.name}
                      className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700"
                    >
                      {amenity.name}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {accessibility.length > 0 && <AccessibilitySection features={accessibility} />}

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

          <div className="lg:col-span-1">
            <div className="lg:sticky lg:top-6">
              <BookingWidget
                propertyId={property.id}
                rooms={property.rooms}
                basePriceMinor={property.basePriceMinor}
                currency={property.currency}
                initial={initial}
              />
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
