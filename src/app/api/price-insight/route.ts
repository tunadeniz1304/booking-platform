import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPriceInsight } from "@/lib/pricing/insight";
import { toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";

const querySchema = z.object({
  roomId: z.string().min(1).max(64),
  checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/** Fiyat içgörüsü (P1-4): conformal tahmin aralığı + düşük/tipik/yüksek etiketi. */
export const GET = observed("price-insight", async function getHandler(req: NextRequest) {
  try {
    const params = querySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
    return NextResponse.json(await getPriceInsight(params));
  } catch (error) {
    return toErrorResponse(error, "price-insight");
  }
});

export const dynamic = "force-dynamic";
