import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createBooking, listUserBookings } from "@/lib/booking-service";
import { requireAuth } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";

const createBookingSchema = z.object({
  propertyId: z.string().min(1).max(64),
  roomId: z.string().min(1).max(64),
  checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  guestCount: z.number().int().positive().max(20),
  /** Checkout'ta gösterilen teklif; fiyat değiştiyse 409 PRICE_CHANGED. */
  quoteId: z.string().uuid().optional(),
  /** Fiyat planı (yoksa varsayılan) ve oda adedi (v3 P0-2). */
  ratePlanId: z.string().min(1).max(64).optional(),
  units: z.number().int().min(1).max(10).optional(),
});

export const POST = observed("bookings", async function postHandler(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const parsed = createBookingSchema.parse(await req.json());
    const idempotencyKey = req.headers.get("idempotency-key")?.slice(0, 128) || undefined;

    const booking = await createBooking({ userId, ...parsed, idempotencyKey });
    return NextResponse.json(booking, { status: 201 });
  } catch (error) {
    return toErrorResponse(error, "bookings.create");
  }
});

export const GET = observed("bookings", async function getHandler(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    return NextResponse.json(await listUserBookings(userId));
  } catch (error) {
    return toErrorResponse(error, "bookings.list");
  }
});

export const dynamic = "force-dynamic";
