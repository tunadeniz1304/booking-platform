import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import {
  findSemanticCandidates,
  computeAffinity,
  affinityBoostFor,
  blendScore,
  isVectorEnabled,
  SemanticCandidate,
} from "@/lib/search/vector";
import { findFuzzyCandidates, FuzzyCandidate } from "@/lib/search/fuzzy";
import { breakers, BreakerOpenError } from "@/lib/resilience/circuit-breaker";

const SEARCH_CACHE_TTL = 60 * 5; // 5 dakika
const SEARCH_CACHE_PREFIX = "search:";
const POPULAR_CACHE_TTL = 60 * 15; // 15 dakika
const POPULAR_CACHE_KEY = "search:popular";

export interface SearchParams {
  query?: string;
  city?: string;
  country?: string;
  checkIn?: string;
  checkOut?: string;
  guests?: number;
  propertyType?: string;
  minPrice?: number;
  maxPrice?: number;
  amenities?: string[];
  page?: number;
  pageSize?: number;
  sort?: "price_asc" | "price_desc" | "rating" | "recommended";
  /** pgvector semantik aramayı etkinleştirir (query zorunlu). */
  semantic?: boolean;
  /** Kişiselleştirme için oturum kullanıcısı (favori/rezervasyon geçmişi). */
  userId?: string;
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
  };
  amenities: string[];
  images?: string[];
  availableRooms: number;
  totalPrice?: number;
}

export interface SearchResponse {
  results: SearchResult[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  cached: boolean;
  /** Bu yanıt pgvector semantik motorla üretildi. */
  semantic?: boolean;
}

function buildWhere(
  params: SearchParams,
  includeQuery = true
): Prisma.PropertyWhereInput {
  const where: Prisma.PropertyWhereInput = {
    isActive: true,
  };

  if (includeQuery && params.query) {
    where.OR = [
      { title: { contains: params.query, mode: "insensitive" } },
      { description: { contains: params.query, mode: "insensitive" } },
      { location: { city: { contains: params.query, mode: "insensitive" } } },
      { location: { country: { contains: params.query, mode: "insensitive" } } },
    ];
  }

  if (params.city) {
    where.location = {
      ...(typeof where.location === "object" && where.location !== null ? where.location : {}),
      city: { equals: params.city, mode: "insensitive" },
    } as Prisma.PropertyWhereInput["location"];
  }

  if (params.country) {
    where.location = {
      ...(typeof where.location === "object" && where.location !== null ? where.location : {}),
      country: { equals: params.country, mode: "insensitive" },
    } as Prisma.PropertyWhereInput["location"];
  }

  if (params.propertyType) {
    where.propertyType = params.propertyType as Prisma.PropertyWhereInput["propertyType"];
  }

  if (params.minPrice !== undefined || params.maxPrice !== undefined) {
    where.basePrice = {
      ...(params.minPrice !== undefined ? { gte: params.minPrice } : {}),
      ...(params.maxPrice !== undefined ? { lte: params.maxPrice } : {}),
    };
  }

  if (params.amenities && params.amenities.length > 0) {
    where.amenities = {
      some: {
        name: { in: params.amenities },
      },
    };
  }

  if (params.checkIn && params.checkOut) {
    const checkInDate = new Date(params.checkIn);
    const checkOutDate = new Date(params.checkOut);

    // Doğruluk: seçilen aralıkta oda doluysa (isAvailable=false satır varsa)
    // mülk listelenmemeli; ayrıca en az bir müsaitlik satırı olmalı (kapsam).
    where.rooms = {
      some: {
        available: true,
        capacity: params.guests ? { gte: params.guests } : undefined,
        availabilities: {
          none: {
            date: {
              gte: checkInDate,
              lt: checkOutDate,
            },
            isAvailable: false,
          },
          some: {
            date: {
              gte: checkInDate,
              lt: checkOutDate,
            },
          },
        },
      },
    };
  } else if (params.guests) {
    where.rooms = {
      some: {
        available: true,
        capacity: { gte: params.guests },
      },
    };
  }

  return where;
}

function buildOrderBy(sort: SearchParams["sort"]): Prisma.PropertyOrderByWithRelationInput[] {
  switch (sort) {
    case "price_asc":
      return [{ basePrice: "asc" }];
    case "price_desc":
      return [{ basePrice: "desc" }];
    case "rating":
      return [{ ratingAvg: "desc" }, { ratingCount: "desc" }];
    case "recommended":
    default:
      return [{ ratingAvg: "desc" }, { ratingCount: "desc" }, { createdAt: "desc" }];
  }
}

function buildCacheKey(params: SearchParams): string {
  const normalized = {
    query: params.query?.trim().toLowerCase() || "",
    city: params.city?.trim().toLowerCase() || "",
    country: params.country?.trim().toLowerCase() || "",
    checkIn: params.checkIn || "",
    checkOut: params.checkOut || "",
    guests: params.guests || 0,
    propertyType: params.propertyType || "",
    minPrice: params.minPrice || 0,
    maxPrice: params.maxPrice || 0,
    amenities: params.amenities?.sort().join(",") || "",
    page: params.page || 1,
    pageSize: params.pageSize || 20,
    sort: params.sort || "recommended",
    semantic: params.semantic ? 1 : 0,
    userId: params.userId || "",
  };

  return `${SEARCH_CACHE_PREFIX}${JSON.stringify(normalized)}`;
}

/** Sorgu kelimesi metin alanlarında geçiyor mu (semantik skordaki keyword bileşeni). */
function matchesKeyword(property: {
  title: string;
  description: string;
  city: string;
  country: string;
  amenities: Array<{ name: string }>;
}, query: string): boolean {
  const q = query.toLocaleLowerCase("tr-TR");
  const haystack = [
    property.title,
    property.description,
    property.city,
    property.country,
    ...property.amenities.map((a) => a.name),
  ]
    .join(" ")
    .toLocaleLowerCase("tr-TR");
  return haystack.includes(q);
}

/**
 * pgvector + kişiselleştirme eşzamanlı sıralamalı semantik arama.
 * Aday havuzu vektör benzerliğiyle kurulur; filtreler bu havuz üzerinde
 * uygulanır; nihai sıralama harmanlanmış skorla yapılır.
 */
async function semanticSearchProperties(
  params: SearchParams
): Promise<SearchResponse | null> {
  if (!params.query || !(await isVectorEnabled())) return null;
  const query = params.query;

  let candidates: SemanticCandidate[];
  try {
    candidates = await breakers.search.call(
      () => findSemanticCandidates(query, 100),
      async (): Promise<SemanticCandidate[]> => {
        throw new BreakerOpenError("search-pgvector");
      }
    );
  } catch {
    // breaker açık veya vektör araması başarısız → keyword yolu devreye girer
    return null;
  }
  let fuzzy: FuzzyCandidate[];
  try {
    fuzzy = await findFuzzyCandidates(query, 30);
  } catch {
    fuzzy = [];
  }

  // Vektör + trigram aday havuzu birleştirilir (imla hatasına dayanıklılık).
  const pool = new Map<string, number>(candidates.map((c) => [c.id, c.similarity]));
  for (const f of fuzzy) {
    if (!pool.has(f.id)) pool.set(f.id, f.similarity * 0.8);
  }

  if (pool.size === 0) {
    return {
      results: [],
      total: 0,
      page: 1,
      pageSize: Math.min(50, Math.max(1, params.pageSize || 20)),
      totalPages: 0,
      cached: false,
      semantic: true,
    };
  }

  const scoreByCandidate = pool;
  const affinity = params.userId
    ? await computeAffinity(params.userId)
    : { cityWeights: new Map<string, number>(), typeWeights: new Map<string, number>() };

  const where: Prisma.PropertyWhereInput = {
    ...buildWhere(params, false),
    id: { in: [...pool.keys()] },
  };

  const properties = await prisma.property.findMany({
    where,
    take: 500,
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
      location: { select: { id: true, city: true, country: true } },
      amenities: { select: { name: true } },
      rooms: {
        where: { available: true },
        select: { id: true },
      },
    },
  });

