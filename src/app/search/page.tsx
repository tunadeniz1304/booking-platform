"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
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
import { useCompareSelection } from "@/components/compare/useCompareSelection";
import AccessibilityFilter from "@/components/search/AccessibilityFilter";
import { parseAccessibilityParam } from "@/lib/compliance/accessibility-codes";
import type { MapPoint } from "@/components/search/ResultsMap";
import { apiFetch } from "@/lib/api-client";
import { useFormat } from "@/i18n/use-format";
import { parseAmountToMinor } from "@/lib/ui/amount-input";
import { Button, focusRing } from "@/components/ui/ui";

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

const PROPERTY_TYPES = ["HOTEL", "APARTMENT", "VILLA", "HOSTEL", "BED_AND_BREAKFAST"];
const SORT_VALUES = ["recommended", "price_asc", "price_desc", "rating"];
const PAGE_SIZE = 24;

/** Mülk türü → `search.types.*` çeviri anahtarı. */
const TYPE_KEYS: Record<string, string> = {
  HOTEL: "hotel",
  APARTMENT: "apartment",
  VILLA: "villa",
  HOSTEL: "hostel",
  BED_AND_BREAKFAST: "bedAndBreakfast",
};

const smallInput = `w-full rounded-sm border border-gray-400 px-2 py-1 text-sm ${focusRing}`;
/** Mobilde 44px dokunma hedefi; masaüstünde mevcut yoğunluk korunur. */
const touchTarget = "min-h-[44px] lg:min-h-0";

/** URL'deki fiyat (ana birim) → sayı; geçersizse yok sayılır. */
function readPrice(value: string | null): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** Fiyat alanı metni → ana birim; boş → undefined, geçersiz → null. */
function draftToMajor(draft: string): number | undefined | null {
  if (draft.trim() === "") return undefined;
  const minor = parseAmountToMinor(draft);
  return minor === null ? null : minor / 100;
}

const priceKey = (v: number | undefined) => (v === undefined ? "" : String(v));

/** Kartların, esnek tarih notunun ve karşılaştırma çubuğunun kullandığı (istekteki) konaklama. */
interface StayContext {
  checkIn: string;
  checkOut: string;
  guests: number;
}

