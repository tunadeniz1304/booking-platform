import Stripe from "stripe";
import type { Money } from "@/lib/money/money";
import { PaymentProviderError, type AuthorizeResult, type PaymentProvider } from "./provider";

/**
 * Stripe (test mode) sağlayıcısı — resmî `stripe` SDK'sı, PaymentIntent akışı:
 * `confirm=true` + `capture_method=manual` ile yetkilendirme, sonra capture / refund / cancel.
 * `cardToken` = tarayıcıda Payment Element ile üretilmiş PaymentMethod kimliği (pm_…);
 * 3DS gerekirse `clientSecret` istemciye döner ve `stripe.handleNextAction` ile tamamlanır.
 *
 * HTTP katmanı `Stripe.createFetchHttpClient(fetchImpl)` ile enjekte edilebilir → testler
 * ağa çıkmadan kayıtlı yanıtlarla çalışır. Yalnızca `PAYMENT_PROVIDER=stripe` iken kullanılır;
 * aksi hâlde MockPsp devrededir (çevrimdışı yedek).
 */

/** SDK'nın kendi yeniden denemesi kapalı: idempotency anahtarları üst katmanda yönetilir. */
const STRIPE_MAX_NETWORK_RETRIES = 0;

type Intent = Pick<Stripe.PaymentIntent, "id" | "status" | "client_secret"> & {
  last_payment_error?: { decline_code?: string; code?: string } | null;
};

export class StripeProvider implements PaymentProvider {
  readonly name = "stripe";
  private readonly stripe: Stripe;

  constructor(secretKey: string, fetchImpl: typeof fetch = fetch) {
    this.stripe = new Stripe(secretKey, {
      httpClient: Stripe.createFetchHttpClient(fetchImpl),
      maxNetworkRetries: STRIPE_MAX_NETWORK_RETRIES,
      telemetry: false,
    });
  }

  /** SDK hatalarını alan hatasına çevirir; kart reddi ayrı ele alınır (bkz. authorize). */
  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof Stripe.errors.StripeError) {
        throw new PaymentProviderError(
          error.code ?? `http_${error.statusCode ?? "unknown"}`,
          "Ödeme sağlayıcısı isteği reddetti"
        );
      }
      throw error;
    }
  }

  private toResult(intent: Intent): AuthorizeResult {
    if (intent.status === "requires_capture" || intent.status === "succeeded") {
      return { status: "authorized", providerRef: intent.id };
    }
    if (intent.status === "requires_action") {
      return {
        status: "requires_action",
        providerRef: intent.id,
        challenge: {
          type: "stripe_next_action",
          hint: "Bankanızın doğrulama ekranını tamamlayın",
          clientSecret: intent.client_secret ?? undefined,
        },
      };
    }
    return {
      status: "declined",
      providerRef: intent.id,
      declineCode:
        intent.last_payment_error?.decline_code ?? intent.last_payment_error?.code ?? "declined",
    };
  }

  async authorize(input: {
    amount: Money;
    cardToken: string;
    idempotencyKey: string;
    metadata?: Record<string, string>;
  }): Promise<AuthorizeResult> {
    try {
      const intent = await this.stripe.paymentIntents.create(
        {
          amount: input.amount.amount,
          currency: input.amount.currency.toLowerCase(),
          payment_method: input.cardToken,
          confirm: true,
          capture_method: "manual",
          automatic_payment_methods: { enabled: true, allow_redirects: "never" },
          metadata: input.metadata,
        },
        { idempotencyKey: input.idempotencyKey }
      );
      return this.toResult(intent);
    } catch (error) {
      // confirm=true ile kart reddi 402 StripeCardError olarak gelir; bu bir "ret" sonucudur.
      if (error instanceof Stripe.errors.StripeCardError) {
        const raw = error.raw as { payment_intent?: { id?: string } } | undefined;
        return {
          status: "declined",
          providerRef: raw?.payment_intent?.id ?? `declined:${input.idempotencyKey}`,
          declineCode: error.decline_code ?? error.code ?? "card_declined",
        };
      }
      return this.call(() => Promise.reject(error));
    }
  }

  /** 3DS istemcide tamamlanır; sunucu yalnızca intent'in son durumunu okur (kod kullanılmaz). */
  async confirmChallenge(providerRef: string): Promise<AuthorizeResult> {
    return this.toResult(await this.call(() => this.stripe.paymentIntents.retrieve(providerRef)));
  }

  async capture(providerRef: string, amount: Money) {
    await this.call(() =>
      this.stripe.paymentIntents.capture(providerRef, { amount_to_capture: amount.amount })
    );
    return { status: "captured" as const };
  }

  async refund(providerRef: string, amount: Money, idempotencyKey: string) {
    const refund = await this.call(() =>
      this.stripe.refunds.create(
        { payment_intent: providerRef, amount: amount.amount },
        { idempotencyKey }
      )
    );
    return { status: "refunded" as const, refundRef: refund.id };
  }

  async void(providerRef: string) {
    await this.call(() => this.stripe.paymentIntents.cancel(providerRef));
    return { status: "voided" as const };
  }
}
