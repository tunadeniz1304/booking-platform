import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireVerifiedEmail } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";
import {
  getCheckoutSession,
  updateCheckoutSession,
  updateCheckoutSchema,
} from "@/lib/agentic/checkout";
import { requireIdempotencyKey } from "@/lib/agentic/http";
import { toAcpUpdate, toUcpView } from "@/lib/agentic/ucp";

type Ctx = { params: Promise<{ id: string }> };

/** UCP checkout durumu (yalnızca sahibi; başkası için 404). */
export const GET = observed(
  "ucp.checkout.get",
  async function getHandler(req: NextRequest, { params }: Ctx) {
    try {
      const { id } = await params;
      const { userId } = await requireAuth(req);
      return NextResponse.json(toUcpView(await getCheckoutSession(userId, id)));
    } catch (error) {
      return toErrorResponse(error, "ucp.checkout.get");
    }
  }
);

/** UCP güncelleme (PUT): tarih/misafir/oda → yeniden teklif. */
export const PUT = observed(
  "ucp.checkout.update",
  async function putHandler(req: NextRequest, { params }: Ctx) {
    try {
      const { id } = await params;
      const { userId } = await requireVerifiedEmail(req);
      requireIdempotencyKey(req);
      const patch = updateCheckoutSchema.parse(toAcpUpdate(await req.json()));
      return NextResponse.json(toUcpView(await updateCheckoutSession(userId, id, patch)));
    } catch (error) {
      return toErrorResponse(error, "ucp.checkout.update");
    }
  }
);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