  const scored = properties
    .map((property) => {
      const similarity = scoreByCandidate.get(property.id) ?? 0;
      const keywordHit = matchesKeyword(
        {
          title: property.title,
          description: property.description,
          city: property.location.city,
          country: property.location.country,
          amenities: property.amenities,
        },
        params.query ?? ""
      );
      const affinityBoost = property.location.id
        ? affinityBoostFor(affinity, property.location.id, property.propertyType)
        : 0;
      const score = blendScore(similarity, keywordHit, property.ratingAvg, affinityBoost);
      return { property, score };
    })
    .sort((a, b) => b.score - a.score);

  const total = scored.length;
  const page = Math.max(1, params.page || 1);
  const pageSize = Math.min(50, Math.max(1, params.pageSize || 20));
  const slice = scored.slice((page - 1) * pageSize, page * pageSize);

  const results: SearchResult[] = slice.map(({ property }) => ({
    id: property.id,
    title: property.title,
    description: property.description,
    propertyType: property.propertyType,
    basePrice: Number(property.basePrice),
    currency: property.currency,
    ratingAvg: property.ratingAvg,
    ratingCount: property.ratingCount,
    location: { city: property.location.city, country: property.location.country },
    amenities: property.amenities.map((a) => a.name),
    images: property.images,
    availableRooms: property.rooms.length,
  }));

  return {
    results,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
    cached: false,
    semantic: true,
  };
}

