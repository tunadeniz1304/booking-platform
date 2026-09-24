import { MockPsp } from "./mock-psp";
import { StripeProvider } from "./stripe-provider";
import type { PaymentProvider } from "./provider";

let override: PaymentProvider | null = null;
let cached: PaymentProvider | null = null;

/**
 * Aktif ödeme sağlayıcısı: `PAYMENT_PROVIDER=stripe` + `STRIPE_SECRET_KEY` → Stripe
 * (test mode), aksi hâlde deterministik MockPsp (ağ yok).
 */
export function getPaymentProvider(): PaymentProvider {
  if (override) return override;
  if (!cached) {
    const key = process.env.STRIPE_SECRET_KEY ?? "";
    cached =
      process.env.PAYMENT_PROVIDER === "stripe" && key ? new StripeProvider(key) : new MockPsp();
  }
  return cached;
}

/** Yalnızca testler için. */
export function setPaymentProviderForTests(provider: PaymentProvider | null): void {
  override = provider;
}

export type { PaymentProvider, AuthorizeResult } from "./provider";
export { PaymentProviderError } from "./provider";
