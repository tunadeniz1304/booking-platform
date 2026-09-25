import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { experimentResults } from "@/lib/flags/stats";

/** A/B deney sonuçları (ADMIN): kol başına maruziyet, dönüşüm, %95 Wilson aralığı. */
export async function GET(req: NextRequest) {
  try {
    await requireRole(req, ["ADMIN"]);
    return NextResponse.json(await experimentResults());
  } catch (error) {
    return toErrorResponse(error, "admin.experiments");
  }
}

export const dynamic = "force-dynamic";
