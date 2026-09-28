import { NextRequest, NextResponse } from "next/server";
import { requireVerifiedEmail } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";
import { getRnplOffer } from "@/lib/payment/rnpl";

/** P1-3: HELD rezervasyon için "şimdi rezerve et, sonra öde" teklifi (yalnız sahibi). */
export const GET = observed(
  "bookings.rnpl_offer",
  async function getHandler(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
      const { id } = await params;
      const { userId } = await requireVerifiedEmail(req);
      return NextResponse.json(await getRnplOffer(id, userId));
    } catch (error) {
      return toErrorResponse(error, "bookings.rnpl_offer");
    }
  }
);

export const dynamic = "force-dynamic";
