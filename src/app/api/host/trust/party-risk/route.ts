import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { listHostPartyRisks } from "@/lib/trust/party-risk-service";

/** Ev sahibinin ilanlarındaki parti riski işaretli, yaklaşan rezervasyonlar (P1-6). */
export async function GET(req: NextRequest) {
  try {
    const actor = await requireRole(req, ["HOST", "ADMIN"]);
    return NextResponse.json({ items: await listHostPartyRisks(actor) });
  } catch (error) {
    return toErrorResponse(error, "host.trust.party_risk");
  }
}

export const dynamic = "force-dynamic";