function SearchPageContent() {
  const t = useTranslations("search");
  const f = useFormat();
  const typeLabel = (type: string) => (TYPE_KEYS[type] ? t(`types.${TYPE_KEYS[type]}`) : type);
  const searchParams = useSearchParams();
  const router = useRouter();
  const { ids: compareIds } = useCompareSelection();
  const destination = searchParams.get("destination") || "";
  const checkIn = searchParams.get("checkIn") || "";
  const checkOut = searchParams.get("checkOut") || "";
  const guestsParam = Number(searchParams.get("guests"));
  const guests = guestsParam > 0 ? guestsParam : 2;
  const similarToPhotoId = searchParams.get("similarToPhotoId") || "";
  // P1-13(e): doğrulanmış erişilebilirlik filtresi URL'de tutulur (paylaşılabilir bağlantı).
  const accessibilityParam = parseAccessibilityParam(searchParams.get("accessibility")).codes.join(
    ","
  );
  // F66: tür, fiyat, sıralama, görünüm ve esneklik de URL'de tutulur (geri dönüş/yenileme).
  const rawType = searchParams.get("propertyType") || "";
  const typeParam = PROPERTY_TYPES.includes(rawType) ? rawType : "";
  const rawSort = searchParams.get("sort") || "";
  const sortParam = SORT_VALUES.includes(rawSort) ? rawSort : "recommended";
  const minParam = readPrice(searchParams.get("minPrice"));
  const maxParam = readPrice(searchParams.get("maxPrice"));
  const view: "list" | "map" = searchParams.get("view") === "map" ? "map" : "list";
  const rawFlex = Number(searchParams.get("flexDays"));
  const flexDays = FLEX_OPTIONS.includes(rawFlex as (typeof FLEX_OPTIONS)[number]) ? rawFlex : 0;

  /** Mevcut URL'yi koruyarak verilen parametreleri yazar (null/"" → siler). */
  const updateParams = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
      }
      router.replace(`/search?${next.toString()}`, { scroll: false });
    },
    [searchParams, router]
  );
  const setAccessibility = (codes: string[]) => updateParams({ accessibility: codes.join(",") });
  /** Mevcut aramayı koruyarak görsel kNN kaynağını değiştiren bağlantı (boş → kaldır). */
  const similarHref = (photoId: string) => {
    const next = new URLSearchParams(searchParams.toString());
    if (photoId) next.set("similarToPhotoId", photoId);
    else next.delete("similarToPhotoId");
    return `/search?${next.toString()}`;
  };

  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cached, setCached] = useState(false);
  const [visual, setVisual] = useState<SearchResponse["visual"]>(undefined);
  const [stay, setStay] = useState<StayContext>({ checkIn, checkOut, guests });

  const [smartFilters, setSmartFilters] = useState<SmartFilters | null>(null);
  const [llmMode, setLlmMode] = useState<string | null>(null);
  const [smartBusy, setSmartBusy] = useState(false);
  /** Harita ↔ liste senkronu: seçili mülk (işaretçi veya liste öğesi). */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  /** Mobilde filtre paneli varsayılan olarak kapalı (F142). */
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editRequest, setEditRequest] = useState(0);
  const editFocusRef = useRef<string | null>(null);
  const requestSeq = useRef(0);
  const pendingFocusId = useRef<string | null>(null);

  // F340: tek filtre durumu — akıllı filtrenin çıkardığı alan varsa o, yoksa paneldeki (URL) değer.
  const effType = smartFilters?.propertyType ?? typeParam;
  const effSort = smartFilters?.sort ?? sortParam;
  const effMin = smartFilters?.minPrice ?? minParam;
  const effMax = smartFilters?.maxPrice ?? maxParam;

  // F67 + F338: akıllı filtre URL'deki temel aramanın ÜZERİNE birleştirilir (tarih/misafir korunur).
  const requestKey = useMemo(() => {
    const p = new URLSearchParams();
    if (destination) {
      p.set("destination", destination);
      // pgvector semantik arama: sorgu-odaklı olduğunda daha iyi sıralar;
      // vektör katmanı yoksa servis otomatik olarak keyword yoluna döner.
      p.set("semantic", "1");
    }
    if (checkIn && checkOut) {
      p.set("checkIn", checkIn);
      p.set("checkOut", checkOut);
    }
    p.set("guests", String(guests));
    const s = smartFilters;
    if (s) {
      const smartDestination = s.city && s.query ? s.query : (s.city ?? s.query);
      if (smartDestination) {
        p.set("destination", smartDestination);
        p.delete("semantic");
      }
      if (s.city && s.query) p.set("city", s.city);
      if (s.guests) p.set("guests", String(s.guests));
      if (s.checkIn && s.checkOut) {
        p.set("checkIn", s.checkIn);
        p.set("checkOut", s.checkOut);
      }
      if (s.amenities.length > 0) p.set("amenities", s.amenities.join(","));
    }
    if (effType) p.set("propertyType", effType);
    // F8/F68: fiyat süzgeci sunucuda (tarih varsa vergi dahil toplam, yoksa gecelik fiyat).
    const priceOrderOk = effMin === undefined || effMax === undefined || effMin <= effMax;
    if (priceOrderOk && effMin !== undefined) p.set("minPrice", String(effMin));
    if (priceOrderOk && effMax !== undefined) p.set("maxPrice", String(effMax));
    if (effSort && effSort !== "recommended") p.set("sort", effSort);
    if (similarToPhotoId) p.set("similarToPhotoId", similarToPhotoId);
    if (accessibilityParam) p.set("accessibility", accessibilityParam);
    if (flexDays > 0 && p.get("checkIn") && p.get("checkOut")) {
      p.set("flexDays", String(flexDays));
    }
    return p.toString();
  }, [
    destination,
    checkIn,
    checkOut,
    guests,
    smartFilters,
    effType,
    effMin,
    effMax,
    effSort,
    similarToPhotoId,
    accessibilityParam,
    flexDays,
  ]);
  const requestParams = new URLSearchParams(requestKey);
  const effCheckIn = requestParams.get("checkIn") || "";
  const effCheckOut = requestParams.get("checkOut") || "";
  const effDestination = requestParams.get("destination") || requestParams.get("city") || "";
  const effGuests = Number(requestParams.get("guests")) || guests;
  const guestsDefaulted = !(guestsParam > 0) && !smartFilters?.guests;
  const hasDates = Boolean(effCheckIn && effCheckOut);

  const fetchPage = useCallback(
    (pageNumber: number) => {
      const params = new URLSearchParams(requestKey);
      params.set("page", String(pageNumber));
      params.set("pageSize", String(PAGE_SIZE));
      return apiFetch<SearchResponse>(`/api/search?${params.toString()}`, { cache: "no-store" });
    },
    [requestKey]
  );

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPage(1);
      if (seq !== requestSeq.current) return; // eski istek: daha yeni bir arama başladı
      const params = new URLSearchParams(requestKey);
      setResults(data.results);
      setTotal(data.total);
      setPage(1);
      setTotalPages(data.totalPages);
      setCached(data.cached);
      setVisual(data.visual);
      setStay({
        checkIn: params.get("checkIn") || "",
        checkOut: params.get("checkOut") || "",
        guests: Number(params.get("guests")) || 2,
      });
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setError(err instanceof Error ? err.message : t("errors.load"));
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [fetchPage, requestKey, t]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  // F140: "Daha fazla göster" — sonraki sayfa listeye eklenir, odak ilk yeni karta taşınır.
  const loadMore = async () => {
    if (loadingMore) return;
    const seq = requestSeq.current;
    setLoadingMore(true);
    setError(null);
    try {
      const data = await fetchPage(page + 1);
      if (seq !== requestSeq.current) return;
      const known = new Set(results.map((r) => r.id));
      const fresh = data.results.filter((r) => !known.has(r.id));
      pendingFocusId.current = fresh[0]?.id ?? null;
      setResults([...results, ...fresh]);
      setPage(data.page);
      setTotal(data.total);
      setTotalPages(data.totalPages);
    } catch (err) {
      if (seq === requestSeq.current) {
        setError(err instanceof Error ? err.message : t("errors.load"));
      }
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    const id = pendingFocusId.current;
    if (!id) return;
    pendingFocusId.current = null;
    document.getElementById(`result-${id}`)?.focus();
  }, [results]);

  // "Aramayı düzenle" bölümünü açıp istenen alana odaklanır (F141).
  const openEdit = (fieldId: string) => {
    editFocusRef.current = fieldId;
    setEditOpen(true);
    setEditRequest((n) => n + 1);
  };
  useEffect(() => {
    const id = editFocusRef.current;
    if (!id || editRequest === 0) return;
    editFocusRef.current = null;
    document.getElementById(id)?.focus();
  }, [editRequest]);

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

  /** Çip kaldırılınca panelle eşlenen alan URL'den de silinir (F340). */
  const onSmartChange = (next: SmartFilters) => {
    const patch: Record<string, string | null> = {};
    if (smartFilters?.sort !== undefined && next.sort === undefined) patch.sort = null;
    if (smartFilters?.propertyType !== undefined && next.propertyType === undefined) {
      patch.propertyType = null;
    }
    if (smartFilters?.minPrice !== undefined && next.minPrice === undefined) patch.minPrice = null;
    if (smartFilters?.maxPrice !== undefined && next.maxPrice === undefined) patch.maxPrice = null;
    if (Object.keys(patch).length > 0) updateParams(patch);
    setSmartFilters(next);
  };

  const setSort = (value: string) => {
    updateParams({ sort: value === "recommended" ? null : value });
    if (smartFilters?.sort !== undefined) setSmartFilters({ ...smartFilters, sort: value });
  };
  const setType = (value: string) => {
    updateParams({ propertyType: value || null });
    if (smartFilters?.propertyType !== undefined) {
      setSmartFilters({ ...smartFilters, propertyType: value || undefined });
    }
  };
  const applyPrice = useCallback(
    (min: number | undefined, max: number | undefined) => {
      updateParams({
        minPrice: min === undefined ? null : String(min),
        maxPrice: max === undefined ? null : String(max),
      });
      if (
        smartFilters &&
        (smartFilters.minPrice !== undefined || smartFilters.maxPrice !== undefined)
      ) {
        setSmartFilters({
          ...smartFilters,
          minPrice: smartFilters.minPrice !== undefined ? min : undefined,
          maxPrice: smartFilters.maxPrice !== undefined ? max : undefined,
        });
      }
    },
    [smartFilters, updateParams]
  );

  // Fiyat alanları: yazarken taslak tutulur, geçerli değer kısa bir beklemeden sonra uygulanır.
  const [minDraft, setMinDraft] = useState(priceKey(effMin));
  const [maxDraft, setMaxDraft] = useState(priceKey(effMax));
  const [seenMin, setSeenMin] = useState(priceKey(effMin));
  const [seenMax, setSeenMax] = useState(priceKey(effMax));
  if (seenMin !== priceKey(effMin)) {
    setSeenMin(priceKey(effMin));
    if (draftToMajor(minDraft) !== effMin) setMinDraft(priceKey(effMin));
  }
  if (seenMax !== priceKey(effMax)) {
    setSeenMax(priceKey(effMax));
    if (draftToMajor(maxDraft) !== effMax) setMaxDraft(priceKey(effMax));
  }
  const minValue = draftToMajor(minDraft);
  const maxValue = draftToMajor(maxDraft);
  const priceOrderError =
    typeof minValue === "number" && typeof maxValue === "number" && minValue > maxValue;
  useEffect(() => {
    if (minValue === null || maxValue === null || priceOrderError) return;
    if (minValue === effMin && maxValue === effMax) return;
    const timer = setTimeout(() => applyPrice(minValue, maxValue), 500);
    return () => clearTimeout(timer);
  }, [minValue, maxValue, priceOrderError, effMin, effMax, applyPrice]);

  const clearAllFilters = () => {
    updateParams({
      propertyType: null,
      minPrice: null,
      maxPrice: null,
      accessibility: null,
      similarToPhotoId: null,
      flexDays: null,
    });
    setSmartFilters(null);
    setLlmMode(null);
  };

  const activeFilterCount =
    (effType ? 1 : 0) +
    (effMin !== undefined || effMax !== undefined ? 1 : 0) +
    (accessibilityParam ? accessibilityParam.split(",").length : 0) +
    (flexDays > 0 ? 1 : 0);
  const hasActiveFilters =
    activeFilterCount > 0 || Boolean(smartFilters) || Boolean(similarToPhotoId);

  // Fiyat birimi: tüm sonuçlar aynı para birimindeyse lejantta gösterilir.
  const currencies = new Set(results.map((r) => r.quote?.currency ?? r.currency));
  const priceCurrency = currencies.size === 1 ? [...currencies][0] : null;
  const priceLegend = `${hasDates ? t("filters.priceTotal") : t("filters.pricePerNight")}${
    priceCurrency ? ` (${priceCurrency})` : ""
  }`;
  const priceSuffix = hasDates ? t("filters.suffixTotal") : t("filters.suffixNight");

  const mapPoints: MapPoint[] = results.flatMap((p) =>
    typeof p.location.latitude === "number" && typeof p.location.longitude === "number"
      ? [
          {
            id: p.id,
            title: p.title,
            city: p.location.city,
            latitude: p.location.latitude,
            longitude: p.location.longitude,
            // F346: kartla aynı bağlam — tarih varsa toplam, yoksa gecelik fiyat.
            priceLabel:
              p.quote && stay.checkIn && stay.checkOut
                ? t("mapPrice.total", { price: f.money(p.quote.total, p.quote.currency) })
                : t("mapPrice.perNight", { price: f.money(p.basePriceMinor, p.currency) }),
          },
        ]
      : []
  );
  const showMap = view === "map" && !mapError && mapPoints.length > 0;
  const remaining = Math.max(0, total - results.length);

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main id="main" className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <a
          href="#results"
          className={`sr-only font-medium text-blue-700 underline focus:not-sr-only focus:mb-4 focus:inline-block ${focusRing}`}
        >
          {t("skipToResults")}
        </a>
        <div className="mb-6 rounded-lg bg-white p-4 shadow-sm">
          <h1 className="text-xl font-bold text-gray-900">
            {effDestination
              ? t("heading.destination", { destination: effDestination })
              : t("heading.all")}
          </h1>
          <p className="mt-1 text-sm text-gray-700">
            {hasDates ? `${f.date(effCheckIn)} - ${f.date(effCheckOut)} · ` : ""}
            {guestsDefaulted
              ? t("guestCountDefault", { count: effGuests })
              : t("guestCount", { count: effGuests })}
          </p>
          <EditSearch
            key={searchParams.toString()}
            open={editOpen}
            onOpenChange={setEditOpen}
            initial={{ destination, checkIn, checkOut, guests }}
            onSubmit={(values) => {
              const next = new URLSearchParams(searchParams.toString());
              const set = (k: string, v: string) => (v ? next.set(k, v) : next.delete(k));
              set("destination", values.destination);
              set("checkIn", values.checkIn);
              set("checkOut", values.checkOut);
              set("guests", String(values.guests));
              setSmartFilters(null);
              setLlmMode(null);
              setEditOpen(false);
              router.push(`/search?${next.toString()}`);
            }}
          />
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
            onChange={onSmartChange}
            onClear={() => {
              setSmartFilters(null);
              setLlmMode(null);
            }}
          />
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-4">
          <aside className="lg:col-span-1">
            <Button
              variant="secondary"
              className={`mb-4 w-full lg:hidden ${touchTarget}`}
              aria-expanded={filtersOpen}
              aria-controls="search-filters"
              onClick={() => setFiltersOpen((o) => !o)}
            >
              {t("filters.toggle", { count: activeFilterCount })}
            </Button>
            <div
              id="search-filters"
              className={`${filtersOpen ? "" : "hidden"} rounded-lg bg-white p-4 shadow-sm lg:block`}
            >
              <h2 className="text-lg font-semibold text-gray-900">{t("filters.title")}</h2>

              <fieldset className="mt-4">
                <legend className="text-sm font-medium text-gray-800">{priceLegend}</legend>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <div>
                    <label htmlFor="price-min" className="text-xs text-gray-700">
                      {t("filters.minLabel")}
                    </label>
                    <input
                      id="price-min"
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      value={minDraft}
                      onChange={(e) => setMinDraft(e.target.value)}
                      aria-invalid={minValue === null || priceOrderError || undefined}
                      aria-describedby="price-hint price-error"
                      className={`${smallInput} ${touchTarget}`}
                    />
                  </div>
                  <div>
                    <label htmlFor="price-max" className="text-xs text-gray-700">
                      {t("filters.maxLabel")}
                    </label>
                    <input
                      id="price-max"
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      value={maxDraft}
                      onChange={(e) => setMaxDraft(e.target.value)}
                      aria-invalid={maxValue === null || priceOrderError || undefined}
                      aria-describedby="price-hint price-error"
                      className={`${smallInput} ${touchTarget}`}
                    />
                  </div>
                </div>
                <p id="price-hint" className="mt-1 text-xs text-gray-600">
                  {t("filters.priceHint", { unit: priceSuffix })}
                </p>
                <p id="price-error" aria-live="polite" className="mt-1 text-xs text-red-700">
                  {minValue === null || maxValue === null
                    ? t("filters.priceInvalid")
                    : priceOrderError
                      ? t("filters.priceOrder")
                      : ""}
                </p>
              </fieldset>

              <fieldset className="mt-4">
                <legend className="text-sm font-medium text-gray-800">{t("filters.type")}</legend>
                <div className="mt-2 space-y-2">
                  {["", ...PROPERTY_TYPES].map((type) => (
                    <label
                      key={type || "any"}
                      className={`flex items-center gap-2 text-sm text-gray-800 ${touchTarget}`}
                    >
                      <input
                        type="radio"
                        name="property-type"
                        value={type}
                        checked={effType === type}
                        onChange={() => setType(type)}
                        className={`h-4 w-4 border-gray-400 text-[#003580] ${focusRing}`}
                      />
                      {type ? typeLabel(type) : t("filters.anyType")}
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
                  value={effSort}
                  onChange={(e) => setSort(e.target.value)}
                  className={`mt-2 ${smallInput} ${touchTarget}`}
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
                  onChange={(e) => {
                    const d = Number(e.target.value);
                    updateParams({ flexDays: d > 0 ? String(d) : null });
                  }}
                  disabled={!hasDates}
                  aria-describedby={!hasDates ? "flex-days-hint" : undefined}
                  className={`mt-2 ${smallInput} ${touchTarget} disabled:bg-gray-100`}
                >
                  {FLEX_OPTIONS.map((d) => (
                    <option key={d} value={d}>
                      {d === 0 ? t("flex.exact") : t("flex.plusMinus", { days: d })}
                    </option>
                  ))}
                </select>
                {!hasDates && (
                  <p id="flex-days-hint" className="mt-1 text-xs text-gray-600">
                    {t("flex.needsDates")}{" "}
                    <button
                      type="button"
                      onClick={() => openEdit("edit-checkin")}
                      className={`font-medium text-blue-700 underline ${focusRing}`}
                    >
                      {t("flex.pickDates")}
                    </button>
                  </p>
                )}
              </div>

              {hasActiveFilters && (
                <Button
                  variant="secondary"
                  className={`mt-4 w-full ${touchTarget}`}
                  onClick={clearAllFilters}
                >
                  {t("filters.clearAll")}
                </Button>
              )}
            </div>
          </aside>

          <div id="results" tabIndex={-1} className="focus:outline-none lg:col-span-3">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <p aria-live="polite" className="text-sm text-gray-700">
                {loading ? t("loading") : t("resultCount", { shown: results.length, total })}
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
                        updateParams({ view: v === "map" ? "map" : null });
                        if (v === "map") setMapError(null);
                      }}
                      className={`px-3 py-1 text-sm ${touchTarget} ${
                        view === v
                          ? "bg-[#003580] font-semibold text-white underline underline-offset-4"
                          : "bg-white text-gray-800"
                      } ${focusRing}`}
                    >
                      {/* F143: seçili durum renge ek olarak işaret ve kalın/altı çizili yazıyla. */}
                      {view === v && (
                        <span aria-hidden="true" className="mr-1">
                          ✓
                        </span>
                      )}
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

            {!error && !loading && results.length === 0 && (
              <div className="rounded-lg bg-white p-12 text-center shadow-sm">
                <div role="status">
                  <p className="text-lg font-semibold text-gray-900">
                    {!hasActiveFilters && effDestination
                      ? t("noResultsDestination", { destination: effDestination })
                      : t("noResults")}
                  </p>
                  <p className="mt-2 text-sm text-gray-700">
                    {hasActiveFilters
                      ? t("noResultsFiltersHint")
                      : effDestination
                        ? t("noResultsDestinationHint")
                        : t("noResultsHint")}
                  </p>
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
                  {hasActiveFilters ? (
                    <Button variant="secondary" className={touchTarget} onClick={clearAllFilters}>
                      {t("filters.clearAll")}
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      className={touchTarget}
                      onClick={() => openEdit("edit-destination")}
                    >
                      {t("edit.toggle")}
                    </Button>
                  )}
                  {effDestination && (
                    <Link
                      href="/search"
                      className={`inline-flex items-center font-medium text-blue-700 underline ${touchTarget} ${focusRing}`}
                    >
                      {t("allStays")}
                    </Link>
                  )}
                </div>
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
                {results.map((property) => (
                  <div
                    key={property.id}
                    id={`result-${property.id}`}
                    tabIndex={-1}
                    className={focusRing}
                  >
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
                        // F352: teklifin hesaplandığı (istekteki) tarih ve misafir sayısı.
                        property.quote && stay.checkIn && stay.checkOut
                          ? {
                              total: property.quote.total,
                              nights: property.quote.nights,
                              checkIn: stay.checkIn,
                              checkOut: stay.checkOut,
                              guests: stay.guests,
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
                        guests={stay.guests}
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

            {!error && !loading && page < totalPages && remaining > 0 && (
              <div className="mt-6 flex justify-center">
                <Button
                  variant="secondary"
                  className={touchTarget}
                  busy={loadingMore}
                  onClick={() => void loadMore()}
                >
                  {loadingMore ? t("loading") : t("loadMore", { remaining })}
                </Button>
              </div>
            )}
          </div>
        </div>
        {/* F353: sabit karşılaştırma çubuğu son satırı/odaktaki öğeyi örtmesin. */}
        {compareIds.length > 0 && <div aria-hidden="true" className="h-24" />}
      </main>
      <CompareBar
        checkIn={stay.checkIn || undefined}
        checkOut={stay.checkOut || undefined}
        guests={stay.guests}
      />
      <Footer />
    </div>
  );
}

/** F141: sonuç sayfasında varış, tarih ve misafir sayısını düzenleme (URL'den dolu). */
function EditSearch({
  open,
  onOpenChange,
  initial,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: { destination: string; checkIn: string; checkOut: string; guests: number };
  onSubmit: (values: {
    destination: string;
    checkIn: string;
    checkOut: string;
    guests: number;
  }) => void;
}) {
  const t = useTranslations("search");
  const [destination, setDestination] = useState(initial.destination);
  const [checkIn, setCheckIn] = useState(initial.checkIn);
  const [checkOut, setCheckOut] = useState(initial.checkOut);
  const [guests, setGuests] = useState(String(initial.guests));
  const [error, setError] = useState<{ field: string; message: string } | null>(null);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    let next: { field: string; message: string } | null = null;
    if (Boolean(checkIn) !== Boolean(checkOut)) {
      next = {
        field: checkIn ? "edit-checkout" : "edit-checkin",
        message: t("edit.datesBoth"),
      };
    } else if (checkIn && checkOut && checkOut <= checkIn) {
      next = { field: "edit-checkout", message: t("edit.datesOrder") };
    }
    const guestCount = Number(guests);
    if (!next && !(Number.isInteger(guestCount) && guestCount >= 1 && guestCount <= 30)) {
      next = { field: "edit-guests", message: t("edit.guestsInvalid") };
    }
    setError(next);
    if (next) {
      document.getElementById(next.field)?.focus();
      return;
    }
    onSubmit({ destination: destination.trim(), checkIn, checkOut, guests: guestCount });
  };

  const fieldProps = (id: string) => ({
    id,
    "aria-invalid": error?.field === id || undefined,
    "aria-describedby": error?.field === id ? "edit-error" : undefined,
  });

  return (
    <details
      className="mt-3"
      open={open}
      onToggle={(e) => onOpenChange((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary
        className={`inline-flex min-h-[44px] cursor-pointer items-center text-sm font-medium text-blue-700 underline sm:min-h-0 ${focusRing}`}
      >
        {t("edit.toggle")}
      </summary>
      <form noValidate onSubmit={submit} className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-5">
        <div className="sm:col-span-2">
          <label htmlFor="edit-destination" className="text-sm font-medium text-gray-800">
            {t("edit.destination")}
          </label>
          <input
            {...fieldProps("edit-destination")}
            type="text"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder={t("autocomplete.placeholder")}
            autoComplete="off"
            className={`mt-1 ${smallInput} ${touchTarget}`}
          />
        </div>
        <div>
          <label htmlFor="edit-checkin" className="text-sm font-medium text-gray-800">
            {t("edit.checkIn")}
          </label>
          <input
            {...fieldProps("edit-checkin")}
            type="date"
            value={checkIn}
            onChange={(e) => setCheckIn(e.target.value)}
            className={`mt-1 ${smallInput} ${touchTarget}`}
          />
        </div>
        <div>
          <label htmlFor="edit-checkout" className="text-sm font-medium text-gray-800">
            {t("edit.checkOut")}
          </label>
          <input
            {...fieldProps("edit-checkout")}
            type="date"
            value={checkOut}
            min={checkIn || undefined}
            onChange={(e) => setCheckOut(e.target.value)}
            className={`mt-1 ${smallInput} ${touchTarget}`}
          />
        </div>
        <div>
          <label htmlFor="edit-guests" className="text-sm font-medium text-gray-800">
            {t("edit.guests")}
          </label>
          <input
            {...fieldProps("edit-guests")}
            type="number"
            inputMode="numeric"
            min={1}
            max={30}
            value={guests}
            onChange={(e) => setGuests(e.target.value)}
            className={`mt-1 ${smallInput} ${touchTarget}`}
          />
        </div>
        <p
          id="edit-error"
          aria-live="polite"
          className="text-sm text-red-700 sm:col-span-4 sm:self-center"
        >
          {error?.message ?? ""}
        </p>
        <Button type="submit" className={`sm:col-span-1 ${touchTarget}`}>
          {t("edit.submit")}
        </Button>
      </form>
    </details>
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
