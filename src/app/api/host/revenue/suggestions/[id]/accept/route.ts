import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { acceptSuggestion } from "@/lib/pricing/revenue";

/** Öneriyi kabul eder: gece fiyatı yazılır ve motorun ezmemesi için sabitlenir. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const actor = await requireRole(req, ["HOST", "ADMIN"]);
    return NextResponse.json(await acceptSuggestion(actor, id));
  } catch (error) {
    return toErrorResponse(error, "host.revenue.accept");
  }
}

export const dynamic = "force-dynamic";
