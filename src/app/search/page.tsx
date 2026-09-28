"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import PropertyCard from "@/components/property/PropertyCard";
import RankingWhy from "@/components/search/RankingWhy";
import SmartFilter, { type SmartFilters } from "@/components/search/SmartFilter";
import CompareToggle from "@/components/compare/CompareToggle";
import CompareBar from "@/components/compare/CompareBar";
import AccessibilityFilter from "@/components/search/AccessibilityFilter";
import { parseAccessibilityParam } from "@/lib/compliance/accessibility-codes";
import type { MapPoint } from "@/components/search/ResultsMap";
import { apiFetch } from "@/lib/api-client";
import { useFormat } from "@/i18n/use-format";
import { toMajorNumber } from "@/lib/money/money";
import { focusRing } from "@/components/ui/ui";

// Harita yalnızca istemcide ve yalnızca istenince yüklenir (maplibre ağır, SSR'siz).
const ResultsMap = dynamic(() => import("@/components/search/ResultsMap"), {
  ssr: false,
  loading: () => <MapLoading />,
});

/** Harita paketi yüklenirken gösterilen yer tutucu (çeviri için hook kullanır). */
function MapLoading() {
  const t = useTranslations("search");
  return <p className="text-sm text-gray-600">{t("mapLoading")}</p>;
}

interface SearchResultItem {
  id: string;
  title: string;
  propertyType: string;
  /** Taban gece fiyatı (minor-unit). */
  basePriceMinor: number;
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
  /** Tarih seçiliyse sunucu teklifi (vergi + ücret dahil, minor-unit). */
  quote?: { roomId: string; ratePlanId: string; total: number; currency: string; nights: number };
  score?: number;
  explain?: Record<string, number>;
  /** P1-10: "benzerlerini göster" kaynağı (görsel arama açıksa). */
  coverPhotoId?: string;
  /** P1-3: ±N gün içinde teklif motoruyla doğrulanmış daha ucuz tarih (minor-unit). */
  flexSuggestion?: {
    checkIn: string;
    checkOut: string;
    shiftDays: number;
    roomId: string;
    ratePlanId: string;
    total: number;
    savings: number;
    currency: string;
  };
}

/** Arama `flexDays` seçenekleri (0 = tam tarihler). */
const FLEX_OPTIONS = [0, 1, 2, 3] as const;

type VisualReason =
  "FLAG_OFF" | "MODULE_MISSING" | "MODEL_MISSING" | "LOAD_FAILED" | "VECTOR_UNAVAILABLE";

interface SearchResponse {
  results: SearchResultItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  cached: boolean;
  visual?: { enabled: boolean; applied: boolean; reason: VisualReason | null };
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

/** Mülk türü → `search.types.*` çeviri anahtarı. */
const TYPE_KEYS: Record<string, string> = {
  HOTEL: "hotel",
  APARTMENT: "apartment",
  VILLA: "villa",
  HOSTEL: "hostel",
  BED_AND_BREAKFAST: "bedAndBreakfast",
};

const smallInput = `w-full rounded-sm border border-gray-400 px-2 py-1 text-sm ${focusRing}`;

function SearchPageContent() {
  const t = useTranslations("search");
  const f = useFormat();
  const typeLabel = (type: string) => (TYPE_KEYS[type] ? t(`types.${TYPE_KEYS[type]}`) : type);
  const searchParams = useSearchParams();
  const destination = searchParams.get("destination") || "";
  const checkIn = searchParams.get("checkIn") || "";
  const checkOut = searchParams.get("checkOut") || "";
  const guests = Number(searchParams.get("guests")) || 2;
  const similarToPhotoId = searchParams.get("similarToPhotoId") || "";
  const router = useRouter();
  // P1-13(e): doğrulanmış erişilebilirlik filtresi URL'de tutulur (paylaşılabilir bağlantı).
  const accessibilityParam = parseAccessibilityParam(searchParams.get("accessibility")).codes.join(
    ","
  );
  const setAccessibility = (codes: string[]) => {
    const next = new URLSearchParams(searchParams.toString());
    if (codes.length > 0) next.set("accessibility", codes.join(","));
    else next.delete("accessibility");
    router.replace(`/search?${next.toString()}`, { scroll: false });
  };
  const initialFlex = Number(searchParams.get("flexDays"));
  /** Mevcut aramayı koruyarak görsel kNN kaynağını değiştiren bağlantı (boş → kaldır). */
  const similarHref = (photoId: string) => {
    const next = new URLSearchParams(searchParams.toString());
    if (photoId) next.set("similarToPhotoId", photoId);
    else next.delete("similarToPhotoId");
    return `/search?${next.toString()}`;
  };

  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cached, setCached] = useState(false);
  const [visual, setVisual] = useState<SearchResponse["visual"]>(undefined);

