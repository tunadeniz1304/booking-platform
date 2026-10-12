"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { useSessionUserCache } from "@/components/layout/useSessionUserCache";
import PropertyCard, { propertyHref, type SearchContext } from "@/components/property/PropertyCard";
import RankingWhy, { type RankingWeightsSet } from "@/components/search/RankingWhy";
import SmartFilter, { type SmartFilters } from "@/components/search/SmartFilter";
import SearchBar, { type SearchBarFocusField } from "@/components/search/SearchBar";
import CompareToggle from "@/components/compare/CompareToggle";
import CompareBar from "@/components/compare/CompareBar";
import AccessibilityFilter from "@/components/search/AccessibilityFilter";
import { SearchPageSkeleton, SearchResultSkeletons } from "@/components/search/SearchPageSkeleton";
import { parseAccessibilityParam } from "@/lib/compliance/accessibility-codes";
import { propertyTypeKey } from "@/lib/i18n/property-type";
import { usePlaceLabel } from "@/lib/i18n/use-place-label";
import type { MapPoint } from "@/components/search/ResultsMap";
import { ApiError, apiFetch } from "@/lib/api-client";
import { useFormat } from "@/i18n/use-format";
import { parseAmountToMinor } from "@/lib/ui/amount-input";
import {
  Button,
  ErrorText,
  focusRing,
  useErrorText,
  usePageHeadingFocus,
} from "@/components/ui/ui";

// Harita yalnızca istemcide ve yalnızca istenince yüklenir (maplibre ağır, SSR'siz).
const ResultsMap = dynamic(() => import("@/components/search/ResultsMap"), {
  ssr: false,
  loading: () => <MapLoading />,
});

/** Harita paketi yüklenirken gösterilen yer tutucu (çeviri için hook kullanır). */
function MapLoading() {
  const t = useTranslations("search");
  return (
    <p role="status" className="text-sm text-gray-600">
      {t("mapLoading")}
    </p>
  );
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
  /** "Önerilen" sıralamada kullanılan ağırlık kümesi ("Bu sıralama neden?" notu, F336). */
  weightsSet?: RankingWeightsSet;
}

/** F1361: sayfa yalnızca filtreyi kullanır; sonuçlar URL'deki aramayla birleşik GET'ten gelir. */
interface SmartResponse {
  filters: SmartFilters;
  llmMode: string;
}

const PROPERTY_TYPES = ["HOTEL", "APARTMENT", "VILLA", "HOSTEL", "BED_AND_BREAKFAST"];
const SORT_VALUES = ["recommended", "price_asc", "price_desc", "rating"];
const PAGE_SIZE = 24;
/** F2-17: URL'den geri yüklenecek en fazla "Daha fazla göster" sayfası. */
const MAX_RESTORED_PAGES = 10;
/** F2-17: ilana gidilen kartın id'si (dönüşte kaydırma + odak). */
const LAST_RESULT_KEY = "search:lastResult";

/** iOS Safari 16px altı alanda odakta sayfayı büyütür; küçük ekranda `text-base` (F424). */
const smallInput = `w-full rounded-sm border border-gray-500 px-2 py-1 text-base sm:text-sm ${focusRing}`;
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

/** Harita yan listesi öğesi: işaretçi verisine ek olarak puan ve tam bağlamlı ilan bağlantısı. */
interface MapListItem extends MapPoint {
  href: string;
  rating: number;
  reviewCount: number;
}

/** Arama hatası: `fields` doluysa geçersiz URL parametresi (VALIDATION_ERROR). */
interface SearchError {
  text: string;
  fields: string[] | null;
}

/** Sunucunun doğruladığı arama parametresi → `search.*` etiket anahtarı. */
const PARAM_LABEL_KEYS: Record<string, string> = {
  destination: "edit.destination",
  city: "edit.destination",
  checkIn: "edit.checkIn",
  checkOut: "edit.checkOut",
  guests: "edit.guests",
  minPrice: "filters.price",
  maxPrice: "filters.price",
  propertyType: "filters.type",
  sort: "filters.sort",
  flexDays: "flex.label",
};

/** Geçersiz parametre → "Aramayı düzenle" çubuğunda odaklanacak alan (F2-05). */
const PARAM_EDIT_FIELDS: Record<string, SearchBarFocusField> = {
  destination: "destination",
  city: "destination",
  checkIn: "dates",
  checkOut: "dates",
  guests: "guests",
};

/** ZodError.flatten() ayrıntısından geçersiz alan adları. */
function invalidParamNames(details: unknown): string[] {
  if (!details || typeof details !== "object") return [];
  const fieldErrors = (details as { fieldErrors?: unknown }).fieldErrors;
  return fieldErrors && typeof fieldErrors === "object" ? Object.keys(fieldErrors) : [];
}

