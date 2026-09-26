import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { logger, errorFields } from "@/lib/observability/logger";
import {
  money,
  toDecimalString,
  assertCurrency,
  type CurrencyCode,
  minorFromDb,
  moneyFromDb,
} from "@/lib/money/money";
import { convert, type FxSnapshot } from "@/lib/money/fx";
import { getCurrentFx } from "@/lib/fx/store";
import { nightsFromInventory, priceStay } from "@/lib/pricing/quote";
import { checkRestrictions, type RestrictionRow } from "@/lib/booking/restrictions";
import { RANKING_WEIGHTS, RANKING_WEIGHTS_WITH_QUERY, rankResults } from "@/lib/search/ranking";
import { hybridSearch, type HybridHit } from "@/lib/search/hybrid";
import { coverPhotoIds, visualSearchStatus, type VisionStatus } from "@/lib/vision/visual-search";
import { rankWithLtr } from "@/lib/search/ltr";
import { addDays, fromDate, nightsBetween, toDbDate, type IsoDate } from "@/lib/time/nights";
import { computeAffinity, affinityBoostFor } from "@/lib/search/vector";
import { breakers, BreakerOpenError } from "@/lib/resilience/circuit-breaker";
import { taxRulesFor } from "@/lib/pricing/tax";
import { SearchParamsSchema, type SearchInput, type SearchParams } from "@/lib/search/params";
import { LISTABLE_PROPERTY } from "@/lib/compliance/listing";
import { accessibilityWhere } from "@/lib/search/accessibility-filter";
import { getConfig } from "@/lib/config/app-config";
import { pickFlexCandidates, type FlexRow } from "@/lib/search/flex";

export { SearchParamsSchema, searchParamsFromUrl } from "@/lib/search/params";
export type { SearchParams, SearchInput } from "@/lib/search/params";

/**
 * Arama (v3#7) — doğruluk öncelikli boru hattı:
 *
 *  0. **Hibrit aday havuzu** (P1-1, v3#19): serbest metin varsa sözcüksel + vektör +
 *     trigram kanalları RRF ile birleştirilir (`hybrid.ts`); SQL hatasında v2 alt-dize
 *     eşleşmesine düşülür.
 *  1. **Katalog adayları** (yapısal filtreler: metin, şehir, tip, olanaklar, kişi) —
 *     `catalog` sürümüyle önbelleklenir; yalnızca mülk oluşturma/güncellemede değişir.
 *  2. **Konaklama teklifleri** (tarih varsa): mülk başına `search:pq:<id>:v<sürüm>:…`
 *     önbelleği. Rezervasyon/envanter değişikliği yalnızca O mülkün sürümünü artırır
 *     (v2'de her rezervasyon global sürümü artırıyordu). Eksikler tek SQL ile hesaplanır:
 *     aralıktaki HER gece için yer olan oda tipleri (`HAVING count(*) = gece sayısı`),
 *     satış kısıtları (stop-sell, LOS, CTA/CTD) ve en ucuz plan fiyatı (`priceStay`).
 *  3. **Fiyat filtresi** GÖRÜNTÜ para birimindeki vergi dahil toplam üzerinden (tarih yoksa
 *     gecelik taban fiyat) — kart üzerindeki fiyatla aynı sayı.
 *  4. **Sıralama + sayfalama** filtrelenmiş kümenin TAMAMI üzerinde (v2'de "Önerilen"
 *     yalnızca ilk 200 satırı sıralarken `total` hepsini sayıyordu → son sayfalar boştu).
 *
 * Sonuç sayfaları önbelleklenmez (v2'de semantik sonuçlar yazılıyor ama hiç okunmuyordu).
 */

const CATALOG_TTL = 60 * 5;
const QUOTE_TTL = 60 * 5;
const POPULAR_CACHE_TTL = 60 * 15;
const POPULAR_CACHE_KEY = "search:popular";
const CATALOG_VERSION_KEY = "search:catalog:version";
const PROPERTY_VERSION_PREFIX = "search:pv:";
/** Aday havuzu için güvenlik sınırı (demo verisinde birkaç yüz mülk). */
const MAX_CANDIDATES = 5000;

export interface SearchQuote {
  roomId: string;
  ratePlanId: string;
  /** Mülk para biriminde, vergi dahil toplam (minor-unit). */
  total: number;
  currency: string;
  nights: number;
}

