import { NextRequest, NextResponse } from "next/server";
import { requireVerifiedEmail } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";
import { completeCheckoutSchema, completeCheckoutSession } from "@/lib/agentic/checkout";
import { requireIdempotencyKey, riskContext } from "@/lib/agentic/http";

/**
 * Ödemeyi tamamlar: web checkout ile aynı saga (teklif → HELD → ödeme). 3DS gerekiyorsa
 * 202 + `next_action`; red 402 (oturum açık kalır, yeni token ile tekrar denenebilir).
 */
export const POST = observed(
  "agentic.checkout.complete",
  async function postHandler(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
      const { id } = await params;
      const { userId } = await requireVerifiedEmail(req);
      const idempotencyKey = requireIdempotencyKey(req);
      const { payment_data } = completeCheckoutSchema.parse(await req.json());
      const session = await completeCheckoutSession(
        userId,
        id,
        idempotencyKey,
        payment_data.token,
        riskContext(req)
      );
      return NextResponse.json(session, { status: session.status === "completed" ? 200 : 202 });
    } catch (error) {
      return toErrorResponse(error, "agentic.checkout.complete");
    }
  }
);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