export async function searchProperties(params: SearchParams): Promise<SearchResponse> {
  const page = Math.max(1, params.page || 1);
  const pageSize = Math.min(50, Math.max(1, params.pageSize || 20));
  const cacheKey = buildCacheKey({ ...params, page, pageSize });

  // pgvector semantik arama yolu (sorgu varsa)
  if (params.semantic && params.query?.trim()) {
    const semanticResult = await semanticSearchProperties(params);
    if (semanticResult) {
      try {
        await redis.set(cacheKey, JSON.stringify(semanticResult), { ex: SEARCH_CACHE_TTL });
      } catch (error) {
        console.error("Semantic search cache write failed:", error);
      }
      return semanticResult;
    }
  }

  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      return { ...(JSON.parse(cached) as SearchResponse), cached: true };
    }
  } catch (error) {
    console.error("Search cache read failed:", error);
  }

  const where = buildWhere(params);
  const orderBy = buildOrderBy(params.sort);

  const [total, properties] = await Promise.all([
    prisma.property.count({ where }),
    prisma.property.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
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
        location: {
          select: {
            city: true,
            country: true,
          },
        },
        amenities: {
          select: {
            name: true,
          },
        },
        rooms: {
          where: {
            available: true,
            ...(params.guests ? { capacity: { gte: params.guests } } : {}),
          },
          select: {
            id: true,
            priceModifier: true,
            availabilities: {
              where: params.checkIn && params.checkOut
                ? {
                    date: {
                      gte: new Date(params.checkIn),
                      lt: new Date(params.checkOut),
                    },
                    isAvailable: true,
                  }
                : undefined,
              select: {
                price: true,
              },
            },
          },
        },
      },
    }),
  ]);

  const results: SearchResult[] = properties.map((property) => {
    const availableRooms = property.rooms.length;
    let totalPrice: number | undefined;

    if (params.checkIn && params.checkOut && availableRooms > 0) {
      const nights = Math.max(
        1,
        Math.round(
          (new Date(params.checkOut).getTime() - new Date(params.checkIn).getTime()) /
            (1000 * 60 * 60 * 24)
        )
      );

      const room = property.rooms[0];
      const availabilityPrices = room.availabilities.map((a) => Number(a.price));
      const avgAvailabilityPrice =
        availabilityPrices.length > 0
          ? availabilityPrices.reduce((sum, p) => sum + p, 0) / availabilityPrices.length
          : Number(property.basePrice) + Number(room.priceModifier);

      totalPrice = Math.round(avgAvailabilityPrice * nights * 100) / 100;
    }

    return {
      id: property.id,
      title: property.title,
      description: property.description,
      propertyType: property.propertyType,
      basePrice: Number(property.basePrice),
      currency: property.currency,
      ratingAvg: property.ratingAvg,
      ratingCount: property.ratingCount,
      location: property.location,
      amenities: property.amenities.map((a) => a.name),
      images: property.images,
      availableRooms,
      totalPrice,
    };
  });

  const response: SearchResponse = {
    results,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
    cached: false,
  };

  try {
    await redis.set(cacheKey, JSON.stringify(response), { ex: SEARCH_CACHE_TTL });
  } catch (error) {
    console.error("Search cache write failed:", error);
  }

  return response;
}

export async function getPopularProperties(limit = 10): Promise<SearchResult[]> {
  try {
    const cached = await redis.get(POPULAR_CACHE_KEY);
    if (cached) {
      return JSON.parse(cached) as SearchResult[];
    }
  } catch (error) {
    console.error("Popular cache read failed:", error);
  }

  const properties = await prisma.property.findMany({
    where: { isActive: true },
    orderBy: [{ ratingAvg: "desc" }, { ratingCount: "desc" }],
    take: limit,
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
      location: {
        select: {
          city: true,
          country: true,
        },
      },
      amenities: {
        select: {
          name: true,
        },
      },
      rooms: {
        where: { available: true },
        select: {
          id: true,
        },
      },
    },
  });

  const results: SearchResult[] = properties.map((property) => ({
    id: property.id,
    title: property.title,
    description: property.description,
    propertyType: property.propertyType,
    basePrice: Number(property.basePrice),
    currency: property.currency,
    ratingAvg: property.ratingAvg,
    ratingCount: property.ratingCount,
    location: property.location,
    amenities: property.amenities.map((a) => a.name),
    images: property.images,
    availableRooms: property.rooms.length,
  }));

  try {
    await redis.set(POPULAR_CACHE_KEY, JSON.stringify(results), { ex: POPULAR_CACHE_TTL });
  } catch (error) {
    console.error("Popular cache write failed:", error);
  }

  return results;
}

export async function invalidateSearchCache(): Promise<void> {
  try {
    const keys = await redis.keys(`${SEARCH_CACHE_PREFIX}*`);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
    await redis.del(POPULAR_CACHE_KEY);
  } catch (error) {
    console.error("Search cache invalidation failed:", error);
  }
}

export async function invalidatePropertySearchCache(propertyId: string): Promise<void> {
  try {
    const keys = await redis.keys(`${SEARCH_CACHE_PREFIX}*`);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
    await redis.del(POPULAR_CACHE_KEY);
    await redis.del(`property:${propertyId}`);
  } catch (error) {
    console.error("Property search cache invalidation failed:", error);
  }
}