import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { decideNotice, noticeDecisionSchema } from "@/lib/compliance/dsa";

/**
 * DSA bildirimine karar (ADMIN, P1-13b): REMOVED → ilan pasif; her kararda md. 17 gerekçeli
 * karar bildirimi üretilir ve outbox ile e-postalanır.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const admin = await requireRole(req, ["ADMIN"]);
    const input = noticeDecisionSchema.parse(await req.json());
    return NextResponse.json({ notice: await decideNotice(id, input, admin.userId) });
  } catch (error) {
    return toErrorResponse(error, "admin.notices.decide");
  }
}