export interface SearchResult {
  id: string;
  title: string;
  description: string;
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
  /** Görüntüleme (ana birim, mülk para birimi); tahsilat için `quote.total` (minor-unit). */
  totalPrice?: number;
  /** Seçilen tarihler için en ucuz uygun oda tipi + planın vergi dahil toplamı. */
  quote?: SearchQuote;
  /** Görüntü para birimindeki karşılık (fiyat filtresi bu sayı üzerinden uygulanır). */
  display?: { amount: number; currency: string };
  score?: number;
  explain?: Record<string, number>;
  /** P1-10: "benzerlerini göster" için kapak fotoğrafı (görsel arama açıksa ve embedding varsa). */
  coverPhotoId?: string;
  /**
   * P1-3 esnek tarih (`flexDays` > 0): aynı gece sayısıyla ±N gün içinde daha ucuz tarih.
   * Tutar teklif motoruyla kesin hesaplanır (aynı misafir sayısı; mülk para birimi, minor-unit).
   */
  flexSuggestion?: FlexSuggestion;
}

export interface FlexSuggestion {
  checkIn: IsoDate;
  checkOut: IsoDate;
  /** Girişin asıl tarihe göre kaydırılması (gün; negatif = daha erken). */
  shiftDays: number;
  roomId: string;
  ratePlanId: string;
  total: number;
  /** Asıl tarihlerdeki toplamdan fark (minor-unit, > 0). */
  savings: number;
  currency: string;
  /** Görüntü para birimindeki karşılıklar (ana birim). */
  display: { total: number; savings: number; currency: string };
}

/** Sıralayıcı seçimi (P1-3 deneyi): "weighted" v2 davranışı, "ltr" ONNX modeli. */
export type RankingMode = "weighted" | "ltr";

export interface SearchOptions {
  ranking?: RankingMode;
}

