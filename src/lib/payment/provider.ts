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
    /** fix-sweep-2: ödemenin bağlanacağı PSP müşterisi (`createCustomer`). */
    customerRef?: string;
    /** fix-sweep-2: kart sonraki off-session kullanım (depozito) için kaydedilsin. */
    setupFutureUsage?: "off_session";
  }): Promise<AuthorizeResult>;
  /**
   * fix-sweep-2: PSP müşterisi (Stripe Customer) açar; hasar depozitosunun kartı off-session
   * kullanabilmesi için. Desteklemeyen sağlayıcı → metot yok (MockPsp).
   */
  createCustomer?(input: { userId: string; idempotencyKey: string }): Promise<{
    customerRef: string;
  }>;
  /** 3DS doğrulamasını tamamlar. */
  confirmChallenge(providerRef: string, code: string): Promise<AuthorizeResult>;
  /**
   * v5#2: `idempotencyKey` verilirse PSP aynı anahtarlı tekrar capture'ı tek işlem sayar (yeniden
   * deneme / süpürücü uzlaştırması çift tahsilat yapmaz). Verilmezse sağlayıcı varsayılanı.
   */
  capture(
    providerRef: string,
    amount: Money,
    idempotencyKey?: string
  ): Promise<{ status: "captured" }>;
  refund(
    providerRef: string,
    amount: Money,
    idempotencyKey: string
  ): Promise<{ status: "refunded"; refundRef: string }>;
  void(providerRef: string): Promise<{ status: "voided" }>;
  /**
   * Token metadata'sı (v4#13): kartın BIN'i (ilk 6 hane) PSP'nin token kaydından okunur;
   * istemcinin gönderdiği BIN'e güvenilmez. Desteklemeyen sağlayıcı → metot yok / `bin: null`.
   */
  describeToken?(cardToken: string): Promise<{ bin: string | null }>;
  /**
   * P1-5 hasar depozitosu: asıl tahsilatın kartıyla AYRI, kullanıcı yokken (off-session)
   * ön provizyon (manuel capture). Sonra `capture(ref, tutar)` (kısmi olabilir; ön provizyonu
   * aşamaz) ya da `void(ref)`. Desteklemeyen sağlayıcı → metot yok (depozito FAILED).
   */
  authorizeHold?(input: {
    amount: Money;
    /** Kartı yeniden kullanılacak asıl tahsilatın PSP kimliği. */
    sourceProviderRef: string;
    idempotencyKey: string;
    metadata?: Record<string, string>;
  }): Promise<AuthorizeResult>;
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

/**
 * v5#1: void reddinin nedeni "ödeme zaten tahsil edildi" ise sağlayıcılar bu kodu fırlatır
 * (Stripe: iptal edilemeyen `succeeded` PaymentIntent). Yalnız bu durumda capture KESİNDİR;
 * diğer void hataları (ağ, zaman aşımı, `psp_unavailable`) capture hakkında bilgi vermez.
 */
export const ALREADY_CAPTURED_CODE = "already_captured";

export function isAlreadyCapturedError(error: unknown): boolean {
  return error instanceof PaymentProviderError && error.code === ALREADY_CAPTURED_CODE;
}
