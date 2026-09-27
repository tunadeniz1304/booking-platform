import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireVerifiedEmail } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { claimTransfer } from "@/lib/transfer/transfer-service";

const claimSchema = z.object({
  /** Satıcının paylaştığı imzalı claim linkindeki token (zorunlu). */
  token: z.string().min(20).max(1000),
  cardToken: z.string().min(8).max(200),
});

export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireVerifiedEmail(req);
    const { token, cardToken } = claimSchema.parse(await req.json());
    // Opsiyonel: aynı isteğin tekrarı aynı provizyonu kullanır; yoksa deneme başına yeni anahtar.
    const idempotencyKey = req.headers.get("idempotency-key")?.slice(0, 128) || undefined;
    return NextResponse.json(
      await claimTransfer({ token, buyerId: userId, cardToken, idempotencyKey })
    );
  } catch (error) {
    return toErrorResponse(error, "transfers.claim");
  }
}

export const dynamic = "force-dynamic";
