import { NextRequest, NextResponse } from "next/server";
import { cancelBooking, getBooking } from "@/lib/booking-service";
import { requireAuth } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { userId } = await requireAuth(req);
    return NextResponse.json({ booking: await getBooking(id, userId) });
  } catch (error) {
    return toErrorResponse(error, "bookings.get");
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { userId } = await requireAuth(req);
    await cancelBooking(id, userId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return toErrorResponse(error, "bookings.cancel");
  }
}

export const dynamic = "force-dynamic";
