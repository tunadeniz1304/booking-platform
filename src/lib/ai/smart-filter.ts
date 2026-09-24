import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getLlmClient, type LlmResult } from "@/lib/llm/client";
import { demoSmartFilter } from "@/lib/llm/demo";
import {
  PROPERTY_TYPES,
  SORTS,
  type FacetVocabulary,
  type SmartFilters,
} from "./smart-filter-parser";

/**
 * Smart Filter (P1-1): doğal dil → YALNIZCA izinli facet'lerden oluşan filtre.
 * LLM yalnızca çeviri yapar; arama/sıralama deterministik `searchProperties` ile.
 * Canlı çıktıdaki bilinmeyen şehir/amenity/tip sessizce DÜŞÜRÜLÜR (sorguya girmez).
 */

const llmSchema = z.object({
  city: z.string().max(80).nullish(),
  query: z.string().max(80).nullish(),
  guests: z.number().int().min(1).max(20).nullish(),
  minPrice: z.number().min(0).max(1_000_000).nullish(),
  maxPrice: z.number().min(0).max(1_000_000).nullish(),
  amenities: z.array(z.string().max(60)).max(12).default([]),
  propertyType: z.string().nullish(),
  checkIn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
  checkOut: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
  sort: z.string().nullish(),
});

let cachedVocab: { at: number; vocab: FacetVocabulary } | null = null;

export async function loadVocabulary(): Promise<FacetVocabulary> {
  if (cachedVocab && Date.now() - cachedVocab.at < 5 * 60_000) return cachedVocab.vocab;
  const [locations, amenities] = await Promise.all([
    prisma.location.findMany({ select: { city: true }, distinct: ["city"] }),
    prisma.amenity.findMany({ select: { name: true } }),
  ]);
  const vocab = { cities: locations.map((l) => l.city), amenities: amenities.map((a) => a.name) };
  cachedVocab = { at: Date.now(), vocab };
  return vocab;
}

/** Canlı çıktıyı izinli facet'lere indirger (bilinmeyen değerler atılır). */
export function sanitizeFilters(
  raw: z.infer<typeof llmSchema>,
  vocab: FacetVocabulary
): SmartFilters {
  const cityMap = new Map(vocab.cities.map((c) => [c.toLocaleLowerCase("tr-TR"), c]));
  const out: SmartFilters = {
    amenities: [...new Set(raw.amenities.filter((a) => vocab.amenities.includes(a)))],
  };
  const city = raw.city ? cityMap.get(raw.city.toLocaleLowerCase("tr-TR")) : undefined;
  if (city) out.city = city;
  if (raw.query) out.query = raw.query.replace(/[^\p{L}\p{N} -]/gu, "").slice(0, 40) || undefined;
  if (raw.guests) out.guests = raw.guests;
  if (raw.minPrice) out.minPrice = Math.round(raw.minPrice);
  if (raw.maxPrice) out.maxPrice = Math.round(raw.maxPrice);
  if (raw.propertyType && (PROPERTY_TYPES as readonly string[]).includes(raw.propertyType)) {
    out.propertyType = raw.propertyType as SmartFilters["propertyType"];
  }
  if (raw.checkIn && raw.checkOut && raw.checkIn < raw.checkOut) {
    out.checkIn = raw.checkIn;
    out.checkOut = raw.checkOut;
  }
  if (raw.sort && (SORTS as readonly string[]).includes(raw.sort))
    out.sort = raw.sort as SmartFilters["sort"];
  return out;
}

export async function translateQuery(text: string): Promise<LlmResult<SmartFilters>> {
  const vocab = await loadVocabulary();
  const today = new Date().toISOString().slice(0, 10);
  const result = await getLlmClient().completeJson(
    "smart_filter",
    llmSchema,
    [
      {
        role: "system",
        content: [
          "Konaklama arama cümlesini JSON filtreye çevir. Yalnızca JSON döndür.",
          `Alanlar: city, query (ilçe/semt), guests, minPrice, maxPrice (gecelik TL), amenities[], propertyType, checkIn, checkOut (YYYY-MM-DD), sort.`,
          `İzinli şehirler: ${vocab.cities.join(", ")}.`,
          `İzinli amenities: ${vocab.amenities.join(", ")}.`,
          `propertyType: ${PROPERTY_TYPES.join(", ")}. sort: ${SORTS.join(", ")}. Bugün: ${today}.`,
          "Emin olmadığın alanı boş bırak; listede olmayan değer UYDURMA.",
        ].join("\n"),
      },
      { role: "user", content: text },
    ],
    { demo: () => demoSmartFilter(text, vocab) }
  );
  return {
    ...result,
    data:
      result.llmMode === "live"
        ? sanitizeFilters(result.data as z.infer<typeof llmSchema>, vocab)
        : (result.data as SmartFilters),
  };
}
