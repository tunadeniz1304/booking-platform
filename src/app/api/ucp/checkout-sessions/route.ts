import { NextRequest, NextResponse } from "next/server";
import { requireVerifiedEmail } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";
import { createCheckoutSession } from "@/lib/agentic/checkout";
import { requireIdempotencyKey } from "@/lib/agentic/http";
import { toAcpCreate, toUcpView } from "@/lib/agentic/ucp";

/** UCP lodging checkout oluşturma — ACP servisinin ince adaptörü (P1-11). */
export const POST = observed("ucp.checkout.create", async function postHandler(req: NextRequest) {
  try {
    const { userId } = await requireVerifiedEmail(req);
    const idempotencyKey = requireIdempotencyKey(req);
    const input = toAcpCreate(await req.json());
    const { session, created } = await createCheckoutSession(userId, idempotencyKey, input);
    return NextResponse.json(toUcpView(session), { status: created ? 201 : 200 });
  } catch (error) {
    return toErrorResponse(error, "ucp.checkout.create");
  }
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
