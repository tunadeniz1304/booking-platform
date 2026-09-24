import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { claimTransfer } from "@/lib/transfer/transfer-service";

const claimSchema = z.object({
  transferId: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const { userId: buyerId } = await requireAuth(req);
    const body = await req.json();
    const parsed = claimSchema.parse(body);
    const transfer = await claimTransfer(parsed.transferId, buyerId);
    return NextResponse.json(transfer);
  } catch (error) {
    return toErrorResponse(error, "transfers.claim");
  }
}

export const dynamic = "force-dynamic";
