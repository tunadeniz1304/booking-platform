import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";
import { cancelCartWithSplit, loadOwnedCart, presentCart } from "@/lib/cart";

type Ctx = { params: Promise<{ id: string }> };

/** Sepet (yalnızca sahibine; başkasınınki 404) — checkout sonrası özet için de kullanılır. */
export const GET = observed("cart.id", async function getHandler(req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const { userId } = await requireAuth(req);
    return NextResponse.json({ cart: presentCart(await loadOwnedCart(id, userId)) });
  } catch (error) {
    return toErrorResponse(error, "cart.get");
  }
});

/** Sepeti iptal eder; tutma varsa kalemler serbest, bölünmüş ödeme payları void/iade. */
export const DELETE = observed("cart.id", async function deleteHandler(req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const { userId } = await requireAuth(req);
    await cancelCartWithSplit(userId, id);
    return NextResponse.json({ cancelled: true });
  } catch (error) {
    return toErrorResponse(error, "cart.cancel");
  }
});

export const dynamic = "force-dynamic";
