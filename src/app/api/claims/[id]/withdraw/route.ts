import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { withdrawClaim } from "@/lib/resolution/claims";

/** Açan taraf talebi geri çeker. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const actor = await requireAuth(req);
    await withdrawClaim(actor, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error, "claims.withdraw");
  }
}

export const dynamic = "force-dynamic";