export interface SearchResponse {
  results: SearchResult[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  cached: boolean;
  /** Hibrit (RRF) aday havuzu kullanıldı. */
  semantic?: boolean;
  /** "Önerilen" sıralamada gerçekte kullanılan sıralayıcı. */
  ranking?: RankingMode;
  /** P1-10: görsel arama durumu (açıksa veya `similarToPhotoId` istendiyse). */
  visual?: VisionStatus & { applied: boolean };
  /** P1-3: uygulanan esnek tarih penceresi (±gün); yalnız tarihli ve `flexDays` > 0 aramada. */
  flex?: { days: number };
}

interface CatalogRoom {
  id: string;
  maxOccupancy: number;
  priceModifierMinor: number;
}

interface CatalogEntry {
  id: string;
  title: string;
  description: string;
  propertyType: string;
  basePriceMinor: number;
  currency: string;
  ratingAvg: number;
  ratingCount: number;
  locationId: string;
  location: SearchResult["location"];
  amenities: string[];
  images: string[];
  rooms: CatalogRoom[];
}

// --- Önbellek sürümleri -------------------------------------------------------------

async function getVersion(key: string): Promise<string> {
  try {
    return (await redis.get(key)) ?? "0";
  } catch {
    return "0";
  }
}

function hashKey(value: unknown): string {
  return createHash("sha1").update(JSON.stringify(value)).digest("hex").slice(0, 20);
}

/** Katalog (mülk ekleme/düzenleme) değişti: yapısal aday önbelleği geçersiz. */
export async function invalidateSearchCache(): Promise<void> {
  try {
    await redis.incr(CATALOG_VERSION_KEY);
  } catch (error) {
    logger.warn(errorFields(error), "search catalog invalidation failed");
  }
}

/**
 * Tek mülkün müsaitlik/fiyatı değişti (rezervasyon, iptal, ARI): YALNIZCA o mülkün sürümü
 * artar; diğer mülklerin önbellekleri korunur.
 */
export async function invalidatePropertySearchCache(propertyId: string): Promise<void> {
  try {
    await redis.incr(`${PROPERTY_VERSION_PREFIX}${propertyId}`);
    await redis.del(`property:${propertyId}`);
  } catch (error) {
    logger.warn(errorFields(error), "property cache invalidation failed");
  }
}

// --- 1) Katalog adayları -------------------------------------------------------------

function structuralWhere(params: SearchParams, ids?: string[]): Prisma.PropertyWhereInput {
  const and: Prisma.PropertyWhereInput[] = [{ ...LISTABLE_PROPERTY }];
  if (ids) and.push({ id: { in: ids } });
  if (params.query && !ids) {
    and.push({
      OR: [
        { title: { contains: params.query, mode: "insensitive" } },
        { description: { contains: params.query, mode: "insensitive" } },
        { location: { city: { contains: params.query, mode: "insensitive" } } },
        { location: { country: { contains: params.query, mode: "insensitive" } } },
      ],
    });
  }
  if (params.city) and.push({ location: { city: { equals: params.city, mode: "insensitive" } } });
  if (params.country) {
    and.push({ location: { country: { equals: params.country, mode: "insensitive" } } });
  }
  if (params.propertyType) {
    and.push({ propertyType: params.propertyType as Prisma.PropertyWhereInput["propertyType"] });
  }
  // Seçilen TÜM olanaklar bulunmalı (v2'de "herhangi biri" yeterliydi).
  for (const name of params.amenities ?? []) and.push({ amenities: { some: { name } } });
  // P1-13(e): yalnız doğrulanmış erişilebilirlik özellikleri (AND, aynı oda tipinde).
  const a11y = accessibilityWhere([...(params.accessibility ?? [])].sort(), params.guests);
  if (a11y) and.push(a11y);
  and.push({
    rooms: {
      some: {
        available: true,
        ...(params.guests ? { maxOccupancy: { gte: params.guests } } : {}),
      },
    },
  });
  return { AND: and };
}

async function loadCatalog(params: SearchParams, ids?: string[]): Promise<CatalogEntry[]> {
  const structural = {
    q: ids ? "" : (params.query ?? "").trim().toLowerCase(),
    city: (params.city ?? "").trim().toLowerCase(),
    country: (params.country ?? "").trim().toLowerCase(),
    type: params.propertyType ?? "",
    amenities: [...(params.amenities ?? [])].sort(),
    ...(params.accessibility?.length ? { a11y: [...params.accessibility].sort() } : {}),
    guests: params.guests ?? 0,
    ids: ids ? [...ids].sort() : null,
  };
  const key = `search:cat2:v${await getVersion(CATALOG_VERSION_KEY)}:${hashKey(structural)}`;
  try {
    const cached = await redis.get(key);
    if (cached) return JSON.parse(cached) as CatalogEntry[];
  } catch (error) {
    logger.warn(errorFields(error), "catalog cache read failed");
  }
  const rows = await prisma.property.findMany({
    where: structuralWhere(params, ids),
    take: MAX_CANDIDATES,
    orderBy: { id: "asc" },
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
      location: {
        select: { id: true, city: true, country: true, latitude: true, longitude: true },
      },
      amenities: { select: { name: true } },
      rooms: {
        where: {
          available: true,
          ...(params.guests ? { maxOccupancy: { gte: params.guests } } : {}),
        },
        select: { id: true, maxOccupancy: true, priceModifierMinor: true },
      },
    },
  });
  const entries: CatalogEntry[] = rows.map((p) => ({
    id: p.id,
    title: p.title,
    description: p.description,
    propertyType: p.propertyType,
    basePriceMinor: minorFromDb(p.basePriceMinor),
    currency: p.currency,
    ratingAvg: p.ratingAvg,
    ratingCount: p.ratingCount,
    locationId: p.location.id,
    location: {
      city: p.location.city,
      country: p.location.country,
      latitude: p.location.latitude,
      longitude: p.location.longitude,
    },
    amenities: p.amenities.map((a) => a.name),
    images: p.images,
    rooms: p.rooms.map((r) => ({
      id: r.id,
      maxOccupancy: r.maxOccupancy,
      priceModifierMinor: minorFromDb(r.priceModifierMinor),
    })),
  }));
  try {
    await redis.set(key, JSON.stringify(entries), { ex: CATALOG_TTL });
  } catch (error) {
    logger.warn(errorFields(error), "catalog cache write failed");
  }
  return entries;
}

// --- 2) Konaklama teklifleri ------------------------------------------------------------

interface Stay {
  checkIn: IsoDate;
  checkOut: IsoDate;
  nights: IsoDate[];
}

/**
 * Verilen mülkler için en ucuz uygun (oda tipi, plan) teklifini hesaplar. Bir oda tipi
 * ancak aralıktaki HER gece için `sold + held < total` satırı varsa aday olur.
 */
