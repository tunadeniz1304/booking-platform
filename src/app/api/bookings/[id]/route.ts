import { NextRequest, NextResponse } from "next/server";
import {
  cancelBooking,
  getBooking,
  BookingConflictError,
  BookingNotFoundError,
  BookingUnauthorizedError,
} from "@/lib/booking-service";
import { getUserIdFromRequest } from "@/lib/auth";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const userId = getUserIdFromRequest(req);
    const booking = await getBooking(id, userId);
    return NextResponse.json({ booking });
  } catch (error) {
    return mapError(error);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const userId = getUserIdFromRequest(req);
    await cancelBooking(id, userId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return mapError(error);
  }
}

function mapError(error: unknown): NextResponse {
  if (error instanceof BookingConflictError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  if (error instanceof BookingNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof BookingUnauthorizedError) {
    return NextResponse.json({ error: error.message }, { status: 403 });
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
  console.error("Booking operation failed:", error);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

export const dynamic = "force-dynamic";
