import { NextRequest, NextResponse } from "next/server";
import { requireVerifiedEmail } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";
import { createCheckoutSchema, createCheckoutSession } from "@/lib/agentic/checkout";
import { requireIdempotencyKey } from "@/lib/agentic/http";
import { assertAgentHttpSignature } from "@/lib/agentic/http-signature";

/** ACP benzeri checkout oturumu oluşturur (teklif sabitlenir, ödeme henüz yok). */
export const POST = observed(
  "agentic.checkout.create",
  async function postHandler(req: NextRequest) {
    try {
      await assertAgentHttpSignature(req);
      const { userId } = await requireVerifiedEmail(req);
      const idempotencyKey = requireIdempotencyKey(req);
      const input = createCheckoutSchema.parse(await req.json());
      const { session, created } = await createCheckoutSession(userId, idempotencyKey, input);
      return NextResponse.json(session, { status: created ? 201 : 200 });
    } catch (error) {
      return toErrorResponse(error, "agentic.checkout.create");
    }
  }
);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
