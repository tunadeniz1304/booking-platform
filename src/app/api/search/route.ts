import { NextRequest, NextResponse } from "next/server";
import { SearchParamsSchema, searchParamsFromUrl, searchProperties } from "@/lib/search";
import { getAuth } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";
import { withAiSubject } from "@/lib/http/ai";
import { getRankingVariant } from "@/lib/flags";
import { resolveSubject, setExperimentCookie } from "@/lib/flags/subject";

/**
 * Arama ucu. Parametreler sınırda zod ile doğrulanır (v3#7): geçersiz tarih/sayı → 400
 * (v2'de NaN → 500). Kişiselleştirme yalnızca doğrulanmış token'dan.
 *
 * Deney (P1-3): yalnız "önerilen" sıralamada `search-ranking` bayrağı değerlendirilir;
 * özne yoksa (giriş yok + analitik onayı yok) ağırlıklı sıralama (v2) kullanılır.
 */
export const GET = observed("search", async function getHandler(req: NextRequest) {
  try {
    const params = SearchParamsSchema.parse({
      ...searchParamsFromUrl(req.nextUrl.searchParams),
      pageSize: req.nextUrl.searchParams.get("pageSize") ?? 12,
      userId: (await getAuth(req))?.userId,
    });
    const recommended = (params.sort ?? "recommended") === "recommended";
    const { subject, newSessionId } = recommended
      ? resolveSubject(req, params.userId)
      : { subject: null, newSessionId: null };
    const { variant } = await getRankingVariant(subject);
    const ranking = variant === "ranking.ltr" ? "ltr" : "weighted";
    // Sorgu embedding'i (uzak model açıksa) isteğin öznesine faturalanır (v4#3).
    const res = NextResponse.json(
      await withAiSubject(req, () => searchProperties(params, { ranking }))
    );
    if (newSessionId) setExperimentCookie(res, newSessionId);
    return res;
  } catch (error) {
    return toErrorResponse(error, "search");
  }
});

export const dynamic = "force-dynamic";
