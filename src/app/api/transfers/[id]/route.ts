import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { cancelTransferListing } from "@/lib/transfer/transfer-service";

/** Satıcı kendi ilanını iptal eder (başkasınınki → 404). */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { userId } = await requireAuth(req);
    await cancelTransferListing(id, userId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return toErrorResponse(error, "transfers.cancel");
  }
}

export const dynamic = "force-dynamic";
