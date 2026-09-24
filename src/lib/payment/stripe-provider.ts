import type { Money } from "@/lib/money/money";
import { PaymentProviderError, type AuthorizeResult, type PaymentProvider } from "./provider";

/**
 * Opsiyonel Stripe (test mode) sağlayıcısı — SDK'sız, Stripe REST API'si `fetch` ile.
 * Yalnızca `PAYMENT_PROVIDER=stripe` ve `STRIPE_SECRET_KEY` tanımlıyken kullanılır;
 * aksi hâlde MockPsp devrededir. `cardToken` = tarayıcıda Stripe.js ile üretilmiş
 * PaymentMethod kimliği (pm_…); 3DS istemci tarafında Stripe.js ile tamamlanır.
 */
const API = "https://api.stripe.com/v1";

type Fetch = typeof fetch;

interface Intent {
  id: string;
  status: string;
  last_payment_error?: { decline_code?: string; code?: string };
}

export class StripeProvider implements PaymentProvider {
  readonly name = "stripe";

  constructor(
    private readonly secretKey: string,
    private readonly fetchImpl: Fetch = fetch
  ) {}

  private async call<T>(
    path: string,
    params: Record<string, string>,
    idempotencyKey?: string,
    method = "POST"
  ): Promise<T> {
    const res = await this.fetchImpl(`${API}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.secretKey}`,
        "content-type": "application/x-www-form-urlencoded",
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      },
      body: method === "GET" ? undefined : new URLSearchParams(params).toString(),
    });
    const body = (await res.json()) as T & { error?: { code?: string; message?: string } };
    if (!res.ok) {
      throw new PaymentProviderError(
        body.error?.code ?? `http_${res.status}`,
        "Ödeme sağlayıcısı isteği reddetti"
      );
    }
    return body;
  }

  private toResult(intent: Intent): AuthorizeResult {
    if (intent.status === "requires_capture" || intent.status === "succeeded") {
      return { status: "authorized", providerRef: intent.id };
    }
    if (intent.status === "requires_action") {
      return {
        status: "requires_action",
        providerRef: intent.id,
        challenge: { type: "3ds_otp", hint: "Bankanızın doğrulama ekranını tamamlayın" },
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
  }): Promise<AuthorizeResult> {
    const intent = await this.call<Intent>(
      "/payment_intents",
      {
        amount: String(input.amount.amount),
        currency: input.amount.currency.toLowerCase(),
        payment_method: input.cardToken,
        confirm: "true",
        capture_method: "manual",
        "automatic_payment_methods[enabled]": "true",
        "automatic_payment_methods[allow_redirects]": "never",
      },
      input.idempotencyKey
    );
    return this.toResult(intent);
  }

  async confirmChallenge(providerRef: string): Promise<AuthorizeResult> {
    return this.toResult(
      await this.call<Intent>(`/payment_intents/${providerRef}`, {}, undefined, "GET")
    );
  }

  async capture(providerRef: string, amount: Money) {
    await this.call(`/payment_intents/${providerRef}/capture`, {
      amount_to_capture: String(amount.amount),
    });
    return { status: "captured" as const };
  }

  async refund(providerRef: string, amount: Money, idempotencyKey: string) {
    const refund = await this.call<{ id: string }>(
      "/refunds",
      { payment_intent: providerRef, amount: String(amount.amount) },
      idempotencyKey
    );
    return { status: "refunded" as const, refundRef: refund.id };
  }

  async void(providerRef: string) {
    await this.call(`/payment_intents/${providerRef}/cancel`, {});
    return { status: "voided" as const };
  }
}
