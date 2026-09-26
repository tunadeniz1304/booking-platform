import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";
import { removeCartItem, updateCartItem } from "@/lib/cart";
import { cartItemPatchSchema } from "@/lib/cart/schemas";

type Ctx = { params: Promise<{ itemId: string }> };

/** Kalemi günceller ve yeniden fiyatlar (yalnızca sahibinin OPEN sepetinde). */
export const PATCH = observed("cart.item", async function patchHandler(req: NextRequest, ctx: Ctx) {
  try {
    const { itemId } = await ctx.params;
    const { userId } = await requireAuth(req);
    const patch = cartItemPatchSchema.parse(await req.json());
    return NextResponse.json({ cart: await updateCartItem(userId, itemId, patch) });
  } catch (error) {
    return toErrorResponse(error, "cart.items.update");
  }
});

export const DELETE = observed(
  "cart.item",
  async function deleteHandler(req: NextRequest, ctx: Ctx) {
    try {
      const { itemId } = await ctx.params;
      const { userId } = await requireAuth(req);
      return NextResponse.json({ cart: await removeCartItem(userId, itemId) });
    } catch (error) {
      return toErrorResponse(error, "cart.items.remove");
    }
  }
);

export const dynamic = "force-dynamic";
