import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";
import { addCartItem } from "@/lib/cart";
import { cartItemSchema } from "@/lib/cart/schemas";

/** Aktif sepete kalem ekler (teklif motoruyla fiyatlanır; sepet yoksa açılır). */
export const POST = observed("cart.items", async function postHandler(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const input = cartItemSchema.parse(await req.json());
    return NextResponse.json({ cart: await addCartItem(userId, input) }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error, "cart.items.add");
  }
});

export const dynamic = "force-dynamic";
