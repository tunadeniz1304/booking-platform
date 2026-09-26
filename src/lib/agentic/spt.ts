import { getPaymentProvider, PaymentProviderError, type PaymentProvider } from "@/lib/payment";
import { isSharedPaymentToken, type SharedPaymentTokenGrant } from "@/lib/payment/stripe-provider";
import { HttpError, ValidationError } from "@/lib/http/errors";

/**
 * ACP paylaşılan ödeme token'ı (SPT) → PSP kart token'ı (P1-11).
 *
 *  - Stripe aktifse: `spt_…` Stripe Shared Payment Token'dır. Kaydı PSP'den okunur ve
 *    kullanım limitleri (etkin, para birimi, azami tutar, son geçerlilik) bu ödemeye karşı
 *    doğrulanır; PaymentIntent `shared_payment_granted_token` ile oluşturulur (adaptör:
 *    `StripeProvider`). Platform merchant-of-record kalır: tahsilat platform hesabına.
 *  - Aksi hâlde (mock/demo): `spt_mock_<ok|decline|3ds>` → MockPsp kart token'ı.
 * Tanınmayan token 400 döner ve asla yetkilendirmeye gitmez.
 */

const MOCK_SPT = /^spt_mock_(ok|decline|3ds)$/;

interface SptCapable {
  retrieveSharedPaymentToken(id: string): Promise<SharedPaymentTokenGrant>;
}

function sptCapable(provider: PaymentProvider): (PaymentProvider & SptCapable) | null {
  const candidate = provider as PaymentProvider & Partial<SptCapable>;
  return typeof candidate.retrieveSharedPaymentToken === "function"
    ? (candidate as PaymentProvider & SptCapable)
    : null;
}

/** Aktif SPT yolu (görünüm için; sağlayıcı yapılandırılmamışsa mock). */
export function activeSptProvider(): "stripe" | "mock" {
  try {
    return sptCapable(getPaymentProvider()) ? "stripe" : "mock";
  } catch {
    return "mock";
  }
}

export async function sptToCardToken(
  spt: string,
  expected: { amountMinor: number; currency: string },
  provider: PaymentProvider = getPaymentProvider(),
  now = new Date()
): Promise<string> {
  const stripe = sptCapable(provider);
  if (!stripe) {
    const match = MOCK_SPT.exec(spt);
    if (!match) throw new ValidationError("Geçersiz paylaşılan ödeme token'ı (SPT)");
    return `tok_mock_${match[1]}_0000`;
  }
  if (!isSharedPaymentToken(spt)) {
    throw new ValidationError("Geçersiz paylaşılan ödeme token'ı (SPT)");
  }
  let grant: SharedPaymentTokenGrant;
  try {
    grant = await stripe.retrieveSharedPaymentToken(spt);
  } catch (error) {
    if (error instanceof PaymentProviderError) {
      throw new ValidationError("Paylaşılan ödeme token'ı PSP'de bulunamadı");
    }
    throw error;
  }
  if (!grant.active || (grant.expiresAt && grant.expiresAt <= now)) {
    throw new HttpError(402, "SPT_INACTIVE", "Paylaşılan ödeme token'ı artık geçerli değil");
  }
  if (grant.currency && grant.currency !== expected.currency.toUpperCase()) {
    throw new HttpError(402, "SPT_CURRENCY_MISMATCH", "Token para birimi ödemeyle uyuşmuyor");
  }
  if (grant.maxAmountMinor !== null && grant.maxAmountMinor < expected.amountMinor) {
    throw new HttpError(402, "SPT_LIMIT_EXCEEDED", "Tutar token'ın kullanım limitini aşıyor", {
      maxAmountMinor: grant.maxAmountMinor,
      amountMinor: expected.amountMinor,
    });
  }
  return grant.id;
}
