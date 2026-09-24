import { NextRequest, NextResponse } from "next/server";
import { getBooking } from "@/lib/booking-service";
import { cancelAndRefund } from "@/lib/payment/payment-service";
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
    // İade tutarı rezervasyon anındaki iptal politikasına göre hesaplanır ve PSP'ye iletilir.
    return NextResponse.json(await cancelAndRefund(id, userId));
  } catch (error) {
    return toErrorResponse(error, "bookings.cancel");
  }
}

export const dynamic = "force-dynamic";
