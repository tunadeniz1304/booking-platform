import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { toErrorResponse, ValidationError } from "@/lib/http/errors";
import { claimDecisionSchema, decideClaim } from "@/lib/resolution/claims";

/**
 * Yönetici kararı: onay / kısmi / ret. GUEST_REFUND → PSP iadesi + jurnal; HOST_DAMAGE →
 * depozitodan ≤ ön provizyon tahsil, fazlası yalnız kayıt.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const actor = await requireRole(req, ["ADMIN"]);
    const parsed = claimDecisionSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new ValidationError("Geçersiz karar", parsed.error.flatten());
    const r = await decideClaim(actor, id, parsed.data);
    return NextResponse.json({
      status: r.status,
      awardedMinor: Number(r.awardedMinor),
      settledMinor: Number(r.settledMinor),
      uncollectedMinor: Number(r.uncollectedMinor),
      platformCoveredMinor: Number(r.platformCoveredMinor),
    });
  } catch (error) {
    return toErrorResponse(error, "admin.claims.decide");
  }
}

export const dynamic = "force-dynamic";
