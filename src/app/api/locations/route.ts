import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger, errorFields } from "@/lib/observability/logger";
import { DISTRICTS } from "@/lib/ai/smart-filter-parser";
import { LISTABLE_PROPERTY } from "@/lib/compliance/listing";

const INSENSITIVE = "insensitive" as Prisma.QueryMode;
const MAX_PROPERTIES = 5;

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

/** Küçük harf, aksansız, İ/ı duyarsız karşılaştırma biçimi. */
function fold(s: string): string {
  return s
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ı/g, "i")
    .trim();
}

/** Adı ya da eş adlarından biri sorguyu içeren veritabanı adları. */
function aliasMatches(aliases: Readonly<Record<string, readonly string[]>>, needle: string) {
  return Object.entries(aliases)
    .filter(([name, others]) => [name, ...others].some((n) => fold(n).includes(needle)))
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
    const needle = fold(q);

    const cities = filtered ? aliasMatches(CITY_ALIASES, needle) : [];
    if (filtered) {
      for (const [district, city] of Object.entries(DISTRICTS)) {
        if (fold(district).includes(needle) && !cities.includes(city)) cities.push(city);
      }
    }
    const countries = filtered ? aliasMatches(COUNTRY_ALIASES, needle) : [];

    const results = await prisma.location.findMany({
      where: filtered
        ? {
            OR: [
              { city: { contains: q, mode: INSENSITIVE } },
              { country: { contains: q, mode: INSENSITIVE } },
              ...(cities.length > 0 ? [{ city: { in: cities } }] : []),
              ...(countries.length > 0 ? [{ country: { in: countries } }] : []),
            ],
          }
        : undefined,
      select: { city: true, country: true },
      orderBy: { city: "asc" },
      take: 20,
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

export const dynamic = "force-dynamic";
