import { selectPaymentProvider } from "@/lib/payment";
import { MockPayoutProvider } from "./mock-payout";
import type { PayoutProvider } from "./provider";
import { StripeConnectPayoutProvider } from "./stripe-connect";

let override: PayoutProvider | null = null;
let cached: PayoutProvider | null = null;

/**
 * Payout sağlayıcısı ödeme sağlayıcısını izler: `PAYMENT_PROVIDER=stripe` (+ anahtar) →
 * Stripe Connect; aksi hâlde mock. Aynı ortamda tahsilat Stripe'ta, dağıtım mock'ta olmaz.
 */
export function getPayoutProvider(): PayoutProvider {
  if (override) return override;
  if (!cached) {
    cached =
      selectPaymentProvider() === "stripe"
        ? new StripeConnectPayoutProvider(process.env.STRIPE_SECRET_KEY ?? "")
        : new MockPayoutProvider();
  }
  return cached;
}

/** Yalnızca testler için. */
export function setPayoutProviderForTests(provider: PayoutProvider | null): void {
  override = provider;
}

export type { PayoutProvider, ConnectedAccountStatus } from "./provider";
export { PayoutProviderError } from "./provider";
export { MockPayoutProvider } from "./mock-payout";
