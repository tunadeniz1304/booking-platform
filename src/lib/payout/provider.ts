import type { HostKycStatus } from "@prisma/client";

/**
 * Pazar yeri payout sağlayıcısı (P1-4, ADR 0021) — Stripe Connect tarzı: ev sahibi için bağlı
 * hesap açılır, KYC durumu sağlayıcıdan okunur, serbest bırakılmış bakiye bağlı hesaba
 * aktarılır. Anahtar yoksa `MockPayoutProvider` (ağ yok, deterministik referans).
 */
export interface ConnectedAccountStatus {
  kycStatus: HostKycStatus;
  payoutsEnabled: boolean;
}

export interface PayoutProvider {
  readonly name: "mock" | "stripe";
  /** Ev sahibi için bağlı hesap açar. Aynı kullanıcı için tekrar çağrı aynı hesabı döner. */
  createConnectedAccount(input: {
    userId: string;
    country?: string;
  }): Promise<{ accountRef: string } & ConnectedAccountStatus>;
  /** Bağlı hesabın güncel KYC / payout durumu. */
  getAccountStatus(accountRef: string): Promise<ConnectedAccountStatus>;
  /**
   * Bakiyeyi bağlı hesaba (veya mock'ta hayali banka hesabına) gönderir. `idempotencyKey`
   * payout kimliğinden türetilir → yeniden deneme en fazla bir aktarım yapar.
   */
  sendPayout(input: {
    idempotencyKey: string;
    amountMinor: bigint;
    currency: string;
    destination: string | null;
    metadata?: Record<string, string>;
  }): Promise<{ reference: string }>;
}

export class PayoutProviderError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "PayoutProviderError";
  }
}
