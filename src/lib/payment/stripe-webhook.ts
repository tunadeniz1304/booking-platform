import Stripe from "stripe";
import { WebhookSignatureError, webhookEventSchema, type WebhookEvent } from "./webhook";

/**
 * Gerçek Stripe webhook'u (#10): `Stripe-Signature` başlığı SDK'nın
 * `webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET)` ile doğrulanır, ardından
 * olay iç biçime (`WebhookEvent`) çevrilir → aynı idempotent işleyici (PaymentEvent tekilliği).
 *
 *  - `payment_intent.succeeded`       → `payment.succeeded` (tutar = `amount_received`)
 *  - `payment_intent.payment_failed`  → `payment.failed`
 *  - `charge.refunded`                → `refund.succeeded` (ref = `charge.payment_intent`)
 *
 * Diğer olay türleri imzası doğrulandıktan sonra yok sayılır (`null`).
 */

type StripeEvent = ReturnType<typeof Stripe.webhooks.constructEvent>;

function secret(): string {
  const value = process.env.STRIPE_WEBHOOK_SECRET ?? "";
  if (!value) throw new WebhookSignatureError("Stripe webhook sırrı yapılandırılmamış");
  return value;
}

function refOf(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value && typeof value.id === "string") {
    return value.id;
  }
  return null;
}

/** Doğrulanmış Stripe olayını iç olaya çevirir; ilgisiz türler için `null`. */
export function mapStripeEvent(event: StripeEvent): WebhookEvent | null {
  const object = event.data.object as unknown as Record<string, unknown>;
  let mapped: unknown = null;
  switch (event.type) {
    case "payment_intent.succeeded":
      mapped = {
        id: event.id,
        type: "payment.succeeded",
        data: {
          providerRef: object.id,
          amount: object.amount_received ?? object.amount,
          currency: String(object.currency ?? "").toUpperCase(),
        },
      };
      break;
    case "payment_intent.payment_failed":
      mapped = { id: event.id, type: "payment.failed", data: { providerRef: object.id } };
      break;
    case "charge.refunded": {
      const providerRef = refOf(object.payment_intent);
      if (!providerRef) return null;
      mapped = { id: event.id, type: "refund.succeeded", data: { providerRef } };
      break;
    }
    default:
      return null;
  }
  const parsed = webhookEventSchema.safeParse(mapped);
  if (!parsed.success) throw new WebhookSignatureError("Olay gövdesi geçersiz");
  return parsed.data;
}

export function verifyStripeWebhook(
  rawBody: string,
  header: string | null,
  webhookSecret = secret()
): WebhookEvent | null {
  if (!header) throw new WebhookSignatureError("İmza başlığı yok");
  let event: StripeEvent;
  try {
    event = Stripe.webhooks.constructEvent(rawBody, header, webhookSecret);
  } catch {
    throw new WebhookSignatureError("İmza doğrulanamadı");
  }
  return mapStripeEvent(event);
}
