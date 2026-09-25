import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { rejectSuggestion } from "@/lib/pricing/revenue";

/** Öneriyi reddeder: hiçbir fiyat değişmez. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const actor = await requireRole(req, ["HOST", "ADMIN"]);
    return NextResponse.json(await rejectSuggestion(actor, id));
  } catch (error) {
    return toErrorResponse(error, "host.revenue.reject");
  }
}

export const dynamic = "force-dynamic";
