import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { toErrorResponse, ValidationError } from "@/lib/http/errors";
import { addClaimMessage, claimMessageSchema } from "@/lib/resolution/claims";

/** Mesaj / yanıt (karşı tarafın ilk yanıtı SLA sayacını durdurur). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const actor = await requireAuth(req);
    const parsed = claimMessageSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new ValidationError("Geçersiz mesaj", parsed.error.flatten());
    return NextResponse.json(await addClaimMessage(actor, id, parsed.data.body), { status: 201 });
  } catch (error) {
    return toErrorResponse(error, "claims.message");
  }
}

export const dynamic = "force-dynamic";