async function computeQuotes(
  entries: CatalogEntry[],
  stay: Stay,
  guests: number
): Promise<Map<string, SearchQuote | null>> {
  const out = new Map<string, SearchQuote | null>(entries.map((e) => [e.id, null]));
  const roomToProperty = new Map<string, CatalogEntry>();
  for (const e of entries) for (const r of e.rooms) roomToProperty.set(r.id, e);
  const roomIds = [...roomToProperty.keys()];
  if (roomIds.length === 0) return out;

  const from = toDbDate(stay.checkIn);
  const to = toDbDate(stay.checkOut);
  const nights = stay.nights.length;
  const fullRooms = await prisma.$queryRaw<Array<{ roomTypeId: string }>>`
    SELECT d."roomTypeId"
    FROM "InventoryDay" d
    WHERE d."roomTypeId" IN (${Prisma.join(roomIds)})
      AND d.date >= ${from} AND d.date < ${to}
      AND d.sold + d.held < d.total
    GROUP BY d."roomTypeId"
    HAVING count(*) = ${nights}`;
  const available = fullRooms.map((r) => r.roomTypeId);
  if (available.length === 0) return out;

  const [inventory, restrictions, plans] = await Promise.all([
    prisma.inventoryDay.findMany({
      where: { roomTypeId: { in: available }, date: { gte: from, lt: to } },
      select: {
        roomTypeId: true,
        date: true,
        priceMinor: true,
        total: true,
        sold: true,
        held: true,
      },
    }),
    prisma.restriction.findMany({
      where: { roomTypeId: { in: available }, date: { gte: from, lte: to } },
    }),
    prisma.ratePlan.findMany({
      where: { roomTypeId: { in: available }, active: true },
      select: { id: true, roomTypeId: true, priceModifierBps: true },
    }),
  ]);
  const group = <T extends { roomTypeId: string }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) m.set(r.roomTypeId, [...(m.get(r.roomTypeId) ?? []), r]);
    return m;
  };
  const invByRoom = group(inventory);
  const resByRoom = group(restrictions as Array<RestrictionRow & { roomTypeId: string }>);
  const plansByRoom = group(plans);

  for (const roomTypeId of available) {
    const entry = roomToProperty.get(roomTypeId)!;
    if (checkRestrictions(stay, resByRoom.get(roomTypeId) ?? [])) continue;
    const nightInputs = nightsFromInventory(
      invByRoom.get(roomTypeId) ?? [],
      stay.nights,
      entry.currency
    );
    if (!nightInputs) continue;
    const room = entry.rooms.find((r) => r.id === roomTypeId)!;
    for (const plan of plansByRoom.get(roomTypeId) ?? []) {
      const priced = priceStay({
        nights: nightInputs,
        modifierMinor: room.priceModifierMinor,
        planModifierBps: plan.priceModifierBps,
        currency: entry.currency,
        taxRules: taxRulesFor(entry.location.country),
        guests,
      });
      const best = out.get(entry.id);
      if (!best || priced.total < best.total) {
        out.set(entry.id, {
          roomId: roomTypeId,
          ratePlanId: plan.id,
          total: priced.total,
          currency: priced.currency,
          nights,
        });
      }
    }
  }
  return out;
}

/** Mülk sürümlü teklif önbelleği: isabetler okunur, eksikler tek seferde hesaplanır. */
async function stayQuotes(
  entries: CatalogEntry[],
  stay: Stay,
  guests: number
): Promise<Map<string, SearchQuote | null>> {
  const result = new Map<string, SearchQuote | null>();
  let keys: string[] = [];
  try {
    const versions = await redis.mget(entries.map((e) => `${PROPERTY_VERSION_PREFIX}${e.id}`));
    keys = entries.map(
      (e, i) =>
        `search:pq:${e.id}:v${versions[i] ?? "0"}:${stay.checkIn}:${stay.checkOut}:${guests}`
    );
    const cached = keys.length > 0 ? await redis.mget(keys) : [];
    entries.forEach((e, i) => {
      const raw = cached[i];
      if (raw) result.set(e.id, JSON.parse(raw) as SearchQuote | null);
    });
  } catch (error) {
    logger.warn(errorFields(error), "quote cache read failed");
  }
  const missing = entries.filter((e) => !result.has(e.id));
  if (missing.length > 0) {
    const computed = await computeQuotes(missing, stay, guests);
    for (const e of missing) {
      const q = computed.get(e.id) ?? null;
      result.set(e.id, q);
      const key = keys[entries.indexOf(e)];
      if (key) {
        await redis.set(key, JSON.stringify(q), { ex: QUOTE_TTL }).catch(() => undefined);
      }
    }
  }
  return result;
}

