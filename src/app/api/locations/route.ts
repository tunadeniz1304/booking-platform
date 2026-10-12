import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger, errorFields } from "@/lib/observability/logger";
import { DISTRICTS } from "@/lib/ai/smart-filter-parser";
import { LISTABLE_PROPERTY } from "@/lib/compliance/listing";
import { normalizePlace } from "@/lib/search/normalize-place";

const INSENSITIVE = "insensitive" as Prisma.QueryMode;
const MAX_LOCATIONS = 20;
const MAX_PROPERTIES = 5;
/** Aksansız eşleştirme için bellekte taranan en fazla konum (tablo küçük: şehir/ülke). */
const LOCATION_SCAN_LIMIT = 1000;

/**
 * Veritabanındaki (Türkçe) şehir adı → yaygın yabancı adları. Veritabanı adı da aksansız
 * karşılaştırılır ("Cesme" → Çeşme, "Istanbul" → İstanbul).
 */
const CITY_ALIASES: Readonly<Record<string, readonly string[]>> = {
  İstanbul: [],
  Antalya: [],
  Bodrum: [],
  İzmir: [],
  Trabzon: [],
  Kapadokya: ["Cappadocia"],
  Ankara: [],
  Muğla: [],
  Alanya: [],
  Çeşme: [],
  Kuşadası: [],
  Paris: [],
  Roma: ["Rome"],
  Barselona: ["Barcelona"],
  Amsterdam: [],
  Viyana: ["Vienna", "Wien"],
  Dubai: [],
  Londra: ["London"],
  "New York": [],
  Tokyo: [],
};

/** Veritabanındaki (Türkçe) ülke adı → yaygın yabancı adları. */
const COUNTRY_ALIASES: Readonly<Record<string, readonly string[]>> = {
  Türkiye: ["Turkey"],
  Fransa: ["France"],
  İtalya: ["Italy"],
  İspanya: ["Spain"],
  Hollanda: ["Netherlands", "Holland"],
  Avusturya: ["Austria"],
  BAE: ["UAE", "United Arab Emirates", "Birleşik Arap Emirlikleri"],
  "Birleşik Krallık": ["United Kingdom", "UK", "England", "Great Britain", "İngiltere"],
  ABD: ["USA", "United States", "Amerika"],
  Japonya: ["Japan"],
};

/** Adı ya da eş adlarından biri sorguyu içeren veritabanı adları. */
function aliasMatches(aliases: Readonly<Record<string, readonly string[]>>, needle: string) {
  return Object.entries(aliases)
    .filter(([name, others]) => [name, ...others].some((n) => normalizePlace(n).includes(needle)))
    .map(([name]) => name);
}

/**
 * Şehir otomatik tamamlama: şehir/ülke adı, yaygın yabancı adlar (Rome → Roma) ve ilçeler
 * (Kadıköy → İstanbul). `include=properties` ile sona ilan başlığı eşleşmeleri de eklenir:
 * `{ type: "property", id, title, city, country }` (şehir öğelerinde `type` yoktur).
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") ?? "").trim();
    const filtered = q.length >= 2;
    const needle = normalizePlace(q);

    const cities = filtered ? aliasMatches(CITY_ALIASES, needle) : [];
    if (filtered) {
      for (const [district, city] of Object.entries(DISTRICTS)) {
        if (normalizePlace(district).includes(needle) && !cities.includes(city)) cities.push(city);
      }
    }
    const countries = filtered ? aliasMatches(COUNTRY_ALIASES, needle) : [];

    const results = q
      ? await matchingLocations(q, needle, cities, countries)
      : await prisma.location.findMany({
          select: { city: true, country: true },
          orderBy: { city: "asc" },
          take: MAX_LOCATIONS,
        });

    if (searchParams.get("include") !== "properties" || !filtered) {
      return NextResponse.json(results);
    }

    const properties = await prisma.property.findMany({
      where: { ...LISTABLE_PROPERTY, title: { contains: q, mode: INSENSITIVE } },
      select: { id: true, title: true, location: { select: { city: true, country: true } } },
      orderBy: { title: "asc" },
      take: MAX_PROPERTIES,
    });

    return NextResponse.json([
      ...results,
      ...properties.map((p) => ({
        type: "property" as const,
        id: p.id,
        title: p.title,
        city: p.location.city,
        country: p.location.country,
      })),
    ]);
  } catch (error) {
    logger.error(errorFields(error), "Locations error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

type LocationRow = { city: string; country: string };

/**
 * Sorguya uyan konumlar (en fazla 20, şehir sırasıyla). Eşleştirme bellekte, aksan ve
 * İ/ı duyarsız yapılır ("Cesme" → Çeşme); tek karakterlik sorgu yalnız şehir başına bakar.
 * Tablo tarama sınırını aşarsa kalanlar veritabanı (aksan duyarlı) aramasıyla eklenir.
 */
async function matchingLocations(
  q: string,
  needle: string,
  cities: readonly string[],
  countries: readonly string[]
): Promise<LocationRow[]> {
  const select = { city: true, country: true } as const;
  const scanned = await prisma.location.findMany({
    select,
    orderBy: { city: "asc" },
    take: LOCATION_SCAN_LIMIT,
  });
  const matches = scanned.filter((l) =>
    q.length >= 2
      ? cities.includes(l.city) ||
        countries.includes(l.country) ||
        normalizePlace(l.city).includes(needle) ||
        normalizePlace(l.country).includes(needle)
      : normalizePlace(l.city).startsWith(needle)
  );
  if (scanned.length < LOCATION_SCAN_LIMIT || matches.length >= MAX_LOCATIONS) {
    return matches.slice(0, MAX_LOCATIONS);
  }

  const direct = await prisma.location.findMany({
    where:
      q.length >= 2
        ? {
            OR: [
              { city: { contains: q, mode: INSENSITIVE } },
              { country: { contains: q, mode: INSENSITIVE } },
              ...(cities.length > 0 ? [{ city: { in: [...cities] } }] : []),
              ...(countries.length > 0 ? [{ country: { in: [...countries] } }] : []),
            ],
          }
        : { city: { startsWith: q, mode: INSENSITIVE } },
    select,
    orderBy: { city: "asc" },
    take: MAX_LOCATIONS,
  });
  const seen = new Set(matches.map((l) => `${l.city}\u0000${l.country}`));
  return [...matches, ...direct.filter((l) => !seen.has(`${l.city}\u0000${l.country}`))]
    .sort((a, b) => a.city.localeCompare(b.city, "tr"))
    .slice(0, MAX_LOCATIONS);
}

export const dynamic = "force-dynamic";
