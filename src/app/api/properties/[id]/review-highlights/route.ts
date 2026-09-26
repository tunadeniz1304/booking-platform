import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/http/errors";
import { getReviewHighlights } from "@/lib/ai/review-highlights";
import { markAiGenerated, withAiSubject } from "@/lib/http/ai";
import { LOCALE_COOKIE, resolveLocale } from "@/i18n/config";

/**
 * AI yorum öne çıkanları (v4 P1-9): temalar + her iddia için kaynak yorumdan birebir
 * alıntı span'i. Dil `?locale=` veya `NEXT_LOCALE` çerezi. Rate-limit kategorisi `ai`.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const locale = resolveLocale(
      req.nextUrl.searchParams.get("locale") ?? req.cookies.get(LOCALE_COOKIE)?.value
    );
    return NextResponse.json(
      markAiGenerated(await withAiSubject(req, () => getReviewHighlights(id, locale)))
    );
  } catch (error) {
    return toErrorResponse(error, "reviews.highlights");
  }
}

export const dynamic = "force-dynamic";
