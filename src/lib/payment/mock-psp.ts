import { createHash } from "crypto";
import type { Money } from "@/lib/money/money";
import { MOCK_3DS_CODE, parseMockToken } from "./card-token";
import { PaymentProviderError, type AuthorizeResult, type PaymentProvider } from "./provider";

/**
 * Deterministik sahte PSP (ağ yok). Aynı idempotency anahtarı → aynı providerRef.
 * Senaryo token'dan okunur (`tok_mock_<ok|decline|3ds>_<son4>`).
 * 3DS doğrulama kodu demo için sabittir: 123456.
 */
function refFor(prefix: string, key: string): string {
  return `${prefix}_${createHash("sha256").update(key).digest("hex").slice(0, 24)}`;
}

export class MockPsp implements PaymentProvider {
  readonly name = "mock";

  async authorize(input: {
    amount: Money;
    cardToken: string;
    idempotencyKey: string;
    metadata?: Record<string, string>;
  }): Promise<AuthorizeResult> {
    const parsed = parseMockToken(input.cardToken);
    if (!parsed) throw new PaymentProviderError("invalid_token", "Geçersiz kart token'ı");
    if (input.amount.amount <= 0)
      throw new PaymentProviderError("invalid_amount", "Tutar pozitif olmalı");
    const providerRef = refFor("pi_mock", `${input.idempotencyKey}:${input.cardToken}`);
    if (parsed.scenario === "decline") {
      return { status: "declined", providerRef, declineCode: "card_declined" };
    }
    // Risk motoru "review" dediyse onaylanacak kartta da 3DS zorunlu.
    if (parsed.scenario === "3ds" || input.metadata?.force3ds === "1") {
      return {
        status: "requires_action",
        providerRef: `${providerRef}_3ds`,
        challenge: { type: "3ds_otp", hint: `Demo doğrulama kodu: ${MOCK_3DS_CODE}` },
      };
    }
    return { status: "authorized", providerRef };
  }

  async confirmChallenge(providerRef: string, code: string): Promise<AuthorizeResult> {
    if (!providerRef.endsWith("_3ds")) {
      throw new PaymentProviderError("no_challenge", "Bu ödeme için doğrulama beklenmiyor");
    }
    if (code !== MOCK_3DS_CODE) {
      return { status: "declined", providerRef, declineCode: "authentication_failed" };
    }
    return { status: "authorized", providerRef };
  }

  async capture(): Promise<{ status: "captured" }> {
    return { status: "captured" };
  }

  async refund(providerRef: string, amount: Money, idempotencyKey: string) {
    if (amount.amount <= 0)
      throw new PaymentProviderError("invalid_amount", "İade tutarı pozitif olmalı");
    return {
      status: "refunded" as const,
      refundRef: refFor("re_mock", `${providerRef}:${idempotencyKey}`),
    };
  }

  async describeToken(cardToken: string): Promise<{ bin: string | null }> {
    return { bin: parseMockToken(cardToken)?.bin ?? null };
  }

  async void(): Promise<{ status: "voided" }> {
    return { status: "voided" };
  }
}
