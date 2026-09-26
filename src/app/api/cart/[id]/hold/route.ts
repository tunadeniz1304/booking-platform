import { NextRequest, NextResponse } from "next/server";
import { requireVerifiedEmail } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";
import { holdCart } from "@/lib/cart";

/**
 * Tümü-ya-hiç tutma: tüm kalemler tek işlemde HELD olur ya da hiçbiri (409 + `itemId`).
 * Fiyat değiştiyse 409 PRICE_CHANGED (kalem görüntüleri güncellenir, kullanıcı onaylar).
 */
export const POST = observed(
  "cart.hold",
  async function postHandler(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
      const { id } = await params;
      const { userId } = await requireVerifiedEmail(req);
      const idempotencyKey = req.headers.get("idempotency-key")?.slice(0, 128) || undefined;
      return NextResponse.json({ cart: await holdCart(userId, { cartId: id, idempotencyKey }) });
    } catch (error) {
      return toErrorResponse(error, "cart.hold");
    }
  }
);

export const dynamic = "force-dynamic";
