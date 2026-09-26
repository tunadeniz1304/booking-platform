import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireVerifiedEmail } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";
import { createSplitPlan, getSplitPlan } from "@/lib/cart";
import { splitPlanSchema } from "@/lib/cart/schemas";

type Ctx = { params: Promise<{ id: string }> };

/** Bölünmüş ödeme planı (organizatör: pay durumları + davet linkleri; plan yoksa null). */
export const GET = observed("cart.split", async function getHandler(req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const { userId } = await requireAuth(req);
    return NextResponse.json({ plan: await getSplitPlan(id, userId) });
  } catch (error) {
    return toErrorResponse(error, "cart.split.get");
  }
});

/** Organizatör payları tanımlar (sepet HELD): eşit bölme ya da özel tutarlar. */
export const POST = observed("cart.split", async function postHandler(req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const { userId } = await requireVerifiedEmail(req);
    const body = splitPlanSchema.parse(await req.json());
    const plan = await createSplitPlan({
      cartId: id,
      userId,
      mode: body.mode,
      participants: body.participants,
    });
    return NextResponse.json({ plan }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error, "cart.split.create");
  }
});

export const dynamic = "force-dynamic";
