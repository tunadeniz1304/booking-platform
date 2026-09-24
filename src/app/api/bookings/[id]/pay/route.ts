import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { toErrorResponse, ValidationError } from "@/lib/http/errors";
import { payForBooking } from "@/lib/payment/payment-service";

const bodySchema = z.object({
  /** PSP hosted-field token'ı (kart numarası sunucuya gelmez). */
  cardToken: z.string().min(8).max(200),
});

/** HELD rezervasyonun ödemesi: authorize → (3DS) → capture → CONFIRMED. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { userId } = await requireAuth(req);
    const { cardToken } = bodySchema.parse(await req.json());
    const idempotencyKey = req.headers.get("idempotency-key")?.slice(0, 128);
    if (!idempotencyKey) throw new ValidationError("Idempotency-Key başlığı zorunludur");
    const outcome = await payForBooking({ bookingId: id, userId, cardToken, idempotencyKey });
    return NextResponse.json(outcome, { status: outcome.status === "confirmed" ? 200 : 202 });
  } catch (error) {
    return toErrorResponse(error, "bookings.pay");
  }
}

export const dynamic = "force-dynamic";
