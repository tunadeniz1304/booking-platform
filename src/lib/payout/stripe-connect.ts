import Stripe from "stripe";
import { PayoutProviderError, type ConnectedAccountStatus, type PayoutProvider } from "./provider";

/**
 * Stripe Connect adaptörü (test mode): Express bağlı hesap + platform bakiyesinden
 * `transfers.create` ile aktarım (separate charges & transfers). Bağlı hesabın kendi banka
 * payout takvimi Stripe'tadır; burada "payout" = platform → bağlı hesap aktarımı.
 * HTTP katmanı enjekte edilebilir → testler ağa çıkmaz (`tests/support/stripe-fake.ts`).
 */
const STRIPE_MAX_NETWORK_RETRIES = 0;

type AccountLike = Pick<Stripe.Account, "id" | "payouts_enabled" | "details_submitted"> & {
  requirements?: { disabled_reason?: string | null } | null;
};

/** Stripe hesap alanlarından KYC durumu (deterministik eşleme). */
export function kycFromStripeAccount(a: AccountLike): ConnectedAccountStatus {
  const disabled = a.requirements?.disabled_reason ?? null;
  if (disabled && disabled.startsWith("rejected")) {
    return { kycStatus: "REJECTED", payoutsEnabled: false };
  }
  if (a.payouts_enabled && a.details_submitted) {
    return { kycStatus: "VERIFIED", payoutsEnabled: true };
  }
  return { kycStatus: a.details_submitted ? "PENDING" : "NOT_STARTED", payoutsEnabled: false };
}

export class StripeConnectPayoutProvider implements PayoutProvider {
  readonly name = "stripe" as const;
  private readonly stripe: Stripe;

  constructor(secretKey: string, fetchImpl: typeof fetch = fetch) {
    this.stripe = new Stripe(secretKey, {
      httpClient: Stripe.createFetchHttpClient(fetchImpl),
      maxNetworkRetries: STRIPE_MAX_NETWORK_RETRIES,
      telemetry: false,
    });
  }

  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof Stripe.errors.StripeError) {
        throw new PayoutProviderError(
          error.code ?? `http_${error.statusCode ?? "unknown"}`,
          "Payout sağlayıcısı isteği reddetti"
        );
      }
      throw error;
    }
  }

  async createConnectedAccount(input: { userId: string; country?: string }) {
    const account = await this.call(() =>
      this.stripe.accounts.create(
        {
          type: "express",
          ...(input.country ? { country: input.country } : {}),
          capabilities: { transfers: { requested: true } },
          metadata: { userId: input.userId },
        },
        { idempotencyKey: `connect-account:${input.userId}` }
      )
    );
    return { accountRef: account.id, ...kycFromStripeAccount(account) };
  }

  async getAccountStatus(accountRef: string) {
    return kycFromStripeAccount(await this.call(() => this.stripe.accounts.retrieve(accountRef)));
  }

  async sendPayout(input: {
    idempotencyKey: string;
    amountMinor: bigint;
    currency: string;
    destination: string | null;
    metadata?: Record<string, string>;
  }) {
    if (!input.destination) {
      throw new PayoutProviderError("no_destination", "Bağlı hesap yok");
    }
    if (input.amountMinor <= 0n || input.amountMinor > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new PayoutProviderError("invalid_amount", "Geçersiz payout tutarı");
    }
    const transfer = await this.call(() =>
      this.stripe.transfers.create(
        {
          amount: Number(input.amountMinor),
          currency: input.currency.toLowerCase(),
          destination: input.destination!,
          metadata: input.metadata,
        },
        { idempotencyKey: input.idempotencyKey }
      )
    );
    return { reference: transfer.id };
  }
}
