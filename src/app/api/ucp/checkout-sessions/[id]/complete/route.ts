import { NextRequest, NextResponse } from "next/server";
import { requireVerifiedEmail } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";
import { completeCheckoutSession } from "@/lib/agentic/checkout";
import { mandateHeader, requireIdempotencyKey, riskContext } from "@/lib/agentic/http";
import { toAcpComplete, toUcpView } from "@/lib/agentic/ucp";
import { assertAgentHttpSignature } from "@/lib/agentic/http-signature";

/**
 * UCP tamamlama: `payment_data.credential` (SPT) + `ap2.intent_mandate` → ACP tamamlama
 * (aynı saga ve mandate kapısı). 3DS → 202 `requires_escalation`.
 */
export const POST = observed(
  "ucp.checkout.complete",
  async function postHandler(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
      await assertAgentHttpSignature(req);
      const { id } = await params;
      const { userId } = await requireVerifiedEmail(req);
      const idempotencyKey = requireIdempotencyKey(req);
      const { token, mandate } = toAcpComplete(await req.json());
      const view = await completeCheckoutSession(
        userId,
        id,
        idempotencyKey,
        { token, mandate: mandate ?? mandateHeader(req) },
        riskContext(req)
      );
      return NextResponse.json(toUcpView(view), {
        status: view.status === "completed" ? 200 : 202,
      });
    } catch (error) {
      return toErrorResponse(error, "ucp.checkout.complete");
    }
  }
);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