function SearchPageContent() {
  const t = useTranslations("search");
  const f = useFormat();
  const tA11y = useTranslations("compliance.accessibility");
  // F2-18: görünen şehir/ülke adları arayüz dilinde (API'ye giden değerler değişmez).
  const placeLabel = usePlaceLabel();
  // F967: teknik durum ayrıntıları (önbellek, görsel arama nedeni) yalnızca yöneticiye gösterilir.
  const isAdmin = useSessionUserCache()?.role === "ADMIN";
  // F429: sayfa kendi `main` öğesini kurar; istemci tarafı gezinmede odak h1'e taşınır.
  const h1Ref = usePageHeadingFocus();
  const typeLabel = (type: string) => {
    const key = propertyTypeKey(type);
    return key ? t(`types.${key}`) : type;
  };
  const searchParams = useSearchParams();
  const router = useRouter();
  const destination = searchParams.get("destination") || "";
  const checkIn = searchParams.get("checkIn") || "";
  const checkOut = searchParams.get("checkOut") || "";
  const guestsParam = Number(searchParams.get("guests"));
  const guests = guestsParam > 0 ? guestsParam : 2;
  // F360: ana sayfa arama çubuğunun yetişkin/çocuk dağılımı (toplamla tutarlıysa taşınır).
  const adultsParam = Number(searchParams.get("adults"));
  const childrenParam = Number(searchParams.get("children") ?? 0);
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
  // F2-06: akıllı filtre sonucu da URL'de (city/amenities + çipler için smart/smartKeys).
  const cityParam = searchParams.get("city") || "";
  const amenitiesParam = searchParams.get("amenities") || "";
  const smartText = searchParams.get("smart") || "";
  const smartKeysParam = searchParams.get("smartKeys") || "";
  // F2-17: yüklenmiş "Daha fazla göster" sayfa sayısı.
  const rawPages = Number(searchParams.get("pages"));
  const pagesParam =
    Number.isInteger(rawPages) && rawPages > 1 ? Math.min(rawPages, MAX_RESTORED_PAGES) : 1;

  /**
   * Mevcut URL'yi koruyarak verilen parametreleri yazar (null/"" → siler). Arama değişince
   * yüklenen sayfa sayısı sıfırlanır (görünüm değişimi hariç).
   */
  const updateParams = useCallback(
    (patch: Record<string, string | null>, mode: "replace" | "push" = "replace") => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
      }
      if (!("pages" in patch) && !("view" in patch)) next.delete("pages");
      const url = `/search?${next.toString()}`;
      if (mode === "push") router.push(url, { scroll: false });
      else router.replace(url, { scroll: false });
    },
    [searchParams, router]
  );
  const setAccessibility = (codes: string[]) => updateParams({ accessibility: codes.join(",") });
  /** Mevcut aramayı koruyarak görsel kNN kaynağını değiştiren bağlantı (boş → kaldır). */
  const similarHref = (photoId: string) => {
    const next = new URLSearchParams(searchParams.toString());
    if (photoId) next.set("similarToPhotoId", photoId);
    else next.delete("similarToPhotoId");
    next.delete("pages"); // F2-17: yeni görsel arama ilk sayfadan başlar
    return `/search?${next.toString()}`;
  };

  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<SearchError | null>(null);
  /** "Daha fazla göster" hatası: yüklü sonuçlar gizlenmez, düğmenin yanında gösterilir. */
  const [moreError, setMoreError] = useState<string | null>(null);
  const [cached, setCached] = useState(false);
  const [visual, setVisual] = useState<SearchResponse["visual"]>(undefined);
  const [weightsSet, setWeightsSet] = useState<RankingWeightsSet | undefined>(undefined);
  const [stay, setStay] = useState<StayContext>({ checkIn, checkOut, guests });

  // F2-06: çipler URL'den türetilir; başlık, form ve "Sonuçlara dön" aynı aramayı gösterir.
  const smartFilters = useMemo<SmartFilters | null>(() => {
    if (!smartText) return null;
    const keys = new Set(smartKeysParam.split(",").filter(Boolean));
    const out: SmartFilters = { amenities: [] };
    if (keys.has("city") && (cityParam || destination)) out.city = cityParam || destination;
    if (keys.has("query") && destination) out.query = destination;
    if (keys.has("guests") && guestsParam > 0) out.guests = guestsParam;
    if (keys.has("checkIn") && checkIn && checkOut) {
      out.checkIn = checkIn;
      out.checkOut = checkOut;
    }
    if (keys.has("propertyType") && typeParam) out.propertyType = typeParam;
    if (keys.has("minPrice") && minParam !== undefined) out.minPrice = minParam;
    if (keys.has("maxPrice") && maxParam !== undefined) out.maxPrice = maxParam;
    if (keys.has("sort") && rawSort) out.sort = sortParam;
    if (keys.has("amenities") && amenitiesParam) {
      out.amenities = amenitiesParam.split(",").filter(Boolean);
    }
    return out;
  }, [
    smartText,
    smartKeysParam,
    cityParam,
    destination,
    guestsParam,
    checkIn,
    checkOut,
    typeParam,
    minParam,
    maxParam,
    rawSort,
    sortParam,
    amenitiesParam,
  ]);
  const [llmMode, setLlmMode] = useState<string | null>(null);
  const [smartBusy, setSmartBusy] = useState(false);
  /** F961: akıllı filtre hatası arama hatasından ayrı; mevcut sonuçlar gizlenmez. */
  const [smartError, setSmartError] = useState<string | null>(null);
  const lastSmartText = useRef("");
  /** Harita ↔ liste senkronu: seçili mülk (işaretçi veya liste öğesi). */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  /** Mobilde filtre paneli varsayılan olarak kapalı (F142). */
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editFocus, setEditFocus] = useState<{ field: SearchBarFocusField; seq: number }>({
    field: "destination",
    seq: 0,
  });
  const requestSeq = useRef(0);
  const pendingFocusId = useRef<string | null>(null);

  // F340 + F2-06: tek filtre durumu URL'dir; akıllı filtre sonucu da URL'ye yazılır.
  const effType = typeParam;
  const effSort = sortParam;
  const effMin = minParam;
  const effMax = maxParam;
  const smartDestination = Boolean(smartFilters?.city || smartFilters?.query);

  const requestKey = useMemo(() => {
    const p = new URLSearchParams();
    if (destination) {
      p.set("destination", destination);
      // pgvector semantik arama: sorgu-odaklı olduğunda daha iyi sıralar;
      // vektör katmanı yoksa servis otomatik olarak keyword yoluna döner.
      // Akıllı filtrenin çıkardığı varış yeri anahtar kelimeyle aranır.
      if (!smartDestination) p.set("semantic", "1");
    }
    if (cityParam && cityParam !== destination) p.set("city", cityParam);
    if (checkIn && checkOut) {
      p.set("checkIn", checkIn);
      p.set("checkOut", checkOut);
    }
    p.set("guests", String(guests));
    if (amenitiesParam) p.set("amenities", amenitiesParam);
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
    smartDestination,
    cityParam,
    checkIn,
    checkOut,
    guests,
    amenitiesParam,
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
  const guestsDefaulted = !(guestsParam > 0);
  const destinationLabel = effDestination ? placeLabel.city(effDestination) : "";
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

  // F960: hata metni arayüz dilinde; geçersiz bağlantı parametresi alan adıyla bildirilir.
  const errorText = useErrorText();
  const toSearchError = useCallback(
    (err: unknown): SearchError =>
      err instanceof ApiError && err.code === "VALIDATION_ERROR"
        ? { text: t("errors.invalidParams"), fields: invalidParamNames(err.details) }
        : { text: errorText(err, t("errors.load")), fields: null },
    [errorText, t]
  );

  // F2-17: URL'deki sayfa sayısı yükleme anında okunur; "Daha fazla göster" URL'yi güncelleyince
  // arama yeniden yüklenmez (efekt, aşağıdaki yükleme efektinden önce çalışır).
  const pagesRef = useRef(pagesParam);
  useEffect(() => {
    pagesRef.current = pagesParam;
  }, [pagesParam]);

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    setMoreError(null);
    try {
      const pageCount = pagesRef.current;
      const pages = await Promise.all(
        Array.from({ length: pageCount }, (_, i) => fetchPage(i + 1))
      );
      if (seq !== requestSeq.current) return; // eski istek: daha yeni bir arama başladı
      const data = pages[pages.length - 1];
      // Sayfalar arasında kayan (yinelenen) sonuçlar bir kez gösterilir.
      const byId = new Map<string, SearchResultItem>();
      for (const r of pages.flatMap((p) => p.results)) if (!byId.has(r.id)) byId.set(r.id, r);
      const merged = [...byId.values()];
      const params = new URLSearchParams(requestKey);
      setResults(merged);
      setTotal(data.total);
      setPage(Math.max(1, Math.min(pageCount, data.totalPages)));
      setTotalPages(data.totalPages);
      setCached(data.cached);
      setVisual(data.visual);
      setWeightsSet(data.weightsSet);
      setStay({
        checkIn: params.get("checkIn") || "",
        checkOut: params.get("checkOut") || "",
        guests: Number(params.get("guests")) || 2,
      });
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setError(toSearchError(err));
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [fetchPage, requestKey, toSearchError]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  // F140: "Daha fazla göster" — sonraki sayfa listeye eklenir, odak ilk yeni karta taşınır.
  const loadMore = async () => {
    if (loadingMore) return;
    const seq = requestSeq.current;
    setLoadingMore(true);
    setMoreError(null);
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
      // F2-17: yüklenen sayfa sayısı URL'de; ilandan dönünce aynı liste geri yüklenir.
      pagesRef.current = data.page;
      updateParams({ pages: data.page > 1 ? String(data.page) : null });
    } catch (err) {
      if (seq === requestSeq.current) setMoreError(errorText(err, t("errors.load")));
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

  // F2-17: ilandan dönüşte tıklanan kart görünür yapılır ve odaklanır (sonuçlar yüklenince bir kez).
  const restoreDone = useRef(false);
  useEffect(() => {
    if (restoreDone.current || loading) return;
    restoreDone.current = true;
    let id: string | null = null;
    try {
      const raw = window.sessionStorage.getItem(LAST_RESULT_KEY);
      if (raw) window.sessionStorage.removeItem(LAST_RESULT_KEY);
      // Yalnızca aynı aramaya dönüşte geri yüklenir; başka arama saklanan kartı atlar.
      const saved = raw ? (JSON.parse(raw) as { id?: unknown; query?: unknown }) : null;
      if (saved && typeof saved.id === "string" && saved.query === searchParams.toString()) {
        id = saved.id;
      }
    } catch {
      return; // depolama kapalı ya da bozuk kayıt: geri yükleme yapılmaz
    }
    if (!id) return;
    const el = document.getElementById(`result-${id}`);
    if (!el) return;
    el.scrollIntoView({ block: "center" });
    el.focus({ preventScroll: true });
  }, [loading, results, searchParams]);
  /** Karttan ilana gidilirken kartın id'si saklanır (tıklama yakalama aşamasında). */
  const rememberResult = (id: string) => (e: React.MouseEvent) => {
    // Yeni sekmede açma (değiştirici tuş) bu sekmeden ayrılmaz; konum saklanmaz.
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    // Yalnızca ilan bağlantısı; aynı sayfadaki "Benzerlerini göster" saklanmaz.
    const a = (e.target as HTMLElement).closest("a");
    if (!a || !a.pathname.startsWith("/property/")) return;
    try {
      window.sessionStorage.setItem(
        LAST_RESULT_KEY,
        JSON.stringify({ id, query: searchParams.toString() })
      );
    } catch {
      // depolama kapalı: dönüşte konum geri yüklenmez
    }
  };

  // "Aramayı düzenle" bölümünü açıp istenen alana odaklanır (F141, F2-05: arama çubuğu).
  const openEdit = (field: SearchBarFocusField) => {
    setEditOpen(true);
    setEditFocus((prev) => ({ field, seq: prev.seq + 1 }));
  };

  // F2-06: akıllı filtre sonucu URL'ye yazılır (geri tuşu önceki aramaya döner).
  const runSmart = async (text: string) => {
    if (smartBusy) return;
    lastSmartText.current = text;
    setSmartBusy(true);
    setSmartError(null);
    try {
      const data = await apiFetch<SmartResponse>("/api/search/smart", {
        method: "POST",
        // F1361: sonuç istenmez (birleşik arama ayrıca yapılır); bilmeyen sunucu alanı yok sayar.
        body: JSON.stringify({ text, filtersOnly: true }),
      });
      setLlmMode(data.llmMode);
      const s = data.filters;
      const amenities = s.amenities ?? [];
      const keys: string[] = [];
      // Önceki akıllı filtrenin panelde karşılığı olmayan alanları (şehir, olanak) taşınmaz.
      const patch: Record<string, string | null> = {
        smart: text,
        city: null,
        amenities: amenities.length > 0 ? amenities.join(",") : null,
      };
      if (s.city || s.query) {
        patch.destination = s.query ?? s.city ?? null;
        if (s.city && s.query) patch.city = s.city;
        if (s.city) keys.push("city");
        if (s.query) keys.push("query");
      }
      if (s.guests) {
        patch.guests = String(s.guests);
        // Yetişkin/çocuk dağılımı yeni toplamla tutmaz.
        patch.adults = null;
        patch.children = null;
        keys.push("guests");
      }
      if (s.checkIn && s.checkOut) {
        patch.checkIn = s.checkIn;
        patch.checkOut = s.checkOut;
        keys.push("checkIn");
      }
      if (s.propertyType) {
        patch.propertyType = s.propertyType;
        keys.push("propertyType");
      }
      if (s.minPrice !== undefined) {
        patch.minPrice = String(s.minPrice);
        keys.push("minPrice");
      }
      if (s.maxPrice !== undefined) {
        patch.maxPrice = String(s.maxPrice);
        keys.push("maxPrice");
      }
      if (s.sort) {
        patch.sort = s.sort === "recommended" ? null : s.sort;
        keys.push("sort");
      }
      if (amenities.length > 0) keys.push("amenities");
      patch.smartKeys = keys.join(",");
      updateParams(patch, "push");
    } catch (err) {
      setSmartError(errorText(err, t("errors.smart")));
    } finally {
      setSmartBusy(false);
    }
  };
  /** Akıllı filtre kaldırılır: varış/tarih/misafir kalır, panelde karşılığı olmayan alanlar silinir. */
  const smartClearPatch = (): Record<string, string | null> => ({
    smart: null,
    smartKeys: null,
    city: null,
    amenities: null,
    // Şehir + serbest sorgu birlikte çıkarıldıysa varış yeri şehre döner.
    ...(smartFilters?.city && smartFilters.query ? { destination: smartFilters.city } : {}),
  });
  const clearSmart = () => {
    setLlmMode(null);
    setSmartError(null);
    if (smartFilters) updateParams(smartClearPatch());
  };

  /** Çip kaldırılınca karşılık gelen alan URL'den silinir (F340, F2-06). */
  const onSmartChange = (next: SmartFilters) => {
    if (!smartFilters) return;
    const prev = smartFilters;
    const patch: Record<string, string | null> = {};
    if (prev.city !== undefined && next.city === undefined) {
      patch.city = null;
      if (next.query === undefined) patch.destination = null;
    }
    if (prev.query !== undefined && next.query === undefined) {
      patch.destination = next.city ?? null;
      patch.city = null;
    }
    if (prev.guests !== undefined && next.guests === undefined) {
      patch.guests = null;
      patch.adults = null;
      patch.children = null;
    }
    // Giriş ya da çıkış çipi kaldırılınca tarih çifti birlikte kalkar (F2-06).
    const datesRemoved =
      (prev.checkIn !== undefined && next.checkIn === undefined) ||
      (prev.checkOut !== undefined && next.checkOut === undefined);
    if (datesRemoved) {
      patch.checkIn = null;
      patch.checkOut = null;
      patch.flexDays = null;
    }
    if (prev.propertyType !== undefined && next.propertyType === undefined) {
      patch.propertyType = null;
    }
    if (prev.minPrice !== undefined && next.minPrice === undefined) patch.minPrice = null;
    if (prev.maxPrice !== undefined && next.maxPrice === undefined) patch.maxPrice = null;
    if (prev.sort !== undefined && next.sort === undefined) patch.sort = null;
    if (next.amenities.join(",") !== prev.amenities.join(",")) {
      patch.amenities = next.amenities.length > 0 ? next.amenities.join(",") : null;
    }
    const keys = new Set(smartKeysParam.split(",").filter(Boolean));
    const keyOf: Record<string, unknown> = {
      city: next.city,
      query: next.query,
      guests: next.guests,
      checkIn: next.checkIn && next.checkOut ? next.checkIn : undefined,
      propertyType: next.propertyType,
      minPrice: next.minPrice,
      maxPrice: next.maxPrice,
      sort: next.sort,
      amenities: next.amenities.length > 0 ? next.amenities : undefined,
    };
    for (const key of [...keys]) if (keyOf[key] === undefined) keys.delete(key);
    patch.smartKeys = keys.size > 0 ? [...keys].join(",") : null;
    // Çip kalmadıysa akıllı filtre kapanır.
    if (keys.size === 0) patch.smart = null;
    updateParams(patch);
  };

  const setSort = (value: string) => updateParams({ sort: value === "recommended" ? null : value });
  const setType = (value: string) => updateParams({ propertyType: value || null });
  const applyPrice = useCallback(
    (min: number | undefined, max: number | undefined) => {
      updateParams({
        minPrice: min === undefined ? null : String(min),
        maxPrice: max === undefined ? null : String(max),
      });
    },
    [updateParams]
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
    setLlmMode(null);
    setSmartError(null);
    // Tek URL güncellemesi (iki ayrı replace aynı anlık görüntüden yazıp birbirini ezerdi).
    updateParams({
      ...(smartFilters ? smartClearPatch() : {}),
      propertyType: null,
      minPrice: null,
      maxPrice: null,
      accessibility: null,
      similarToPhotoId: null,
      flexDays: null,
    });
  };
  /** Boş durum eylemleri: kutu yüklemede kaybolacağı için odak önce sonuç bölümüne taşınır. */
  const recover = (action: () => void) => {
    document.getElementById("results")?.focus();
    action();
  };
  const accessibilityCodes = parseAccessibilityParam(accessibilityParam).codes;
  // F964: esneklik sonuç listesini değiştirmez; bulunan öneri sayısı sayım satırında duyurulur.
  const flexRequested = Number(requestParams.get("flexDays")) > 0;
  const flexFound = results.filter((r) => r.flexSuggestion).length;

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

  // F360: dağılım yalnızca teklifin hesaplandığı misafir sayısıyla tutarlıysa ilana taşınır.
  const party =
    Number.isInteger(adultsParam) &&
    Number.isInteger(childrenParam) &&
    adultsParam > 0 &&
    childrenParam >= 0 &&
    adultsParam + childrenParam === stay.guests
      ? { adults: adultsParam, children: childrenParam }
      : {};
  // F93/F205: teklif olmasa da kart ve harita bağlantıları tarih/misafir bağlamını taşır.
  // F918: `from` ilan sayfasındaki "Arama sonuçlarına dön" bağlantısı için bu aramanın sorgusu.
  const fromQuery = searchParams.toString();
  const searchContext: SearchContext = {
    checkIn: stay.checkIn || null,
    checkOut: stay.checkOut || null,
    guests: stay.guests,
    ...party,
    from: fromQuery,
  };

  const mapPoints: MapListItem[] = results.flatMap((p) => {
    if (typeof p.location.latitude !== "number" || typeof p.location.longitude !== "number") {
      return [];
    }
    const quote = p.quote && stay.checkIn && stay.checkOut ? p.quote : null;
    return [
      {
        id: p.id,
        title: p.title,
        city: placeLabel.city(p.location.city),
        latitude: p.location.latitude,
        longitude: p.location.longitude,
        // F346/F549: kartla aynı bağlam ve birim — tarih varsa "N gece toplam", yoksa gecelik.
        priceLabel: quote
          ? t("mapPrice.total", {
              price: f.money(quote.total, quote.currency),
              nights: quote.nights,
            })
          : t("mapPrice.perNight", { price: f.money(p.basePriceMinor, p.currency) }),
        // F552: liste ve açılır pencere bağlantısı kartla aynı arama bağlamını taşır.
        href: propertyHref(p.id, {
          ...searchContext,
          roomId: quote?.roomId,
          ratePlanId: quote?.ratePlanId,
        }),
        rating: p.ratingAvg,
        reviewCount: p.ratingCount,
      },
    ];
  });
  const showMap = view === "map" && !mapError && mapPoints.length > 0;
  // F1364: harita gösterilemiyorsa (yüklenemedi / konum yok) içerik ve seçili düğme listedir.
  const mapUnavailable =
    view === "map" && (Boolean(mapError) || (!loading && mapPoints.length === 0));
  const shownView = mapUnavailable ? "list" : view;
  // F1362: görsel aramanın referans ilanı (kapak fotoğrafı) sonuçlardaysa adı ve küçük resmi.
  const visualReference = similarToPhotoId
    ? results.find((r) => r.coverPhotoId === similarToPhotoId)
    : undefined;
  const referenceImage = visualReference?.images?.[0];
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
          <h1
            ref={h1Ref}
            tabIndex={-1}
            className="text-xl font-bold text-gray-900 focus:outline-none"
          >
            {destinationLabel
              ? t("heading.destination", { destination: destinationLabel })
              : t("heading.all")}
          </h1>
          <p className="mt-1 text-sm text-gray-700">
            {hasDates
              ? `${f.date(effCheckIn, "medium")} – ${f.date(effCheckOut, "medium")} · `
              : ""}
            {guestsDefaulted
              ? t("guestCountDefault", { count: effGuests })
              : t("guestCount", { count: effGuests })}
          </p>
          <EditSearch open={editOpen} onOpenChange={setEditOpen}>
            {/* F2-05: ana sayfadaki arama çubuğu (öneriler, takvim, yetişkin/çocuk); filtreler korunur. */}
            <SearchBar
              key={searchParams.toString()}
              initial={{
                destination,
                checkIn,
                checkOut,
                ...(Number.isInteger(adultsParam) &&
                Number.isInteger(childrenParam) &&
                adultsParam > 0 &&
                childrenParam >= 0 &&
                adultsParam + childrenParam === guests
                  ? { adults: adultsParam, children: childrenParam }
                  : { adults: guests, children: 0 }),
              }}
              preserveParams={searchParams.toString()}
              focusRequest={editFocus}
              onSubmitted={() => {
                setLlmMode(null);
                setSmartError(null);
                setEditOpen(false);
                h1Ref.current?.focus({ preventScroll: true });
              }}
            />
          </EditSearch>
          {similarToPhotoId && visual && (
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm" role="status">
              {/* İlan adı metinde yazılı; küçük resim yalnızca görsel hatırlatıcı (alt boş). */}
              {visual.applied && referenceImage && (
                <Image
                  src={referenceImage}
                  alt=""
                  width={64}
                  height={48}
                  className="h-12 w-16 rounded-sm object-cover"
                />
              )}
              <span className={visual.applied ? "text-gray-900" : "text-amber-800"}>
                {visual.applied
                  ? visualReference
                    ? t("visual.similarHeadingNamed", { title: visualReference.title })
                    : t("visual.similarHeading")
                  : isAdmin
                    ? t(`visual.reasons.${visual.reason ?? "LOAD_FAILED"}`)
                    : t("visual.unavailable")}
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

        {/* F965: akıllı filtre bir arama yer işareti (SmartFilter formu ayrıca role almaz). */}
        <div role="search" aria-label={t("smart.region")} className="mb-6">
          <SmartFilter
            filters={smartFilters}
            llmMode={llmMode}
            busy={smartBusy}
            priceCurrency={priceCurrency}
            // F979: "/ gece" eki yalnız tarihsiz aramada; SmartFilter'ın toplam dalı `mapPrice.total`
            // için gereken `nights` değerini vermediğinden tarihli aramada yalnız tutar gösterilir.
            pricesAreTotal={hasDates ? undefined : false}
            errorId={smartError ? "smart-filter-error" : undefined}
            onSubmit={runSmart}
            onChange={onSmartChange}
            onClear={clearSmart}
          />
          {smartError && (
            <div className="mt-2 flex flex-wrap items-center gap-3 rounded-md bg-amber-50 p-3 text-sm">
              <ErrorText id="smart-filter-error">
                {smartError} {t("errors.smartKept")}
              </ErrorText>
              <Button
                variant="secondary"
                className={touchTarget}
                busy={smartBusy}
                onClick={() => {
                  // Bu kutu yeniden denemede kapanır; odak metin alanına döner.
                  document.getElementById("smart-filter")?.focus();
                  void runSmart(lastSmartText.current);
                }}
              >
                {t("retry")}
              </Button>
            </div>
          )}
          {/* F551: akıllı filtreden sonra filtre panelini atlayıp sonuçlara geçiş. */}
          <a
            href="#results"
            className={`sr-only font-medium text-blue-700 underline focus:not-sr-only focus:mt-3 focus:inline-block ${focusRing}`}
          >
            {t("skipToResults")}
          </a>
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-4">
          <section aria-labelledby="filters-heading" className="lg:col-span-1">
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
              <h2 id="filters-heading" className="text-lg font-semibold text-gray-900">
                {t("filters.title")}
              </h2>

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
                      // F2-59: masaüstünde de satır en az 24px (16px radyo tıklanabilir etiketle büyür).
                      className="flex min-h-[44px] items-center gap-2 text-sm text-gray-800 lg:min-h-[24px]"
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

              <AccessibilityFilter selected={accessibilityCodes} onChange={setAccessibility} />

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
                {hasDates ? (
                  <label htmlFor="flex-days" className="text-sm font-medium text-gray-800">
                    {t("flex.label")}
                  </label>
                ) : (
                  <p className="text-sm font-medium text-gray-800">{t("flex.label")}</p>
                )}
                {/* F2-50: tarih yokken seçim kutusu yerine durum metni + "Tarih seç" (sessiz geri alma yok). */}
                {hasDates ? (
                  <select
                    id="flex-days"
                    value={flexDays}
                    onChange={(e) => {
                      const d = Number(e.target.value);
                      updateParams({ flexDays: d > 0 ? String(d) : null });
                    }}
                    aria-describedby="flex-days-desc"
                    className={`mt-2 ${smallInput} ${touchTarget}`}
                  >
                    {FLEX_OPTIONS.map((d) => (
                      <option key={d} value={d}>
                        {d === 0 ? t("flex.exact") : t("flex.plusMinus", { days: d })}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="mt-2 text-sm text-gray-800">{t("flex.exact")}</p>
                )}
                <p id="flex-days-desc" className="mt-1 text-xs text-gray-600">
                  {t("flex.hint")}
                </p>
                {!hasDates && (
                  <p id="flex-days-hint" className="mt-1 text-xs text-gray-600">
                    {t("flex.needsDates")}{" "}
                    <button
                      type="button"
                      onClick={() => openEdit("dates")}
                      className={`inline-flex min-h-[24px] items-center font-medium text-blue-700 underline ${focusRing}`}
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
              {/* F2-22: mobilde panel sonuçları aşağı iter; sayıyı gösterip panele kapatan düğme. */}
              <div
                className="sticky bottom-0 -mx-4 -mb-4 mt-4 rounded-b-lg border-t border-gray-200 bg-white p-4 lg:hidden"
                style={{ bottom: "var(--compare-bar-h, var(--cookie-banner-h, 0px))" }}
              >
                <Button
                  fullWidth
                  busy={loading}
                  className={touchTarget}
                  onClick={() => {
                    setFiltersOpen(false);
                    const resultsEl = document.getElementById("results");
                    resultsEl?.focus({ preventScroll: true });
                    resultsEl?.scrollIntoView({ block: "start" });
                  }}
                >
                  {loading ? t("loading") : t("filters.showResults", { total })}
                </Button>
              </div>
            </div>
          </section>

          <section
            id="results"
            tabIndex={-1}
            aria-labelledby="results-heading"
            className="focus:outline-none lg:col-span-3"
          >
            <h2 id="results-heading" className="sr-only">
              {t("resultsHeading")}
            </h2>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <p aria-live="polite" className="text-sm text-gray-700">
                {loading ? t("loading") : t("resultCount", { shown: results.length, total })}
                {!loading && !error && flexRequested && results.length > 0 && (
                  <>
                    {" · "}
                    {flexFound > 0 ? t("flex.found", { count: flexFound }) : t("flex.noneFound")}
                  </>
                )}
              </p>
              <div className="flex items-center gap-2">
                {cached && isAdmin && (
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800">
                    {t("cached")}
                  </span>
                )}
                <div
                  role="group"
                  aria-label={t("view")}
                  className="flex overflow-hidden rounded-md border border-gray-500"
                >
                  {(["list", "map"] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      aria-pressed={shownView === v}
                      aria-describedby={
                        v === "map" && mapUnavailable ? "map-unavailable-note" : undefined
                      }
                      onClick={() => {
                        updateParams({ view: v === "map" ? "map" : null });
                        if (v === "map") setMapError(null);
                      }}
                      className={`px-3 py-1 text-sm ${touchTarget} ${
                        shownView === v
                          ? "bg-[#003580] font-semibold text-white underline underline-offset-4"
                          : "bg-white text-gray-800"
                      } ${focusRing}`}
                    >
                      {/* F143: seçili durum renge ek olarak işaret ve kalın/altı çizili yazıyla. */}
                      {shownView === v && (
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

            {/* F376: tek kalıcı canlı bölge; içindeki notlar ayrıca rol almaz (iç içe bölge yok). */}
            <div aria-live="polite" className="text-sm">
              {view === "map" && mapError && (
                <div className="mb-4 flex flex-wrap items-center gap-3 rounded-md bg-amber-50 p-3">
                  <p id="map-unavailable-note" className="text-amber-950">
                    {t("mapFailed")}
                  </p>
                  {/* F710: yeniden deneme; kutu kapanınca odak sonuç bölümüne taşınır. */}
                  <Button
                    variant="secondary"
                    className={touchTarget}
                    onClick={() => {
                      document.getElementById("results")?.focus();
                      setMapError(null);
                    }}
                  >
                    {t("retry")}
                  </Button>
                </div>
              )}
              {view === "map" && !mapError && !loading && mapPoints.length === 0 && (
                <p
                  id="map-unavailable-note"
                  className="mb-4 rounded-md bg-gray-100 p-3 text-gray-800"
                >
                  {t("noLocation")}
                </p>
              )}
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 p-6 text-center shadow-sm">
                <ErrorText>
                  {error.text}
                  {error.fields && error.fields.length > 0 && (
                    <>
                      {" "}
                      {t("errors.invalidFields", {
                        fields: [
                          ...new Set(
                            error.fields.map((name) =>
                              PARAM_LABEL_KEYS[name] ? t(PARAM_LABEL_KEYS[name]) : name
                            )
                          ),
                        ].join(", "),
                      })}
                    </>
                  )}
                </ErrorText>
                <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
                  <Button
                    variant="secondary"
                    className={touchTarget}
                    onClick={() => {
                      // Hata kutusu kaybolacağı için odak sonuç bölümüne taşınır.
                      document.getElementById("results")?.focus();
                      void load();
                    }}
                  >
                    {t("retry")}
                  </Button>
                  {error.fields && (
                    <Button
                      variant="secondary"
                      className={touchTarget}
                      onClick={() =>
                        openEdit(
                          error.fields?.map((name) => PARAM_EDIT_FIELDS[name]).find(Boolean) ??
                            "destination"
                        )
                      }
                    >
                      {t("edit.toggle")}
                    </Button>
                  )}
                </div>
              </div>
            )}

            {!error && !loading && results.length === 0 && (
              <div className="rounded-lg bg-white p-12 text-center shadow-sm">
                <div role="status">
                  <p className="text-lg font-semibold text-gray-900">
                    {!hasActiveFilters && destinationLabel
                      ? t("noResultsDestination", { destination: destinationLabel })
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
                {/* F968: erişilebilirlik özellikleri (aynı odada AND) tek tek kaldırılabilir. */}
                {accessibilityCodes.length > 0 && (
                  <div className="mt-4">
                    <p id="empty-a11y-hint" className="text-sm text-gray-700">
                      {t("emptyA11y.hint")}
                    </p>
                    <ul
                      aria-labelledby="empty-a11y-hint"
                      className="mt-2 flex flex-wrap justify-center gap-2"
                    >
                      {accessibilityCodes.map((code) => {
                        const label = tA11y(`codes.${code}`);
                        return (
                          <li key={code}>
                            <button
                              type="button"
                              aria-label={t("smart.remove", { label })}
                              onClick={() =>
                                recover(() =>
                                  setAccessibility(accessibilityCodes.filter((c) => c !== code))
                                )
                              }
                              className={`inline-flex items-center gap-1 rounded-full border border-gray-500 bg-white px-3 py-1 text-sm text-gray-900 ${touchTarget} ${focusRing}`}
                            >
                              {label}
                              <span aria-hidden="true">×</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
                <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
                  {hasActiveFilters && (
                    <Button
                      variant="secondary"
                      className={touchTarget}
                      onClick={() => recover(clearAllFilters)}
                    >
                      {t("filters.clearAll")}
                    </Button>
                  )}
                  {/* F969/F970: tarih ya da varış yerini değiştirme her zaman sunulur. */}
                  <Button
                    variant="secondary"
                    className={touchTarget}
                    onClick={() => openEdit(hasDates ? "dates" : "destination")}
                  >
                    {t("edit.toggle")}
                  </Button>
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
                    searchContext={searchContext}
                    resultsListId="map-results-list"
                  />
                </div>
                <MapResultList
                  points={mapPoints}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                />
              </div>
            )}

            {/* F966: ilk yüklemede iskelet kartlar; yeniden yüklemede eski kartlar soluk/pasif. */}
            {!error && loading && results.length === 0 && <SearchResultSkeletons />}

            {!error && !showMap && results.length > 0 && (
              <ul
                role="list"
                aria-busy={loading || undefined}
                className={`grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3 ${
                  loading ? "pointer-events-none opacity-60" : ""
                }`}
              >
                {results.map((property) => (
                  <li
                    key={property.id}
                    id={`result-${property.id}`}
                    tabIndex={-1}
                    className={focusRing}
                    onClickCapture={rememberResult(property.id)}
                  >
                    <PropertyCard
                      id={property.id}
                      title={property.title}
                      location={placeLabel.place(property.location.city, property.location.country)}
                      // F973: fotoğraf yoksa stok görsel değil, kartın "fotoğraf yok" yer tutucusu.
                      imageUrl={property.images?.[0]}
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
                              ...party,
                              roomId: property.quote.roomId,
                              ratePlanId: property.quote.ratePlanId,
                            }
                          : undefined
                      }
                      searchContext={searchContext}
                    />
                    {property.flexSuggestion && (
                      <FlexSuggestionNote
                        propertyId={property.id}
                        title={property.title}
                        suggestion={property.flexSuggestion}
                        guests={stay.guests}
                        {...party}
                        from={fromQuery}
                      />
                    )}
                    <RankingWhy
                      score={property.score}
                      explain={property.explain}
                      weightsSet={weightsSet}
                      title={property.title}
                    />
                    <CompareToggle propertyId={property.id} title={property.title} />
                    {property.coverPhotoId && (
                      <Link
                        href={similarHref(property.coverPhotoId)}
                        // F972: kart dışındaki tekrarlanan bağlantı ilan adını taşır.
                        aria-label={t("visual.showSimilarCoverNamed", { title: property.title })}
                        className={`mt-1 inline-block text-sm font-medium text-blue-700 underline ${focusRing}`}
                      >
                        {t("visual.showSimilarCover")}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {!error && !loading && page < totalPages && remaining > 0 && (
              <div className="mt-6 flex flex-col items-center gap-2">
                {moreError && <ErrorText>{moreError}</ErrorText>}
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
          </section>
        </div>
      </main>
      <CompareBar
        checkIn={stay.checkIn || undefined}
        checkOut={stay.checkOut || undefined}
        guests={stay.guests}
        // F2-19: yetişkin/çocuk dağılımı karşılaştırma → ilan geçişinde kaybolmaz.
        adults={party.adults}
        childCount={party.children}
        // F675: karşılaştırmadaki "Aramaya dön" bu aramayı (filtreler dahil) geri yükler.
        from={fromQuery}
      />
      <Footer />
    </div>
  );
}

/** F141 + F2-05: sonuç sayfasında aramayı düzenleme bölümü (içerik ana sayfadaki arama çubuğu). */
function EditSearch({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) {
  const t = useTranslations("search");
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
      <div className="mt-3">{children}</div>
    </details>
  );
}

/** Harita görünümünün yan listesi: seçim haritayla iki yönlü senkron. */
function MapResultList({
  points,
  selectedId,
  onSelect,
}: {
  points: MapListItem[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const t = useTranslations("search");
  const f = useFormat();
  const itemRefs = useRef(new Map<string, HTMLLIElement>());
  useEffect(() => {
    if (selectedId) itemRefs.current.get(selectedId)?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  return (
    <div>
      {/* F974: seçim düğmesinin amacı (ilana gitmek için ayrı "İlanı gör" bağlantısı var). */}
      <p id="map-list-hint" className="sr-only">
        {t("mapList.selectHint")}
      </p>
      {/* F711: haritadaki "listeye geç" bağlantısının hedefi. */}
      <ul
        id="map-results-list"
        tabIndex={-1}
        aria-label={t("mapResults")}
        // F709: mobilde liste sayfayla akar; iç içe kaydırma alanı yalnız geniş ekranda.
        className={`space-y-2 overscroll-contain rounded-lg bg-white p-2 shadow-sm lg:max-h-[480px] lg:overflow-y-auto ${focusRing}`}
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
                aria-describedby="map-list-hint"
                onClick={() => onSelect(active ? null : p.id)}
                // F1367: seçili öğe renge ek olarak kalın kenarlık ve "✓ Seçili" metniyle ayrışır.
                className={`w-full rounded-md text-left text-sm ${
                  active
                    ? "border-2 border-[#003580] bg-amber-100 px-[11px] py-[7px] text-gray-900"
                    : "border border-gray-200 bg-white px-3 py-2 text-gray-900 hover:bg-gray-50"
                } ${focusRing}`}
              >
                <span id={`map-item-${p.id}`} className="block font-semibold">
                  {p.title}
                </span>
                <span className="block text-gray-700">
                  {p.city} · {p.priceLabel}
                </span>
                {/* F552: harita kullanamayanlar için puan da listede. */}
                <span className="block text-gray-700">
                  {p.reviewCount > 0
                    ? `${t("card.ratingLabel", {
                        value: f.number(p.rating, {
                          minimumFractionDigits: 1,
                          maximumFractionDigits: 1,
                        }),
                      })} · ${t("card.reviews", { count: p.reviewCount })}`
                    : t("card.noRating")}
                </span>
                {/* Durum ekran okuyucuya aria-pressed ile iletilir; metin yalnız görsel ipucu. */}
                {active && (
                  <span aria-hidden="true" className="mt-1 block font-semibold">
                    ✓ {t("mapList.selected")}
                  </span>
                )}
              </button>
              <Link
                href={p.href}
                aria-describedby={`map-item-${p.id}`}
                className={`ml-3 inline-flex items-center text-sm font-medium text-blue-700 underline ${touchTarget} ${focusRing}`}
              >
                {t("mapList.view")}
              </Link>
              {/* F715: harita görünümünden açılır pencereye gitmeden karşılaştırmaya ekleme. */}
              <CompareToggle propertyId={p.id} title={p.title} className="ml-3" />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Sayfa paketi/URL parametreleri hazırlanırken: rota yükleme ekranıyla aynı iskelet (F976). */
function SearchPageFallback() {
  const t = useTranslations("search");
  return <SearchPageSkeleton label={t("loading")} />;
}

export default function SearchPage() {
  return (
    <Suspense fallback={<SearchPageFallback />}>
      <SearchPageContent />
    </Suspense>
  );
}

/** P1-3: ±N gün önerisi — tutar metinle verilir (renk tek sinyal değil). */
function FlexSuggestionNote({
  propertyId,
  title,
  suggestion,
  guests,
  adults,
  children,
  from,
}: {
  propertyId: string;
  /** Bağlantının erişilebilir adına eklenen ilan adı (F972). */
  title?: string;
  suggestion: NonNullable<SearchResultItem["flexSuggestion"]>;
  guests: number;
  /** Aramadaki yetişkin/çocuk dağılımı (F360); ilan sayfasına taşınır. */
  adults?: number;
  children?: number;
  /** Arama sorgusu (F918); ilan sayfasındaki "Arama sonuçlarına dön" bağlantısı için. */
  from?: string;
}) {
  const t = useTranslations("search");
  const f = useFormat();
  const href = propertyHref(propertyId, {
    checkIn: suggestion.checkIn,
    checkOut: suggestion.checkOut,
    guests,
    adults,
    children,
    roomId: suggestion.roomId,
    ratePlanId: suggestion.ratePlanId,
    from,
  });
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
      <Link
        href={href}
        aria-label={title ? t("flex.viewNamed", { title }) : undefined}
        className={`font-medium text-blue-700 underline ${focusRing}`}
      >
        {t("flex.view")}
      </Link>
    </p>
  );
}
