"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import PropertyCard from "@/components/property/PropertyCard";
import RankingWhy from "@/components/search/RankingWhy";
import SmartFilter, { type SmartFilters } from "@/components/search/SmartFilter";
import type { MapPoint } from "@/components/search/ResultsMap";
import { apiFetch } from "@/lib/api-client";
import { formatDecimal } from "@/lib/ui/format";
import { focusRing } from "@/components/ui/ui";

// Harita yalnızca istemcide ve yalnızca istenince yüklenir (maplibre ağır, SSR'siz).
const ResultsMap = dynamic(() => import("@/components/search/ResultsMap"), {
  ssr: false,
  loading: () => <p className="text-sm text-gray-600">Harita yükleniyor…</p>,
});

interface SearchResultItem {
  id: string;
  title: string;
  propertyType: string;
  basePrice: number;
  currency: string;
  ratingAvg: number;
  ratingCount: number;
  location: {
    city: string;
    country: string;
    latitude?: number | null;
    longitude?: number | null;
  };
  amenities: string[];
  images?: string[];
  availableRooms: number;
  totalPrice?: number;
  score?: number;
  explain?: Record<string, number>;
}

interface SearchResponse {
  results: SearchResultItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  cached: boolean;
}

interface SmartResponse extends SearchResponse {
  filters: SmartFilters;
  llmMode: string;
}

/** Akıllı filtre çıktısını deterministik `GET /api/search` parametrelerine çevirir. */
function smartToParams(f: SmartFilters): URLSearchParams {
  const params = new URLSearchParams();
  const destination = f.city ?? f.query;
  if (destination) params.set("destination", destination);
  if (f.guests) params.set("guests", String(f.guests));
  if (f.minPrice !== undefined) params.set("minPrice", String(f.minPrice));
  if (f.maxPrice !== undefined) params.set("maxPrice", String(f.maxPrice));
  if (f.propertyType) params.set("propertyType", f.propertyType);
  if (f.amenities.length > 0) params.set("amenities", f.amenities.join(","));
  if (f.checkIn) params.set("checkIn", f.checkIn);
  if (f.checkOut) params.set("checkOut", f.checkOut);
  if (f.sort && f.sort !== "recommended") params.set("sort", f.sort);
  return params;
}

const PROPERTY_TYPES = ["HOTEL", "APARTMENT", "VILLA", "HOSTEL", "BED_AND_BREAKFAST"];

const TYPE_LABELS: Record<string, string> = {
  HOTEL: "Otel",
  APARTMENT: "Apart",
  VILLA: "Villa",
  HOSTEL: "Hostel",
  BED_AND_BREAKFAST: "Pansiyon",
};

