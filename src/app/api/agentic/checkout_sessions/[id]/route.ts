import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";
import {
  getCheckoutSession,
  updateCheckoutSchema,
  updateCheckoutSession,
} from "@/lib/agentic/checkout";
import { requireIdempotencyKey } from "@/lib/agentic/http";

type Ctx = { params: Promise<{ id: string }> };

/** Oturum durumu (yalnızca sahibi; başkası için 404). */
export const GET = observed(
  "agentic.checkout.get",
  async function getHandler(req: NextRequest, { params }: Ctx) {
    try {
      const { id } = await params;
      const { userId } = await requireAuth(req);
      return NextResponse.json(await getCheckoutSession(userId, id));
    } catch (error) {
      return toErrorResponse(error, "agentic.checkout.get");
    }
  }
);

/** Tarih/misafir güncelleme → yeniden teklif (yalnızca `ready_for_payment`). */
export const POST = observed(
  "agentic.checkout.update",
  async function postHandler(req: NextRequest, { params }: Ctx) {
    try {
      const { id } = await params;
      const { userId } = await requireAuth(req);
      requireIdempotencyKey(req);
      const patch = updateCheckoutSchema.parse(await req.json());
      return NextResponse.json(await updateCheckoutSession(userId, id, patch));
    } catch (error) {
      return toErrorResponse(error, "agentic.checkout.update");
    }
  }
);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
