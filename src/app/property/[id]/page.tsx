import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import PropertyGallery from "@/components/property/PropertyGallery";
import BookingWidget, {
  BookingWidgetRoom,
} from "@/components/booking/BookingWidget";

interface PropertyPageProps {
  params: { id: string };
}

interface PropertyDetail {
  id: string;
  title: string;
  description: string;
  propertyType: string;
  location: { city: string; country: string };
  basePrice: number;
  currency: string;
  ratingAvg: number;
  ratingCount: number;
  amenities: { name: string; icon: string | null }[];
  images: string[];
  rooms: BookingWidgetRoom[];
}

async function getProperty(id: string): Promise<PropertyDetail | null> {
  const property = await prisma.property.findFirst({
    where: { id, isActive: true },
    select: {
      id: true,
      title: true,
      description: true,
      propertyType: true,
      basePrice: true,
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
          capacity: true,
          bedType: true,
          priceModifier: true,
          available: true,
        },
        orderBy: { name: "asc" },
      },
    },
  });
  if (!property) return null;

  return {
    ...property,
    basePrice: Number(property.basePrice),
    rooms: property.rooms.map((room) => ({
      ...room,
      priceModifier: Number(room.priceModifier),
    })),
  };
}

export async function generateMetadata({
  params,
}: PropertyPageProps): Promise<Metadata> {
  const { id } = await params;
  const property = await getProperty(id);
  return {
    title: property ? `${property.title} | Booking Platform` : "Property Bulunamadı",
  };
}

export default async function PropertyPage({ params }: PropertyPageProps) {
  const { id } = await params;
  const property = await getProperty(id);

  if (!property) {
    notFound();
  }

  return (
    <div className="min-h-screen bg-white">
      <Header />
      <main className="mx-auto max-w-7xl px-4 py-8">
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
              {property.ratingCount} değerlendirme
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <PropertyGallery images={property.images} title={property.title} />

            <div className="mt-8">
              <h2 className="text-xl font-semibold text-gray-900">Açıklama</h2>
              <p className="mt-2 whitespace-pre-line text-gray-700">
                {property.description}
              </p>
            </div>

            {property.amenities.length > 0 && (
              <div className="mt-8">
                <h2 className="text-xl font-semibold text-gray-900">Olanaklar</h2>
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
          </div>

          <div className="lg:col-span-1">
            <div className="lg:sticky lg:top-6">
              <BookingWidget
                propertyId={property.id}
                rooms={property.rooms}
                basePrice={property.basePrice}
                currency={property.currency}
              />
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
