import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { stepUpOptions } from "@/lib/auth/passkey";
import { toErrorResponse } from "@/lib/http/errors";
import { stepUpBindingFor } from "@/lib/payment/payment-service";
import { z } from "zod";
import { observed } from "@/lib/http/observed";

const bodySchema = z.object({ bookingId: z.string().min(1).max(64) });

/**
 * Risk bazlı step-up (P1-8): oturumdaki kullanıcının kendi (soğuma süresini doldurmuş)
 * passkey'leriyle `get()` seçenekleri. Doğrulama rezervasyona + sunucuda hesaplanan tutara
 * bağlanır (v4#2).
 */
export const POST = observed("auth.stepup.options", async function postHandler(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const { bookingId } = bodySchema.parse(await req.json());
    const binding = await stepUpBindingFor(bookingId, userId);
    return NextResponse.json(await stepUpOptions(userId, binding));
  } catch (error) {
    return toErrorResponse(error, "auth.stepup.options");
  }
});

export const dynamic = "force-dynamic";
