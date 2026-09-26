import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";
import { reopenCart } from "@/lib/cart";

/** Süresi dolan son sepetin kalemleriyle yeni sepet açar (aktif sepet varsa onu döner). */
export const POST = observed("cart.reopen", async function postHandler(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    return NextResponse.json({ cart: await reopenCart(userId) });
  } catch (error) {
    return toErrorResponse(error, "cart.reopen");
  }
});

export const dynamic = "force-dynamic";
