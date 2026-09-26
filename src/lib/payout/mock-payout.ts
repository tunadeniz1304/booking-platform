import { createHash } from "crypto";
import { PayoutProviderError, type PayoutProvider } from "./provider";

const REF_HEX_LENGTH = 24;

function digest(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, REF_HEX_LENGTH);
}

/**
 * Çevrimdışı payout sağlayıcısı (MockPsp payout). Bağlı hesap anında "doğrulanmış" sayılır
 * (deterministik mock KYC); gönderim `po_mock_<sha256(payout:<id>)>` referansı döner — eski
 * devir payout referansıyla aynı biçim (geriye uyum).
 */
export class MockPayoutProvider implements PayoutProvider {
  readonly name = "mock" as const;

  async createConnectedAccount(input: Parameters<PayoutProvider["createConnectedAccount"]>[0]) {
    return {
      accountRef: `acct_mock_${digest(`account:${input.userId}`)}`,
      kycStatus: "VERIFIED" as const,
      payoutsEnabled: true,
    };
  }

  async getAccountStatus() {
    return { kycStatus: "VERIFIED" as const, payoutsEnabled: true };
  }

  async sendPayout(input: Parameters<PayoutProvider["sendPayout"]>[0]) {
    if (input.amountMinor <= 0n)
      throw new PayoutProviderError("invalid_amount", "Payout tutarı pozitif olmalı");
    return { reference: `po_mock_${digest(input.idempotencyKey)}` };
  }
}
