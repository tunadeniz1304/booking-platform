import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { getRevenueOverview } from "@/lib/pricing/revenue";

const querySchema = z.object({ propertyId: z.string().min(1).max(64) });

/** Gelir paneli (P1-5): doluluk, ADR, RevPAR, pickup ve bekleyen fiyat önerileri. */
export async function GET(req: NextRequest) {
  try {
    const actor = await requireRole(req, ["HOST", "ADMIN"]);
    const { propertyId } = querySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
    return NextResponse.json(await getRevenueOverview(actor, propertyId));
  } catch (error) {
    return toErrorResponse(error, "host.revenue");
  }
}

export const dynamic = "force-dynamic";
