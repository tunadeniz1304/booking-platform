import Link from "next/link";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import SearchBar from "@/components/search/SearchBar";
import PropertyCard from "@/components/property/PropertyCard";
import { getPopularProperties } from "@/lib/search";

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

export default async function HomePage() {
  const popular = await getPopularProperties(6);

  return (
    <div className="min-h-screen bg-white">
      <Header />
      <main>
        <section className="bg-[#003580] pb-16 pt-8">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <h1 className="text-3xl font-bold text-white sm:text-4xl">
              Binlerce konaklama yerini keşfedin
            </h1>
            <p className="mt-2 text-white/80">
              Dünya genelinde 2.000.000+ konaklama seçeneği
            </p>
            <div className="mt-8">
              <SearchBar />
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <h2 className="text-2xl font-bold text-gray-900">Popüler destinasyonlar</h2>
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {popularDestinations.map((dest) => (
              <Link
                key={dest.city}
                href={`/search?destination=${encodeURIComponent(dest.city)}`}
                className="group relative overflow-hidden rounded-lg"
              >
                <img
                  src={dest.imageUrl}
                  alt={dest.city}
                  className="h-48 w-full object-cover transition duration-300 group-hover:scale-105"
                />
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
          <h2 className="text-2xl font-bold text-gray-900">Öne çıkan konaklama yerleri</h2>
          {popular.length > 0 ? (
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
                  price={property.basePrice}
                  rating={property.ratingAvg}
                  reviewCount={property.ratingCount}
                  propertyType={property.propertyType}
                />
              ))}
            </div>
          ) : (
            <div className="mt-6 rounded-lg bg-gray-50 p-12 text-center">
              <p className="text-gray-500">Henüz konaklama ilanı yok.</p>
            </div>
          )}
        </section>
      </main>
      <Footer />
    </div>
  );
}
