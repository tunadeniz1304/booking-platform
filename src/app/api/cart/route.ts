import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";
import { findRestorableCart, getActiveCart } from "@/lib/cart";

/**
 * Oturumdaki kullanıcının aktif sepeti (OPEN/HELD); yoksa `{ cart: null }`. Aktif sepet yokken
 * `restorable` (`/api/cart/reopen` ile geri yüklenebilecek süresi dolmuş sepetin özeti) ve
 * `reopenable` istemcinin "geri yükle" önerisini yalnızca anlamlıyken göstermesi içindir.
 */
export const GET = observed("cart", async function getHandler(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const cart = await getActiveCart(userId);
    const restorable = cart ? null : await findRestorableCart(userId);
    return NextResponse.json({ cart, restorable, reopenable: restorable !== null });
  } catch (error) {
    return toErrorResponse(error, "cart.get");
  }
});

export const dynamic = "force-dynamic";
