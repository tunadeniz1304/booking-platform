import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserIdFromRequest } from "@/lib/auth";
import {
  listBookingForTransfer,
  listMyTransfers,
  TransferError,
} from "@/lib/transfer/transfer-service";

const listSchema = z.object({
  bookingId: z.string().min(1),
  askPrice: z.number().positive(),
});

export async function POST(req: NextRequest) {
  try {
    const userId = getUserIdFromRequest(req);
    const body = await req.json();
    const parsed = listSchema.parse(body);
    const transfer = await listBookingForTransfer(parsed.bookingId, userId, parsed.askPrice);
    return NextResponse.json(transfer, { status: 201 });
  } catch (error) {
    return handleTransferError(error);
  }
}

export async function GET(req: NextRequest) {
  try {
    const userId = getUserIdFromRequest(req);
    const transfers = await listMyTransfers(userId);
    return NextResponse.json(transfers);
  } catch (error) {
    return handleTransferError(error);
  }
}

function handleTransferError(error: unknown): NextResponse {
  if (error instanceof z.ZodError) {
    return NextResponse.json({ error: "Validation error", details: error.errors }, { status: 400 });
  }
  if (error instanceof Error && error.message === "Missing or invalid token") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (error instanceof TransferError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error("Transfer API error:", error);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

export const dynamic = "force-dynamic";
