import { NextRequest, NextResponse } from "next/server";
import { getBooking, presentBooking } from "@/lib/booking-service";
import { cancelAndRefund } from "@/lib/payment/payment-service";
import { getRnplPlan } from "@/lib/payment/rnpl";
import { requireAuth } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";

export const GET = observed(
  "bookings.id",
  async function getHandler(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
      const { id } = await params;
      const { userId } = await requireAuth(req);
      const booking = presentBooking(await getBooking(id, userId));
      // P2-1: RNPL planı önbelleğe alınmaz (tahsilat durumu işçide değişir).
      return NextResponse.json({ booking, paymentPlan: await getRnplPlan(id, userId) });
    } catch (error) {
      return toErrorResponse(error, "bookings.get");
    }
  }
);

export const DELETE = observed(
  "bookings.id",
  async function deleteHandler(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
      const { id } = await params;
      const { userId } = await requireAuth(req);
      // İade tutarı rezervasyon anındaki iptal politikasına göre hesaplanır ve PSP'ye iletilir.
      return NextResponse.json(await cancelAndRefund(id, userId));
    } catch (error) {
      return toErrorResponse(error, "bookings.cancel");
    }
  }
);

export const dynamic = "force-dynamic";