// --- 3) + 4) Filtre, sıralama, sayfalama ---------------------------------------------

/** Görüntüleme dönüşümü; tablo yoksa (dönüşüm gerekmiyor) statik tabloya düşer. */
function displayAmount(minor: number, from: string, to: CurrencyCode, table?: FxSnapshot): number {
  const converted = convert(money(minor, from), to, table);
  return Number(toDecimalString(converted));
}

function stayOf(params: SearchParams): Stay | null {
  if (!params.checkIn || !params.checkOut) return null;
  const checkIn = params.checkIn as IsoDate;
  const checkOut = params.checkOut as IsoDate;
  const nights = nightsBetween(checkIn, checkOut);
  return nights.length > 0 ? { checkIn, checkOut, nights } : null;
}

async function hybridPoolFor(
  params: SearchParams,
  visualOn: boolean
): Promise<Map<string, HybridHit> | null> {
  const query = params.query?.trim() ?? "";
  const similarToPhotoId = visualOn ? params.similarToPhotoId : undefined;
  if (!query && !similarToPhotoId) return null;
  try {
    const hits = await breakers.search.call(
      () =>
        hybridSearch(
          query,
          {
            city: params.city,
            country: params.country,
            propertyType: params.propertyType,
          },
          { similarToPhotoId }
        ),
      async () => {
        throw new BreakerOpenError("search-hybrid");
      }
    );
    return new Map(hits.map((h) => [h.id, h]));
  } catch (error) {
    logger.warn(errorFields(error), "hybrid search failed; substring fallback");
    return null; // hibrit yol kullanılamıyor → v2 alt-dize araması
  }
}

/**
 * Arama giriş noktası. Parametreler sınırda doğrulanmış olmalıdır (`SearchParamsSchema`);
 * doğrudan çağrılarda da şema yeniden uygulanır.
 */
