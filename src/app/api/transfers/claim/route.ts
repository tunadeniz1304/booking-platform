import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { claimTransfer } from "@/lib/transfer/transfer-service";

const claimSchema = z.object({
  /** Satıcının paylaştığı imzalı claim linkindeki token (zorunlu). */
  token: z.string().min(20).max(1000),
  cardToken: z.string().min(8).max(200),
});

export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const { token, cardToken } = claimSchema.parse(await req.json());
    return NextResponse.json(await claimTransfer({ token, buyerId: userId, cardToken }));
  } catch (error) {
    return toErrorResponse(error, "transfers.claim");
  }
}

export const dynamic = "force-dynamic";
