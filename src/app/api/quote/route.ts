import { NextRequest, NextResponse } from "next/server";
import { createQuote } from "@/lib/pricing/quote";
import { channelFromHeaders } from "@/lib/pricing/promotions";
import { toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";
import { quoteQuerySchema } from "@/lib/http/api-schemas";

/**
 * Fiyat teklifi (PDP ve checkout). Tutarlar minor-unit; vergi dahil toplam.
 * Teklif 15 dk saklanır; rezervasyon `quoteId` ile yapılır ve fiyat değişmişse 409.
 */
export const GET = observed("quote", async function getHandler(req: NextRequest) {
  try {
    const params = quoteQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
    return NextResponse.json(
      await createQuote({ ...params, channel: channelFromHeaders(req.headers) })
    );
  } catch (error) {
    return toErrorResponse(error, "quote");
  }
});

export const dynamic = "force-dynamic";