export async function searchProperties(
  input: SearchInput,
  options: SearchOptions = {}
): Promise<SearchResponse> {
  const params = SearchParamsSchema.parse(input);
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 20;
  const sort = params.sort ?? "recommended";
  const displayCurrency = params.currency ? assertCurrency(params.currency) : undefined;

  const visual = await visualSearchStatus();
  const pool = await hybridPoolFor(params, visual.enabled);
  const entries = await loadCatalog(params, pool ? [...pool.keys()] : undefined);
  const stay = stayOf(params);
  const quotes = stay ? await stayQuotes(entries, stay, params.guests ?? 1) : null;

  // P0-5: görüntüleme para birimi istendiyse kalıcı kur tablosu (DB yoksa statik yedek).
  const fx = displayCurrency ? await getCurrentFx() : undefined;
  const results: SearchResult[] = [];
  for (const e of entries) {
    const quote = quotes ? quotes.get(e.id) : undefined;
    if (quotes && !quote) continue; // tarih verildi ve uygun oda yok
    const currency = displayCurrency ?? assertCurrency(e.currency);
    const baseMinor = e.basePriceMinor;
    const amount = quote
      ? displayAmount(quote.total, quote.currency, currency, fx)
      : displayAmount(baseMinor, e.currency, currency, fx);
    if (params.minPrice !== undefined && amount < params.minPrice) continue;
    if (params.maxPrice !== undefined && amount > params.maxPrice) continue;
    results.push({
      id: e.id,
      title: e.title,
      description: e.description,
      propertyType: e.propertyType,
      basePrice: Number(toDecimalString(money(e.basePriceMinor, e.currency))),
      currency: e.currency,
      ratingAvg: e.ratingAvg,
      ratingCount: e.ratingCount,
      location: e.location,
      amenities: e.amenities,
      images: e.images,
      availableRooms: e.rooms.length,
      ...(quote
        ? {
            quote,
            totalPrice: Number(toDecimalString(money(quote.total, quote.currency))),
          }
        : {}),
      display: { amount, currency },
    });
  }

  // Sıralama tüm küme üzerinde (fiyat karşılaştırması tek para biriminde: görüntü birimi).
  let ordered: SearchResult[];
  let rankingMode: RankingMode | undefined;
  if (sort === "price_asc" || sort === "price_desc") {
    const dir = sort === "price_asc" ? 1 : -1;
    ordered = [...results].sort(
      (a, b) => dir * (a.display!.amount - b.display!.amount) || a.id.localeCompare(b.id)
    );
  } else if (sort === "rating") {
    ordered = [...results].sort(
      (a, b) =>
        b.ratingAvg - a.ratingAvg || b.ratingCount - a.ratingCount || a.id.localeCompare(b.id)
    );
  } else {
    const affinity = params.userId ? await computeAffinity(params.userId).catch(() => null) : null;
    const byId = new Map(entries.map((e) => [e.id, e]));
    // RRF ve sözcüksel skor kümedeki en iyiye göre 0..1'e ölçeklenir.
    const maxRrf = Math.max(0, ...results.map((r) => pool?.get(r.id)?.rrf ?? 0));
    const maxLex = Math.max(0, ...results.map((r) => pool?.get(r.id)?.lexScore ?? 0));
    const ratio = (v: number, max: number) => (max > 0 ? v / max : 0);
    const inputs = results.map((r) => {
      const hit = pool?.get(r.id);
      return {
        id: r.id,
        price: Math.round(r.display!.amount * 100),
        ratingAvg: r.ratingAvg,
        ratingCount: r.ratingCount,
        ...(affinity
          ? {
              personal: affinityBoostFor(affinity, byId.get(r.id)!.locationId, r.propertyType),
            }
          : {}),
        ...(pool
          ? {
              semantic: ratio(hit?.rrf ?? 0, maxRrf),
              lexical: ratio(hit?.lexScore ?? 0, maxLex),
              vector: hit?.vecSim ?? 0,
              trigram: hit?.trgSim ?? 0,
            }
          : {}),
      };
    });
    const weights = pool ? RANKING_WEIGHTS_WITH_QUERY : RANKING_WEIGHTS;
    const ranked =
      options.ranking === "ltr"
        ? await rankWithLtr(inputs, weights)
        : { items: rankResults(inputs, weights), mode: "weighted" as const };
    rankingMode = ranked.mode;
    const byResult = new Map(results.map((r) => [r.id, r]));
    ordered = ranked.items.map((x) => ({
      ...byResult.get(x.id)!,
      score: x.score,
      explain: x.explain,
    }));
  }

  const total = ordered.length;
  let pageResults = ordered.slice((page - 1) * pageSize, page * pageSize);
  if (visual.enabled && pageResults.length > 0) {
    const covers = await coverPhotoIds(pageResults.map((r) => r.id)).catch((error: unknown) => {
      logger.warn(errorFields(error), "cover photo lookup failed");
      return new Map<string, string>();
    });
    pageResults = pageResults.map((r) =>
      covers.has(r.id) ? { ...r, coverPhotoId: covers.get(r.id)! } : r
    );
  }
  const flexDays = Math.min(params.flexDays ?? 0, getConfig().SEARCH_FLEX_MAX_DAYS);
  if (stay && flexDays > 0 && pageResults.length > 0) {
    const suggestions = await flexSuggestions(
      entries.filter((e) => pageResults.some((r) => r.id === e.id)),
      pageResults,
      stay,
      flexDays,
      params.guests ?? 1,
      (minor, from) => {
        const currency = displayCurrency ?? assertCurrency(from);
        return { amount: displayAmount(minor, from, currency, fx), currency };
      }
    ).catch((error: unknown) => {
      logger.warn(errorFields(error), "flex suggestions failed");
      return new Map<string, FlexSuggestion>();
    });
    pageResults = pageResults.map((r) =>
      suggestions.has(r.id) ? { ...r, flexSuggestion: suggestions.get(r.id)! } : r
    );
  }
  return {
    results: pageResults,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
    cached: false,
    ...(pool ? { semantic: true } : {}),
    ...(rankingMode ? { ranking: rankingMode } : {}),
    ...(visual.enabled || params.similarToPhotoId
      ? { visual: { ...visual, applied: visual.enabled && Boolean(params.similarToPhotoId) } }
      : {}),
    ...(stay && flexDays > 0 ? { flex: { days: flexDays } } : {}),
  };
}

/**
 * P1-3 ±N gün önerisi: `MinPriceByDate`'ten tesis başına en ucuz kaydırma adayı seçilir
 * (tahmin), sonra aday tarihler için teklif motoruyla (`stayQuotes` → `priceStay`) KESİN
 * toplam hesaplanır; yalnızca asıl tarihlerden gerçekten ucuzsa öneri eklenir.
 */
