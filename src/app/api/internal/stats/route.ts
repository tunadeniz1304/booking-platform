import { NextRequest, NextResponse } from "next/server";
import { getQueryStats } from "@/lib/observability/stats";
import { authorizeInternalRequest } from "@/lib/security/internal-auth";
import { toErrorResponse } from "@/lib/http/errors";

/**
 * Canlı DB profil görüntüsü (`x-internal-secret` veya ADMIN JWT).
 * Sorgu sayısı/ortalaması, yavaş sorgu oranı ve model bazlı dağılım; N+1 riski
 * en yüksek modeller `topModels` içinde. Profil'leyici kapalıysa `enabled: false`.
 */
export async function GET(req: NextRequest) {
  try {
    await authorizeInternalRequest(req);
    return NextResponse.json({ ok: true, ...getQueryStats() });
  } catch (error) {
    return toErrorResponse(error, "internal.stats");
  }
}

export const dynamic = "force-dynamic";
