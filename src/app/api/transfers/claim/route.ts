import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserIdFromRequest } from "@/lib/auth";
import { claimTransfer, TransferError } from "@/lib/transfer/transfer-service";

const claimSchema = z.object({
  transferId: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const buyerId = getUserIdFromRequest(req);
    const body = await req.json();
    const parsed = claimSchema.parse(body);
    const transfer = await claimTransfer(parsed.transferId, buyerId);
    return NextResponse.json(transfer);
  } catch (error) {
    if (error instanceof TransferError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof Error && error.message === "Missing or invalid token") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Transfer claim error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export const dynamic = "force-dynamic";
