import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";
import { creditOptionsForBooking } from "@/lib/wallet/wallet-service";

/**
 * Checkout kredi seçenekleri (P1-7): bu rezervasyonda kullanılabilecek azami kredi.
 * Sahibi değilse 404 (IDOR); sepet kalemlerinde kredi kullanılamaz (maxUsableMinor 0).
 */
export const GET = observed(
  "bookings.credit",
  async function getHandler(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
      const { id } = await params;
      const { userId } = await requireAuth(req);
      return NextResponse.json(await creditOptionsForBooking(id, userId));
    } catch (error) {
      return toErrorResponse(error, "bookings.credit");
    }
  }
);

export const dynamic = "force-dynamic";
