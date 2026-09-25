import { NextRequest, NextResponse } from "next/server";
import { SearchParamsSchema, searchParamsFromUrl, searchProperties } from "@/lib/search";
import { getAuth } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";

/**
 * Arama ucu. Parametreler sınırda zod ile doğrulanır (v3#7): geçersiz tarih/sayı → 400
 * (v2'de NaN → 500). Kişiselleştirme yalnızca doğrulanmış token'dan.
 */
export const GET = observed("search", async function getHandler(req: NextRequest) {
  try {
    const params = SearchParamsSchema.parse({
      ...searchParamsFromUrl(req.nextUrl.searchParams),
      pageSize: req.nextUrl.searchParams.get("pageSize") ?? 12,
      userId: (await getAuth(req))?.userId,
    });
    return NextResponse.json(await searchProperties(params));
  } catch (error) {
    return toErrorResponse(error, "search");
  }
});

export const dynamic = "force-dynamic";