const smallInput = `w-full rounded-sm border border-gray-400 px-2 py-1 text-sm ${focusRing}`;

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

  const [smartFilters, setSmartFilters] = useState<SmartFilters | null>(null);
  const [llmMode, setLlmMode] = useState<string | null>(null);
  const [smartBusy, setSmartBusy] = useState(false);
  const [view, setView] = useState<"list" | "map">("list");
  /** Harita ↔ liste senkronu: seçili mülk (işaretçi veya liste öğesi). */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let params = new URLSearchParams();
      if (smartFilters) {
        // Akıllı filtre çipleri: deterministik arama (LLM yeniden çağrılmaz).
        params = smartToParams(smartFilters);
      } else {
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
      }
      params.set("page", "1");
      params.set("pageSize", "24");

      const data = await apiFetch<SearchResponse>(`/api/search?${params.toString()}`, {
        cache: "no-store",
      });
      setResults(data.results);
      setTotal(data.total);
      setCached(data.cached);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Arama sonuçları yüklenemedi");
    } finally {
      setLoading(false);
    }
  }, [destination, checkIn, checkOut, guests, sortBy, smartFilters]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  const runSmart = async (text: string) => {
    setSmartBusy(true);
    setError(null);
    try {
      const data = await apiFetch<SmartResponse>("/api/search/smart", {
        method: "POST",
        body: JSON.stringify({ text }),
      });
      setLlmMode(data.llmMode);
      setSmartFilters({ ...data.filters, amenities: data.filters.amenities ?? [] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Akıllı filtre çalışmadı");
    } finally {
      setSmartBusy(false);
    }
  };

  const visibleResults = results.filter((p) => {
    const price = p.basePrice;
    if (price < priceRange[0] || price > priceRange[1]) return false;
    if (selectedTypes.length > 0 && !selectedTypes.includes(p.propertyType)) return false;
    return true;
  });

  const mapPoints: MapPoint[] = visibleResults.flatMap((p) =>
    typeof p.location.latitude === "number" && typeof p.location.longitude === "number"
      ? [
          {
            id: p.id,
            title: p.title,
            city: p.location.city,
            latitude: p.location.latitude,
            longitude: p.location.longitude,
            priceLabel: formatDecimal(p.basePrice, p.currency),
          },
        ]
      : []
  );
  const showMap = view === "map" && !mapError && mapPoints.length > 0;

  const toggleType = (type: string) => {
    setSelectedTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main id="main" className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6 rounded-lg bg-white p-4 shadow-sm">
          <h1 className="text-xl font-bold text-gray-900">
            {destination ? `${destination} için konaklama` : "Tüm konaklama yerleri"}
          </h1>
          <p className="mt-1 text-sm text-gray-700">
            {checkIn && checkOut
              ? `${new Date(checkIn).toLocaleDateString("tr-TR")} - ${new Date(checkOut).toLocaleDateString("tr-TR")} · ${guests} misafir`
              : `${guests} misafir`}
          </p>
        </div>

        <div className="mb-6">
          <SmartFilter
            filters={smartFilters}
            llmMode={llmMode}
            busy={smartBusy}
            onSubmit={runSmart}
            onChange={setSmartFilters}
            onClear={() => {
              setSmartFilters(null);
              setLlmMode(null);
            }}
          />
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-4">
          <aside className="lg:col-span-1">
            <div className="rounded-lg bg-white p-4 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900">Filtreler</h2>

              <fieldset className="mt-4">
                <legend className="text-sm font-medium text-gray-800">Fiyat Aralığı</legend>
                <div className="mt-2 flex items-center gap-2">
                  <label htmlFor="price-min" className="sr-only">
                    En düşük fiyat
                  </label>
                  <input
                    id="price-min"
                    type="number"
                    value={priceRange[0]}
                    onChange={(e) => setPriceRange([Number(e.target.value), priceRange[1]])}
                    className={smallInput}
                    placeholder="Min"
                  />
                  <span aria-hidden="true">-</span>
                  <label htmlFor="price-max" className="sr-only">
                    En yüksek fiyat
                  </label>
                  <input
                    id="price-max"
                    type="number"
                    value={priceRange[1]}
                    onChange={(e) => setPriceRange([priceRange[0], Number(e.target.value)])}
                    className={smallInput}
                    placeholder="Max"
                  />
                </div>
              </fieldset>

              <fieldset className="mt-4">
                <legend className="text-sm font-medium text-gray-800">Konaklama Türü</legend>
                <div className="mt-2 space-y-2">
                  {PROPERTY_TYPES.map((type) => (
                    <label key={type} className="flex items-center gap-2 text-sm text-gray-800">
                      <input
                        type="checkbox"
                        checked={selectedTypes.includes(type)}
                        onChange={() => toggleType(type)}
                        className={`h-4 w-4 rounded border-gray-400 text-[#003580] ${focusRing}`}
                      />
                      {TYPE_LABELS[type]}
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className="mt-4">
                <label htmlFor="sort-by" className="text-sm font-medium text-gray-800">
                  Sıralama
                </label>
                <select
                  id="sort-by"
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className={`mt-2 ${smallInput}`}
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
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <p aria-live="polite" className="text-sm text-gray-700">
                {loading
                  ? "Yükleniyor..."
                  : `${visibleResults.length} sonuç gösteriliyor (${total} bulundu)`}
              </p>
              <div className="flex items-center gap-2">
                {cached && (
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800">
                    Önbellekten
                  </span>
                )}
                <div
                  role="group"
                  aria-label="Görünüm"
                  className="flex overflow-hidden rounded-md border border-gray-400"
                >
                  {(["list", "map"] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      aria-pressed={view === v}
                      onClick={() => {
                        setView(v);
                        if (v === "map") setMapError(null);
                      }}
                      className={`px-3 py-1 text-sm ${
                        view === v ? "bg-[#003580] text-white" : "bg-white text-gray-800"
                      } ${focusRing}`}
                    >
                      {v === "list" ? "Liste" : "Harita"}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div aria-live="polite" className="text-sm">
              {view === "map" && mapError && (
                <p role="alert" className="mb-4 rounded-md bg-amber-50 p-3 text-amber-950">
                  Harita yüklenemedi (ör. çevrimdışı); liste görünümü gösteriliyor.
                </p>
              )}
              {view === "map" && !mapError && !loading && mapPoints.length === 0 && (
                <p className="mb-4 rounded-md bg-gray-100 p-3 text-gray-800">
                  Sonuçlar için konum bilgisi yok; liste görünümü gösteriliyor.
                </p>
              )}
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 p-6 text-center shadow-sm">
                <p role="alert" className="text-red-700">
                  {error}
                </p>
              </div>
            )}

            {!error && !loading && visibleResults.length === 0 && (
              <div className="rounded-lg bg-white p-12 text-center shadow-sm">
                <p className="text-lg font-semibold text-gray-900">Sonuç bulunamadı</p>
                <p className="mt-2 text-sm text-gray-700">Filtreleri değiştirmeyi deneyin.</p>
              </div>
            )}

            {showMap && !error && (
              <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
                <div className="lg:col-span-2">
                  <ResultsMap
                    points={mapPoints}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    onFail={(reason) => setMapError(reason)}
                  />
                </div>
                <MapResultList
                  points={mapPoints}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                />
              </div>
            )}

            {!error && !showMap && (
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
                {visibleResults.map((property) => (
                  <div key={property.id}>
                    <PropertyCard
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
                    <RankingWhy score={property.score} explain={property.explain} />
                  </div>
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

/** Harita görünümünün yan listesi: seçim haritayla iki yönlü senkron. */
function MapResultList({
  points,
  selectedId,
  onSelect,
}: {
  points: MapPoint[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const itemRefs = useRef(new Map<string, HTMLLIElement>());
  useEffect(() => {
    if (selectedId) itemRefs.current.get(selectedId)?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  return (
    <ul
      aria-label="Haritadaki sonuçlar"
      className="max-h-[480px] space-y-2 overflow-y-auto rounded-lg bg-white p-2 shadow-sm"
    >
      {points.map((p) => {
        const active = p.id === selectedId;
        return (
          <li
            key={p.id}
            ref={(el) => {
              if (el) itemRefs.current.set(p.id, el);
              else itemRefs.current.delete(p.id);
            }}
          >
            <button
              type="button"
              aria-pressed={active}
              onClick={() => onSelect(active ? null : p.id)}
              className={`w-full rounded-md border px-3 py-2 text-left text-sm ${
                active
                  ? "border-[#003580] bg-amber-100 text-gray-900"
                  : "border-gray-200 bg-white text-gray-900 hover:bg-gray-50"
              } ${focusRing}`}
            >
              <span className="block font-semibold">{p.title}</span>
              <span className="text-gray-700">
                {p.city} · {p.priceLabel}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50" />}>
      <SearchPageContent />
    </Suspense>
  );
}
