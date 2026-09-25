import type { Money } from "@/lib/money/money";

/**
 * Stripe benzeri ödeme sağlayıcı arayüzü (auth → capture → refund, webhook).
 *
 * Kart verisi sunucuya ASLA gelmez: tarayıcıdaki "hosted field" kartı PSP'nin
 * tokenizer'ına verir ve sunucu yalnızca tek kullanımlık `cardToken` görür
 * (PCI-DSS SAQ A kapsamı).
 */

export interface PaymentChallenge {
  type: "3ds_otp" | "stripe_next_action";
  hint: string;
  clientSecret?: string;
}

export type AuthorizeResult =
  | { status: "authorized"; providerRef: string }
  | {
      status: "requires_action";
      providerRef: string;
      /**
       * 3DS doğrulaması için istemciye gösterilecek bilgi. Mock: tek kullanımlık kod ipucu;
       * Stripe: `clientSecret` ile tarayıcıda `handleNextAction`.
       */
      challenge: PaymentChallenge;
    }
  | { status: "declined"; providerRef: string; declineCode: string };

export interface PaymentProvider {
  readonly name: string;
  authorize(input: {
    amount: Money;
    cardToken: string;
    idempotencyKey: string;
    metadata?: Record<string, string>;
  }): Promise<AuthorizeResult>;
  /** 3DS doğrulamasını tamamlar. */
  confirmChallenge(providerRef: string, code: string): Promise<AuthorizeResult>;
  capture(providerRef: string, amount: Money): Promise<{ status: "captured" }>;
  refund(
    providerRef: string,
    amount: Money,
    idempotencyKey: string
  ): Promise<{ status: "refunded"; refundRef: string }>;
  void(providerRef: string): Promise<{ status: "voided" }>;
}

export class PaymentProviderError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "PaymentProviderError";
  }
}
