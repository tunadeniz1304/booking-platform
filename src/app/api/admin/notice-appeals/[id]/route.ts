import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { appealDecisionSchema, decideAppeal } from "@/lib/compliance/dsa-appeal";

/**
 * DSA md. 20 itiraz kararı (ADMIN, P2-1a): UPHELD önceki kararı geri alır (REMOVED →
 * yeniden yayın serbest; NO_ACTION → ilan kaldırılır, `ground` zorunlu). Sonuç e-postalanır.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const admin = await requireRole(req, ["ADMIN"]);
    const input = appealDecisionSchema.parse(await req.json());
    return NextResponse.json({ appeal: await decideAppeal(id, input, admin.userId) });
  } catch (error) {
    return toErrorResponse(error, "admin.notice_appeals.decide");
  }
}
