import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createQuote } from "@/lib/pricing/quote";
import { toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";

const querySchema = z.object({
  roomId: z.string().min(1).max(64),
  propertyId: z.string().min(1).max(64).optional(),
  checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  guests: z.coerce.number().int().min(1).max(20).default(1),
  ratePlanId: z.string().min(1).max(64).optional(),
  units: z.coerce.number().int().min(1).max(10).optional(),
});

/**
 * Fiyat teklifi (PDP ve checkout). Tutarlar minor-unit; vergi dahil toplam.
 * Teklif 15 dk saklanır; rezervasyon `quoteId` ile yapılır ve fiyat değişmişse 409.
 */
export const GET = observed("quote", async function getHandler(req: NextRequest) {
  try {
    const params = querySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
    return NextResponse.json(await createQuote(params));
  } catch (error) {
    return toErrorResponse(error, "quote");
  }
});

export const dynamic = "force-dynamic";
