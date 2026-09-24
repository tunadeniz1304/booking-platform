import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { translateQuery } from "@/lib/ai/smart-filter";
import { searchProperties } from "@/lib/search";
import { getAuth } from "@/lib/auth";
import { observed } from "@/lib/http/observed";

const bodySchema = z.object({ text: z.string().trim().min(3).max(300) });

/**
 * Doğal dil arama: metin → doğrulanmış filtre (LLM veya demo) → DETERMİNİSTİK arama.
 * Yanıt 200 + `llmMode` (live | demo | fallback); çıkarılan filtreler UI'da çip olur.
 */
export const POST = observed("search.smart", async function smartHandler(req: NextRequest) {
  const { text } = bodySchema.parse(await req.json());
  const translated = await translateQuery(text);
  const f = translated.data;
  const results = await searchProperties({
    city: f.city,
    query: f.query,
    guests: f.guests,
    minPrice: f.minPrice,
    maxPrice: f.maxPrice,
    amenities: f.amenities,
    propertyType: f.propertyType,
    checkIn: f.checkIn,
    checkOut: f.checkOut,
    sort: f.sort ?? "recommended",
    page: 1,
    pageSize: 24,
    userId: (await getAuth(req))?.userId,
  });
  return NextResponse.json({
    filters: f,
    llmMode: translated.llmMode,
    reason: translated.reason,
    ...results,
  });
});

export const dynamic = "force-dynamic";
