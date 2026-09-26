import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";
import { getActiveCart } from "@/lib/cart";

/** Oturumdaki kullanıcının aktif sepeti (OPEN/HELD); yoksa `{ cart: null }`. */
export const GET = observed("cart", async function getHandler(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    return NextResponse.json({ cart: await getActiveCart(userId) });
  } catch (error) {
    return toErrorResponse(error, "cart.get");
  }
});

export const dynamic = "force-dynamic";
