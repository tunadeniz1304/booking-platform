import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";
import { quoteRefund } from "@/lib/payment/refund";

/** F500: iptal onayından önce iade önizlemesi (yalnız sahibi; yan etkisiz). */
export const GET = observed(
  "bookings.refund_quote",
  async function getHandler(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
      const { id } = await params;
      const { userId } = await requireAuth(req);
      return NextResponse.json(await quoteRefund(id, userId));
    } catch (error) {
      return toErrorResponse(error, "bookings.refund_quote");
    }
  }
);

export const dynamic = "force-dynamic";
