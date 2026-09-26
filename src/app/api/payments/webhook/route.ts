import { NextRequest, NextResponse } from "next/server";
import { handleWebhookEvent } from "@/lib/payment/payment-service";
import { WebhookSignatureError } from "@/lib/payment/webhook";
import {
  verifyActiveProviderWebhook,
  WebhookProviderMismatchError,
} from "@/lib/payment/webhook-verify";
import { getPaymentProvider } from "@/lib/payment";
import { toErrorResponse } from "@/lib/http/errors";
import { logger } from "@/lib/observability/logger";
import { handleDisputeEvent, isDisputeEvent } from "@/lib/resolution/disputes";

/**
 * PSP webhook'u. İmza YALNIZCA aktif sağlayıcının şemasıyla doğrulanır (v4#16): Stripe
 * aktifken `Stripe-Signature` (`constructEvent`), mock aktifken `x-psp-signature` (HMAC,
 * timing-safe, 5 dk tolerans). Diğer sağlayıcının imzası → 401; geçersiz imza → 400.
 * Olay kimliği tekildir: replay 200 döner ama ikinci kez etki etmez.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  let event;
  try {
    event = verifyActiveProviderWebhook(getPaymentProvider().name, raw, req.headers);
  } catch (error) {
    if (error instanceof WebhookProviderMismatchError) {
      logger.warn({ activeProvider: error.activeProvider }, "webhook signed for another provider");
      return NextResponse.json(
        { error: "Webhook imzası aktif sağlayıcıya ait değil", code: "WRONG_PROVIDER_SIGNATURE" },
        { status: 401 }
      );
    }
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
    // P1-5: PSP itirazı → çözüm merkezinde CHARGEBACK talebi (ödeme durumu değişmez).
    if (isDisputeEvent(event)) {
      const { duplicate } = await handleDisputeEvent(event);
      return NextResponse.json({ received: true, duplicate });
    }
    const { duplicate } = await handleWebhookEvent(event);
    return NextResponse.json({ received: true, duplicate });
  } catch (error) {
    return toErrorResponse(error, "payments.webhook");
  }
}

export const dynamic = "force-dynamic";
