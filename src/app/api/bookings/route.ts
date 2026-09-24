import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createBooking } from "@/lib/booking-service";
import { getUserIdFromRequest } from "@/lib/auth";
import { listUserBookings } from "@/lib/booking-service";

const createBookingSchema = z.object({
  propertyId: z.string().min(1),
  roomId: z.string().min(1),
  checkIn: z.string().min(1),
  checkOut: z.string().min(1),
  guestCount: z.number().int().positive(),
});

export async function POST(req: NextRequest) {
  try {
    const userId = getUserIdFromRequest(req);
    const body = await req.json();
    const parsed = createBookingSchema.parse(body);
    const idempotencyKey = req.headers.get("idempotency-key") ?? undefined;

    const booking = await createBooking({
      userId,
      propertyId: parsed.propertyId,
      roomId: parsed.roomId,
      checkIn: parsed.checkIn,
      checkOut: parsed.checkOut,
      guestCount: parsed.guestCount,
      idempotencyKey,
    });

    return NextResponse.json(booking, { status: 201 });
  } catch (error) {
    return handleBookingError(error);
  }
}

export async function GET(req: NextRequest) {
  try {
    const userId = getUserIdFromRequest(req);
    const bookings = await listUserBookings(userId);
    return NextResponse.json(bookings);
  } catch (error) {
    return handleBookingError(error);
  }
}

function handleBookingError(error: unknown): NextResponse {
  if (error instanceof z.ZodError) {
    return NextResponse.json({ error: "Validation error", details: error.errors }, { status: 400 });
  }
  if (error instanceof Error && error.message === "Missing or invalid token") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (error instanceof Error && error.message === "Invalid token") {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }
  if (error instanceof Error && error.message === "Missing authorization header") {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }
  // Booking-service tip hataları
  const typeName = (error as Error)?.constructor?.name;
  if (typeName === "BookingConflictError") {
    return NextResponse.json({ error: (error as Error).message }, { status: 409 });
  }
  if (typeName === "BookingValidationError") {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
  if (typeName === "BookingNotFoundError") {
    return NextResponse.json({ error: (error as Error).message }, { status: 404 });
  }
  if (typeName === "BookingUnauthorizedError") {
    return NextResponse.json({ error: (error as Error).message }, { status: 403 });
  }
  console.error("Failed booking operation:", error);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

export const dynamic = "force-dynamic";
