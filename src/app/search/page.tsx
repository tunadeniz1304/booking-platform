"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import PropertyCard from "@/components/property/PropertyCard";

interface SearchResultItem {
  id: string;
  title: string;
  propertyType: string;
  basePrice: number;
  currency: string;
  ratingAvg: number;
  ratingCount: number;
  location: { city: string; country: string };
  amenities: string[];
  images?: string[];
  availableRooms: number;
  totalPrice?: number;
}

interface SearchResponse {
  results: SearchResultItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  cached: boolean;
}

const PROPERTY_TYPES = ["HOTEL", "APARTMENT", "VILLA", "HOSTEL", "BED_AND_BREAKFAST"];

const TYPE_LABELS: Record<string, string> = {
  HOTEL: "Otel",
  APARTMENT: "Apart",
  VILLA: "Villa",
  HOSTEL: "Hostel",
  BED_AND_BREAKFAST: "Pansiyon",
};

function SearchPageContent() {
  const searchParams = useSearchParams();
  const destination = searchParams.get("destination") || "";
  const checkIn = searchParams.get("checkIn") || "";
  const checkOut = searchParams.get("checkOut") || "";
  const guests = Number(searchParams.get("guests")) || 2;

  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cached, setCached] = useState(false);

  const [priceRange, setPriceRange] = useState<[number, number]>([0, 20000]);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState("recommended");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (destination) {
        params.set("destination", destination);
        // pgvector semantik arama: sorgu-odaklı olduğunda daha iyi sıralar;
        // vektör katmanı yoksa servis otomatik olarak keyword yoluna döner.
        params.set("semantic", "1");
      }
      if (checkIn) params.set("checkIn", checkIn);
      if (checkOut) params.set("checkOut", checkOut);
      if (guests) params.set("guests", String(guests));
      if (sortBy && sortBy !== "recommended") params.set("sort", sortBy);
      params.set("page", "1");
      params.set("pageSize", "24");

      const res = await fetch(`/api/search?${params.toString()}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Arama sonuçları yüklenemedi");
      const data = (await res.json()) as SearchResponse;
      setResults(data.results);
      setTotal(data.total);
      setCached(data.cached);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Arama sonuçları yüklenemedi");
    } finally {
      setLoading(false);
    }
  }, [destination, checkIn, checkOut, guests, sortBy]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  const visibleResults = results.filter((p) => {
    const price = p.basePrice;
    if (price < priceRange[0] || price > priceRange[1]) return false;
    if (selectedTypes.length > 0 && !selectedTypes.includes(p.propertyType)) return false;
    return true;
  });

  const toggleType = (type: string) => {
    setSelectedTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6 rounded-lg bg-white p-4 shadow-sm">
          <h1 className="text-xl font-bold text-gray-900">
            {destination ? `${destination} için konaklama` : "Tüm konaklama yerleri"}
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            {checkIn && checkOut
              ? `${new Date(checkIn).toLocaleDateString("tr-TR")} - ${new Date(checkOut).toLocaleDateString("tr-TR")} · ${guests} misafir`
              : `${guests} misafir`}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-4">
          <aside className="lg:col-span-1">
            <div className="rounded-lg bg-white p-4 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900">Filtreler</h2>

              <div className="mt-4">
                <h3 className="text-sm font-medium text-gray-700">Fiyat Aralığı</h3>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="number"
                    value={priceRange[0]}
                    onChange={(e) => setPriceRange([Number(e.target.value), priceRange[1]])}
                    className="w-full rounded-sm border border-gray-300 px-2 py-1 text-sm"
                    placeholder="Min"
                  />
                  <span>-</span>
                  <input
                    type="number"
                    value={priceRange[1]}
                    onChange={(e) => setPriceRange([priceRange[0], Number(e.target.value)])}
                    className="w-full rounded-sm border border-gray-300 px-2 py-1 text-sm"
                    placeholder="Max"
                  />
                </div>
              </div>

              <div className="mt-4">
                <h3 className="text-sm font-medium text-gray-700">Konaklama Türü</h3>
                <div className="mt-2 space-y-2">
                  {PROPERTY_TYPES.map((type) => (
                    <label key={type} className="flex items-center gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={selectedTypes.includes(type)}
                        onChange={() => toggleType(type)}
                        className="h-4 w-4 rounded border-gray-300 text-[#003580] focus:ring-[#003580]"
                      />
                      {TYPE_LABELS[type]}
                    </label>
                  ))}
                </div>
              </div>

              <div className="mt-4">
                <h3 className="text-sm font-medium text-gray-700">Sıralama</h3>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="mt-2 w-full rounded-sm border border-gray-300 px-2 py-1 text-sm"
                >
                  <option value="recommended">Önerilen</option>
                  <option value="price_asc">Fiyat (önce en düşük)</option>
                  <option value="price_desc">Fiyat (önce en yüksek)</option>
                  <option value="rating">Puan (önce en yüksek)</option>
                </select>
              </div>
            </div>
          </aside>

          <div className="lg:col-span-3">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm text-gray-600">
                {loading
                  ? "Yükleniyor..."
                  : `${visibleResults.length} sonuç gösteriliyor (${total} bulundu)`}
              </p>
              {cached && (
                <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">
                  Önbellekten
                </span>
              )}
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 p-6 text-center shadow-sm">
                <p className="text-red-600">{error}</p>
              </div>
            )}

            {!error && !loading && visibleResults.length === 0 && (
              <div className="rounded-lg bg-white p-12 text-center shadow-sm">
                <p className="text-lg font-semibold text-gray-900">Sonuç bulunamadı</p>
                <p className="mt-2 text-sm text-gray-600">Filtreleri değiştirmeyi deneyin.</p>
              </div>
            )}

            {!error && (
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
                {visibleResults.map((property) => (
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
                    currency={property.currency}
                    rating={property.ratingAvg}
                    reviewCount={property.ratingCount}
                    propertyType={TYPE_LABELS[property.propertyType] ?? property.propertyType}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50" />}>
      <SearchPageContent />
    </Suspense>
  );
}
