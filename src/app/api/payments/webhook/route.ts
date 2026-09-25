import { NextRequest, NextResponse } from "next/server";
import { handleWebhookEvent } from "@/lib/payment/payment-service";
import { verifyWebhook, WebhookSignatureError } from "@/lib/payment/webhook";
import { verifyStripeWebhook } from "@/lib/payment/stripe-webhook";
import { toErrorResponse } from "@/lib/http/errors";

/**
 * PSP webhook'u. `Stripe-Signature` varsa gerçek Stripe olayı (`constructEvent`), yoksa
 * mock PSP'nin HMAC imzası (`x-psp-signature`, timing-safe, 5 dk tolerans).
 * Olay kimliği tekildir: replay 200 döner ama ikinci kez etki etmez.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  let event;
  try {
    const stripeSignature = req.headers.get("stripe-signature");
    event = stripeSignature
      ? verifyStripeWebhook(raw, stripeSignature)
      : verifyWebhook(raw, req.headers.get("x-psp-signature"));
  } catch (error) {
    if (error instanceof WebhookSignatureError || error instanceof SyntaxError) {
      return NextResponse.json(
        { error: "Geçersiz imza", code: "INVALID_SIGNATURE" },
        { status: 400 }
      );
    }
    return toErrorResponse(error, "payments.webhook");
  }
  // İmzası geçerli ama ilgilenmediğimiz Stripe olay türü → 200 (Stripe yeniden denemesin).
  if (!event) return NextResponse.json({ received: true, ignored: true });
  try {
    const { duplicate } = await handleWebhookEvent(event);
    return NextResponse.json({ received: true, duplicate });
  } catch (error) {
    return toErrorResponse(error, "payments.webhook");
  }
}

export const dynamic = "force-dynamic";
