import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireVerifiedEmail } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";
import { confirmPaymentChallenge } from "@/lib/payment/payment-service";

/** Mock PSP: 3DS kodu zorunlu ve doğrulanır. Stripe: 3DS tarayıcıda tamamlanır, kod gönderilmez. */
const bodySchema = z.object({
  code: z
    .string()
    .regex(/^\d{4,8}$/)
    .optional(),
});

/** 3DS doğrulama kodunu gönderir. v5 P0-5: ödeme onay gecikmesi SLO'su bu rotayı ölçer. */
export const POST = observed(
  "bookings.pay.confirm",
  async function postHandler(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
      const { id } = await params;
      const { userId } = await requireVerifiedEmail(req);
      const { code } = bodySchema.parse(await req.json());
      return NextResponse.json(
        await confirmPaymentChallenge({ bookingId: id, userId, code: code ?? "" })
      );
    } catch (error) {
      return toErrorResponse(error, "bookings.pay.confirm");
    }
  }
);

export const dynamic = "force-dynamic";