  const [priceRange, setPriceRange] = useState<[number, number]>([0, 20000]);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState("recommended");
  const [flexDays, setFlexDays] = useState<number>(
    FLEX_OPTIONS.includes(initialFlex as (typeof FLEX_OPTIONS)[number]) ? initialFlex : 0
  );

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
      if (similarToPhotoId) params.set("similarToPhotoId", similarToPhotoId);
      if (accessibilityParam) params.set("accessibility", accessibilityParam);
      if (flexDays > 0 && params.get("checkIn") && params.get("checkOut")) {
        params.set("flexDays", String(flexDays));
      }
      params.set("page", "1");
      params.set("pageSize", "24");

      const data = await apiFetch<SearchResponse>(`/api/search?${params.toString()}`, {
        cache: "no-store",
      });
      setResults(data.results);
      setTotal(data.total);
      setCached(data.cached);
      setVisual(data.visual);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.load"));
    } finally {
      setLoading(false);
    }
  }, [
    destination,
    checkIn,
    checkOut,
    guests,
    sortBy,
    smartFilters,
    similarToPhotoId,
    accessibilityParam,
    flexDays,
    t,
  ]);

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
      setError(err instanceof Error ? err.message : t("errors.smart"));
    } finally {
      setSmartBusy(false);
    }
  };

  const visibleResults = results.filter((p) => {
    // Fiyat aralığı süzgeci ana birimde (kaydırıcı); tutar minor-unit'ten türetilir.
    const price = toMajorNumber(p.basePriceMinor, p.currency);
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
            priceLabel: f.money(p.basePriceMinor, p.currency),
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
            {destination ? t("heading.destination", { destination }) : t("heading.all")}
          </h1>
          <p className="mt-1 text-sm text-gray-700">
            {checkIn && checkOut
              ? `${f.date(checkIn)} - ${f.date(checkOut)} · ${t("guestCount", { count: guests })}`
              : t("guestCount", { count: guests })}
          </p>
          {similarToPhotoId && visual && (
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm" role="status">
              <span className={visual.applied ? "text-gray-900" : "text-amber-800"}>
                {visual.applied
                  ? t("visual.similarHeading")
                  : t(`visual.reasons.${visual.reason ?? "LOAD_FAILED"}`)}
              </span>
              <Link
                href={similarHref("")}
                className={`font-medium text-blue-700 underline ${focusRing}`}
              >
                {t("visual.clearSimilar")}
              </Link>
            </div>
          )}
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
              <h2 className="text-lg font-semibold text-gray-900">{t("filters.title")}</h2>

              <fieldset className="mt-4">
                <legend className="text-sm font-medium text-gray-800">{t("filters.price")}</legend>
                <div className="mt-2 flex items-center gap-2">
                  <label htmlFor="price-min" className="sr-only">
                    {t("filters.minPrice")}
                  </label>
                  <input
                    id="price-min"
                    type="number"
                    value={priceRange[0]}
                    onChange={(e) => setPriceRange([Number(e.target.value), priceRange[1]])}
                    className={smallInput}
                    placeholder={t("filters.minPlaceholder")}
                  />
                  <span aria-hidden="true">-</span>
                  <label htmlFor="price-max" className="sr-only">
                    {t("filters.maxPrice")}
                  </label>
                  <input
                    id="price-max"
                    type="number"
                    value={priceRange[1]}
                    onChange={(e) => setPriceRange([priceRange[0], Number(e.target.value)])}
                    className={smallInput}
                    placeholder={t("filters.maxPlaceholder")}
                  />
                </div>
              </fieldset>

              <fieldset className="mt-4">
                <legend className="text-sm font-medium text-gray-800">{t("filters.type")}</legend>
                <div className="mt-2 space-y-2">
                  {PROPERTY_TYPES.map((type) => (
                    <label key={type} className="flex items-center gap-2 text-sm text-gray-800">
                      <input
                        type="checkbox"
                        checked={selectedTypes.includes(type)}
                        onChange={() => toggleType(type)}
                        className={`h-4 w-4 rounded border-gray-400 text-[#003580] ${focusRing}`}
                      />
                      {typeLabel(type)}
                    </label>
                  ))}
                </div>
              </fieldset>

              <AccessibilityFilter
                selected={parseAccessibilityParam(accessibilityParam).codes}
                onChange={setAccessibility}
              />

              <div className="mt-4">
                <label htmlFor="sort-by" className="text-sm font-medium text-gray-800">
                  {t("filters.sort")}
                </label>
                <select
                  id="sort-by"
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className={`mt-2 ${smallInput}`}
                >
                  <option value="recommended">{t("sort.recommended")}</option>
                  <option value="price_asc">{t("sort.priceAsc")}</option>
                  <option value="price_desc">{t("sort.priceDesc")}</option>
                  <option value="rating">{t("sort.rating")}</option>
                </select>
              </div>

              <div className="mt-4">
                <label htmlFor="flex-days" className="text-sm font-medium text-gray-800">
                  {t("flex.label")}
                </label>
                <select
                  id="flex-days"
                  value={flexDays}
                  onChange={(e) => setFlexDays(Number(e.target.value))}
                  disabled={!checkIn || !checkOut}
                  aria-describedby={!checkIn || !checkOut ? "flex-days-hint" : undefined}
                  className={`mt-2 ${smallInput} disabled:bg-gray-100`}
                >
                  {FLEX_OPTIONS.map((d) => (
                    <option key={d} value={d}>
                      {d === 0 ? t("flex.exact") : t("flex.plusMinus", { days: d })}
                    </option>
                  ))}
                </select>
                {(!checkIn || !checkOut) && (
                  <p id="flex-days-hint" className="mt-1 text-xs text-gray-600">
                    {t("flex.needsDates")}
                  </p>
                )}
              </div>
            </div>
          </aside>

          <div className="lg:col-span-3">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <p aria-live="polite" className="text-sm text-gray-700">
                {loading ? t("loading") : t("resultCount", { shown: visibleResults.length, total })}
              </p>
              <div className="flex items-center gap-2">
                {cached && (
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800">
                    {t("cached")}
                  </span>
                )}
                <div
                  role="group"
                  aria-label={t("view")}
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
                      {v === "list" ? t("list") : t("map")}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div aria-live="polite" className="text-sm">
              {view === "map" && mapError && (
                <p role="alert" className="mb-4 rounded-md bg-amber-50 p-3 text-amber-950">
                  {t("mapFailed")}
                </p>
              )}
              {view === "map" && !mapError && !loading && mapPoints.length === 0 && (
                <p className="mb-4 rounded-md bg-gray-100 p-3 text-gray-800">{t("noLocation")}</p>
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
                <p className="text-lg font-semibold text-gray-900">{t("noResults")}</p>
                <p className="mt-2 text-sm text-gray-700">{t("noResultsHint")}</p>
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
                      priceMinor={property.basePriceMinor}
                      currency={property.currency}
                      rating={property.ratingAvg}
                      reviewCount={property.ratingCount}
                      propertyType={typeLabel(property.propertyType)}
                      stay={
                        property.quote && checkIn && checkOut
                          ? {
                              total: property.quote.total,
                              nights: property.quote.nights,
                              checkIn,
                              checkOut,
                              guests,
                              roomId: property.quote.roomId,
                              ratePlanId: property.quote.ratePlanId,
                            }
                          : undefined
                      }
                    />
                    {property.flexSuggestion && (
                      <FlexSuggestionNote
                        propertyId={property.id}
                        suggestion={property.flexSuggestion}
                        guests={guests}
                      />
                    )}
                    <RankingWhy score={property.score} explain={property.explain} />
                    <CompareToggle propertyId={property.id} />
                    {property.coverPhotoId && (
                      <Link
                        href={similarHref(property.coverPhotoId)}
                        className={`mt-1 inline-block text-sm font-medium text-blue-700 underline ${focusRing}`}
                      >
                        {t("visual.showSimilar")}
                      </Link>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
      <CompareBar checkIn={checkIn || undefined} checkOut={checkOut || undefined} guests={guests} />
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
  const t = useTranslations("search");
  const itemRefs = useRef(new Map<string, HTMLLIElement>());
  useEffect(() => {
    if (selectedId) itemRefs.current.get(selectedId)?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  return (
    <ul
      aria-label={t("mapResults")}
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

/** P1-3: ±N gün önerisi — tutar metinle verilir (renk tek sinyal değil). */
function FlexSuggestionNote({
  propertyId,
  suggestion,
  guests,
}: {
  propertyId: string;
  suggestion: NonNullable<SearchResultItem["flexSuggestion"]>;
  guests: number;
}) {
  const t = useTranslations("search");
  const f = useFormat();
  const href = `/property/${propertyId}?${new URLSearchParams({
    checkIn: suggestion.checkIn,
    checkOut: suggestion.checkOut,
    guests: String(guests),
    roomId: suggestion.roomId,
    ratePlanId: suggestion.ratePlanId,
  }).toString()}`;
  const dates = `${f.date(suggestion.checkIn, "medium")} – ${f.date(suggestion.checkOut, "medium")}`;
  return (
    <p className="mt-2 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-gray-900">
      <span>
        {t("flex.suggestion", {
          dates,
          savings: f.money(suggestion.savings, suggestion.currency),
        })}
      </span>{" "}
      <span className="text-gray-700">
        ({t("flex.total", { total: f.money(suggestion.total, suggestion.currency) })})
      </span>{" "}
      <Link href={href} className={`font-medium text-blue-700 underline ${focusRing}`}>
        {t("flex.view")}
      </Link>
    </p>
  );
}
