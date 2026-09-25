import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { confirmPaymentChallenge } from "@/lib/payment/payment-service";

/** Mock PSP: 3DS kodu zorunlu ve doğrulanır. Stripe: 3DS tarayıcıda tamamlanır, kod gönderilmez. */
const bodySchema = z.object({ code: z.string().regex(/^\d{4,8}$/).optional() });

/** 3DS doğrulama kodunu gönderir. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { userId } = await requireAuth(req);
    const { code } = bodySchema.parse(await req.json());
    return NextResponse.json(await confirmPaymentChallenge({ bookingId: id, userId, code: code ?? "" }));
  } catch (error) {
    return toErrorResponse(error, "bookings.pay.confirm");
  }
}

export const dynamic = "force-dynamic";
