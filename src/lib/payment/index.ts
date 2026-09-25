import { MockPsp } from "./mock-psp";
import { StripeProvider } from "./stripe-provider";
import type { PaymentProvider } from "./provider";
import { isDemoMode } from "@/lib/config/demo";

let override: PaymentProvider | null = null;
let cached: PaymentProvider | null = null;

/**
 * Sağlayıcı seçimi (saf, test edilebilir):
 *  - `PAYMENT_PROVIDER=stripe` → Stripe (anahtar yoksa hata; sessizce mock'a düşmez).
 *  - `PAYMENT_PROVIDER=mock` → MockPsp (açık tercih).
 *  - Belirtilmemiş → yalnızca demo modunda MockPsp; demo dışı ortamda hata (v3#11:
 *    gerçek ortam yanlışlıkla sahte ödeme sağlayıcısıyla açılmaz).
 */
export function selectPaymentProvider(
  env: Record<string, string | undefined> = process.env
): "stripe" | "mock" {
  const choice = env.PAYMENT_PROVIDER?.trim().toLowerCase();
  if (choice === "stripe") {
    if (!env.STRIPE_SECRET_KEY)
      throw new Error("PAYMENT_PROVIDER=stripe için STRIPE_SECRET_KEY gerekli");
    return "stripe";
  }
  if (choice === "mock") return "mock";
  if (choice) throw new Error(`Bilinmeyen PAYMENT_PROVIDER: ${choice}`);
  if (isDemoMode(env)) return "mock";
  throw new Error("Demo modu dışında PAYMENT_PROVIDER açıkça ayarlanmalı (stripe | mock)");
}

/** Aktif ödeme sağlayıcısı (süreç ömrü boyunca tekil). */
export function getPaymentProvider(): PaymentProvider {
  if (override) return override;
  if (!cached) {
    cached =
      selectPaymentProvider() === "stripe"
        ? new StripeProvider(process.env.STRIPE_SECRET_KEY ?? "")
        : new MockPsp();
  }
  return cached;
}

/** Yalnızca testler için. */
export function setPaymentProviderForTests(provider: PaymentProvider | null): void {
  override = provider;
}

export type { PaymentProvider, AuthorizeResult } from "./provider";
export { PaymentProviderError } from "./provider";
