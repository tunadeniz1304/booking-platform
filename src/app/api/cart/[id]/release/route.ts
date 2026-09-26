import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";
import { releaseCart } from "@/lib/cart";

/** Tutmayı bırakır (tüm kalem rezervasyonları düşer); sepet yeniden düzenlenebilir. */
export const POST = observed(
  "cart.release",
  async function postHandler(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
      const { id } = await params;
      const { userId } = await requireAuth(req);
      return NextResponse.json({ cart: await releaseCart(userId, id) });
    } catch (error) {
      return toErrorResponse(error, "cart.release");
    }
  }
);

export const dynamic = "force-dynamic";
