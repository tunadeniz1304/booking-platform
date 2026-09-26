import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireVerifiedEmail } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { listBookingForTransfer, listMyTransfers } from "@/lib/transfer/transfer-service";

const listSchema = z.object({
  bookingId: z.string().min(1).max(64),
  /** İstek fiyatı, minor-unit (kuruş). */
  askPriceMinor: z.number().int().positive(),
});

/** Devir ilanı açar; imzalı claim linki yalnızca bu yanıtta bir kez döner. */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireVerifiedEmail(req);
    const { bookingId, askPriceMinor } = listSchema.parse(await req.json());
    const listed = await listBookingForTransfer(bookingId, userId, askPriceMinor);
    const claimUrl = `${req.nextUrl.origin}/transfers/claim#token=${encodeURIComponent(listed.claimToken)}`;
    return NextResponse.json({ ...listed, claimUrl }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error, "transfers.list");
  }
}

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    return NextResponse.json(await listMyTransfers(userId));
  } catch (error) {
    return toErrorResponse(error, "transfers.mine");
  }
}

export const dynamic = "force-dynamic";
