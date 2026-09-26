import { verifyWebhook, WebhookSignatureError, type WebhookEvent } from "./webhook";
import { verifyStripeWebhook } from "./stripe-webhook";

/**
 * Webhook imzasını YALNIZCA aktif ödeme sağlayıcısının şemasıyla doğrular (v4#16).
 *
 *  - Stripe aktifken: yalnızca `Stripe-Signature` (SDK `constructEvent`). Mock PSP'nin HMAC
 *    başlığı (`x-psp-signature`) ile gelen olay reddedilir — mock sırrını bilen biri gerçek
 *    ortamda sahte "ödendi" olayı üretemez.
 *  - Mock aktifken: yalnızca `x-psp-signature`.
 *
 * Başka sağlayıcının imzası (ya da hiç imza) → `WebhookProviderMismatchError` (route: 401).
 * Aktif sağlayıcının imzası geçersizse → `WebhookSignatureError` (route: 400).
 */
export class WebhookProviderMismatchError extends Error {
  constructor(readonly activeProvider: string) {
    super("Webhook imzası aktif ödeme sağlayıcısına ait değil");
    this.name = "WebhookProviderMismatchError";
  }
}

export function verifyActiveProviderWebhook(
  activeProvider: string,
  rawBody: string,
  headers: Headers
): WebhookEvent | null {
  const stripeSignature = headers.get("stripe-signature");
  const mockSignature = headers.get("x-psp-signature");
  if (activeProvider === "stripe") {
    if (!stripeSignature) throw new WebhookProviderMismatchError(activeProvider);
    return verifyStripeWebhook(rawBody, stripeSignature);
  }
  if (activeProvider === "mock") {
    if (!mockSignature) throw new WebhookProviderMismatchError(activeProvider);
    return verifyWebhook(rawBody, mockSignature);
  }
  throw new WebhookSignatureError(`Bilinmeyen ödeme sağlayıcısı: ${activeProvider}`);
}