async function flexSuggestions(
  entries: CatalogEntry[],
  results: SearchResult[],
  stay: Stay,
  flexDays: number,
  guests: number,
  toDisplay: (minor: number, currency: string) => { amount: number; currency: string }
): Promise<Map<string, FlexSuggestion>> {
  const out = new Map<string, FlexSuggestion>();
  if (entries.length === 0) return out;
  const first = addDays(stay.checkIn, -flexDays);
  const last = addDays(stay.nights[stay.nights.length - 1], flexDays);
  const rows = await prisma.minPriceByDate.findMany({
    where: {
      propertyId: { in: entries.map((e) => e.id) },
      date: { gte: toDbDate(first), lte: toDbDate(last) },
    },
    select: {
      propertyId: true,
      date: true,
      minTotalMinor: true,
      availableRoomTypes: true,
      minStay: true,
      closedToArrival: true,
    },
  });
  const baseline = new Map(
    results.filter((r) => r.quote).map((r) => [r.id, r.quote!.total] as const)
  );
  const candidates = pickFlexCandidates({
    rows: rows.map((r): FlexRow => ({
      propertyId: r.propertyId,
      date: fromDate(r.date),
      minTotalMinor: r.minTotalMinor === null ? null : minorFromDb(r.minTotalMinor),
      availableRoomTypes: r.availableRoomTypes,
      minStay: r.minStay,
      closedToArrival: r.closedToArrival,
    })),
    nights: stay.nights,
    flexDays,
    baseline,
  });
  // Aynı kaydırmaya düşen tesisler tek teklif hesaplamasında toplanır (en fazla 2N grup).
  const byShift = new Map<number, CatalogEntry[]>();
  for (const e of entries) {
    const c = candidates.get(e.id);
    if (c) byShift.set(c.shiftDays, [...(byShift.get(c.shiftDays) ?? []), e]);
  }
  for (const [shift, group] of byShift) {
    const shifted: Stay = {
      checkIn: addDays(stay.checkIn, shift),
      checkOut: addDays(stay.checkOut, shift),
      nights: stay.nights.map((n) => addDays(n, shift)),
    };
    const quotes = await stayQuotes(group, shifted, guests);
    for (const e of group) {
      const q = quotes.get(e.id);
      const current = baseline.get(e.id);
      if (!q || current === undefined || q.currency !== e.currency || q.total >= current) continue;
      out.set(e.id, {
        checkIn: shifted.checkIn,
        checkOut: shifted.checkOut,
        shiftDays: shift,
        roomId: q.roomId,
        ratePlanId: q.ratePlanId,
        total: q.total,
        savings: current - q.total,
        currency: q.currency,
        display: {
          total: toDisplay(q.total, q.currency).amount,
          savings: toDisplay(current - q.total, q.currency).amount,
          currency: toDisplay(0, q.currency).currency,
        },
      });
    }
  }
  return out;
}

export async function getPopularProperties(limit = 10): Promise<SearchResult[]> {
  // Anahtar katalog sürümü + limit içerir: farklı limitler birbirinin önbelleğini döndürmez.
  const popularKey = `${POPULAR_CACHE_KEY}:v${await getVersion(CATALOG_VERSION_KEY)}:${limit}`;
  try {
    const cached = await redis.get(popularKey);
    if (cached) return JSON.parse(cached) as SearchResult[];
  } catch (error) {
    logger.error(errorFields(error), "Popular cache read failed");
  }
  const properties = await prisma.property.findMany({
    where: LISTABLE_PROPERTY,
    orderBy: [{ ratingAvg: "desc" }, { ratingCount: "desc" }, { id: "asc" }],
    take: limit,
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
      amenities: { select: { name: true } },
      rooms: { where: { available: true }, select: { id: true } },
    },
  });
  const results: SearchResult[] = properties.map((p) => ({
    id: p.id,
    title: p.title,
    description: p.description,
    propertyType: p.propertyType,
    basePrice: Number(toDecimalString(moneyFromDb(p.basePriceMinor, p.currency))),
    currency: p.currency,
    ratingAvg: p.ratingAvg,
    ratingCount: p.ratingCount,
    location: p.location,
    amenities: p.amenities.map((a) => a.name),
    images: p.images,
    availableRooms: p.rooms.length,
  }));
  try {
    await redis.set(popularKey, JSON.stringify(results), { ex: POPULAR_CACHE_TTL });
  } catch (error) {
    logger.error(errorFields(error), "Popular cache write failed");
  }
  return results;
}
