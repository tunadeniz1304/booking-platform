import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { listBookingForTransfer, listMyTransfers } from "@/lib/transfer/transfer-service";

const listSchema = z.object({
  bookingId: z.string().min(1),
  askPrice: z.number().positive(),
});

export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const body = await req.json();
    const parsed = listSchema.parse(body);
    const transfer = await listBookingForTransfer(parsed.bookingId, userId, parsed.askPrice);
    return NextResponse.json(transfer, { status: 201 });
  } catch (error) {
    return toErrorResponse(error, "transfers");
  }
}

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const transfers = await listMyTransfers(userId);
    return NextResponse.json(transfers);
  } catch (error) {
    return toErrorResponse(error, "transfers");
  }
}

export const dynamic = "force-dynamic";
