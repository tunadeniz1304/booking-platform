import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { listUpcomingItinerary } from "@/lib/booking/itinerary";
import { toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";

/** Yaklaşan rezervasyonlar + imzalı QR kodu (P1-12 çevrimdışı seyahat kartı). */
export const GET = observed("itinerary.list", async function getHandler(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const items = await listUpcomingItinerary(userId);
    return NextResponse.json(
      { items, generatedAt: new Date().toISOString() },
      { headers: { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" } }
    );
  } catch (error) {
    return toErrorResponse(error, "itinerary.list");
  }
});

export const dynamic = "force-dynamic";
