import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { getClaimDetail } from "@/lib/resolution/claims";

/** Talep ayrıntısı: yalnız taraflar ve yönetici (diğerleri 404). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const actor = await requireAuth(req);
    return NextResponse.json(await getClaimDetail(actor, id));
  } catch (error) {
    return toErrorResponse(error, "claims.detail");
  }
}

export const dynamic = "force-dynamic";
