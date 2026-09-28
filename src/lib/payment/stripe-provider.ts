import Stripe from "stripe";
import type { Money } from "@/lib/money/money";
import {
  ALREADY_CAPTURED_CODE,
  PaymentProviderError,
  type AuthorizeResult,
  type ChargeSavedResult,
  type PaymentProvider,
  type SetupCardResult,
} from "./provider";

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

/** Stripe Shared Payment Token kimliği (`spt_…`; demo `spt_mock_…` değil). */
export function isSharedPaymentToken(token: string): boolean {
  return /^spt_[A-Za-z0-9]{6,}$/.test(token) && !token.startsWith("spt_mock");
}

export interface SharedPaymentTokenGrant {
  id: string;
  active: boolean;
  currency: string | null;
  maxAmountMinor: number | null;
  expiresAt: Date | null;
}

/** Genişletilmemiş (string) ya da genişletilmiş ({id}) Stripe başvurusunun kimliği. */
function refId(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value && typeof value.id === "string") {
    return value.id;
  }
  return null;
}

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
    customerRef?: string;
    setupFutureUsage?: "off_session";
  }): Promise<AuthorizeResult> {
    try {
      const spt = isSharedPaymentToken(input.cardToken);
      // P1-11: ajan ödemesinde token, Stripe Shared Payment Token'dır (`spt_…`); SDK tipinde
      // henüz yok → parametre elle eklenir. Kart verisi yine sunucuya gelmez.
      const params: Stripe.PaymentIntentCreateParams & { shared_payment_granted_token?: string } = {
        amount: input.amount.amount,
        currency: input.amount.currency.toLowerCase(),
        ...(spt
          ? { shared_payment_granted_token: input.cardToken }
          : { payment_method: input.cardToken }),
        // fix-sweep-2: depozito gereken ödemede kart müşteriye kaydedilir (ajan token'ı hariç:
        // SPT tek kullanımlık yetkidir, kaydedilemez).
        ...(!spt && input.customerRef ? { customer: input.customerRef } : {}),
        ...(!spt && input.customerRef && input.setupFutureUsage
          ? { setup_future_usage: input.setupFutureUsage }
          : {}),
        confirm: true,
        capture_method: "manual",
        automatic_payment_methods: { enabled: true, allow_redirects: "never" },
        metadata: input.metadata,
      };
      const intent = await this.stripe.paymentIntents.create(params, {
        idempotencyKey: input.idempotencyKey,
      });
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

  /**
   * Shared Payment Token kaydı (ACP/P1-11): kullanım limitleri (para birimi, azami tutar,
   * son geçerlilik) ve devre dışı olup olmadığı. Kart verisi dönmez.
   */
  async retrieveSharedPaymentToken(id: string): Promise<SharedPaymentTokenGrant> {
    const raw = (await this.call(() =>
      this.stripe.rawRequest("GET", `/v1/shared_payment/granted_tokens/${encodeURIComponent(id)}`)
    )) as {
      id?: string;
      deactivated_at?: number | null;
      usage_limits?: { currency?: string; max_amount?: number; expires_at?: number } | null;
    };
    const usage = raw.usage_limits ?? {};
    return {
      id: raw.id ?? id,
      active: !raw.deactivated_at,
      currency: usage.currency ? usage.currency.toUpperCase() : null,
      maxAmountMinor: typeof usage.max_amount === "number" ? usage.max_amount : null,
      expiresAt: typeof usage.expires_at === "number" ? new Date(usage.expires_at * 1000) : null,
    };
  }

  /** fix-sweep-2: depozito için PSP müşterisi (kart verisi yok; yalnız iç kullanıcı kimliği). */
  async createCustomer(input: { userId: string; idempotencyKey: string }) {
    const customer = await this.call(() =>
      this.stripe.customers.create(
        { metadata: { userId: input.userId } },
        { idempotencyKey: input.idempotencyKey }
      )
    );
    return { customerRef: customer.id };
  }

  /** 3DS istemcide tamamlanır; sunucu yalnızca intent'in son durumunu okur (kod kullanılmaz). */
  async confirmChallenge(providerRef: string): Promise<AuthorizeResult> {
    return this.toResult(await this.call(() => this.stripe.paymentIntents.retrieve(providerRef)));
  }

  async capture(providerRef: string, amount: Money, idempotencyKey?: string) {
    await this.call(() =>
      this.stripe.paymentIntents.capture(
        providerRef,
        { amount_to_capture: amount.amount },
        idempotencyKey ? { idempotencyKey } : undefined
      )
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

  /**
   * P1-5 depozito ön provizyonu: asıl PaymentIntent'in kartı + müşterisiyle off-session,
   * `capture_method=manual`. Kart ancak asıl ödeme müşteriye bağlı ve yeniden kullanılabilir
   * (setup_future_usage=off_session) ise kullanılabilir; değilse `payment_method_not_reusable`.
   * Off-session'da 3DS istenirse (authentication_required) ret sayılır.
   */
  async authorizeHold(input: {
    amount: Money;
    sourceProviderRef: string;
    idempotencyKey: string;
    metadata?: Record<string, string>;
  }): Promise<AuthorizeResult> {
    const source = await this.call(() =>
      this.stripe.paymentIntents.retrieve(input.sourceProviderRef)
    );
    const paymentMethod = refId(source.payment_method);
    const customer = refId(source.customer);
    if (!paymentMethod || !customer) {
      throw new PaymentProviderError(
        "payment_method_not_reusable",
        "Asıl ödemenin kartı depozito için yeniden kullanılamıyor"
      );
    }
    try {
      const intent = await this.stripe.paymentIntents.create(
        {
          amount: input.amount.amount,
          currency: input.amount.currency.toLowerCase(),
          customer,
          payment_method: paymentMethod,
          off_session: true,
          confirm: true,
          capture_method: "manual",
          metadata: { ...input.metadata, purpose: "damage_deposit" },
        },
        { idempotencyKey: input.idempotencyKey }
      );
      const result = this.toResult(intent);
      return result.status === "requires_action"
        ? { status: "declined", providerRef: intent.id, declineCode: "authentication_required" }
        : result;
    } catch (error) {
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

  /**
   * P1-3 RNPL: SetupIntent ile kartı müşteriye off-session kullanım için bağlar (tahsilat yok).
   * Doğrulama (3DS) gerekiyorsa RNPL sunulmaz: `authentication_required` reddi.
   */
  async setupCard(input: {
    cardToken: string;
    idempotencyKey: string;
    customerRef?: string;
    metadata?: Record<string, string>;
  }): Promise<SetupCardResult> {
    try {
      const intent = await this.stripe.setupIntents.create(
        {
          payment_method: input.cardToken,
          ...(input.customerRef ? { customer: input.customerRef } : {}),
          usage: "off_session",
          confirm: true,
          metadata: { ...input.metadata, purpose: "rnpl" },
        },
        { idempotencyKey: input.idempotencyKey }
      );
      const paymentMethodRef = refId(intent.payment_method);
      if (intent.status === "succeeded" && paymentMethodRef) {
        return { status: "succeeded", paymentMethodRef, customerRef: input.customerRef };
      }
      return { status: "declined", declineCode: "authentication_required" };
    } catch (error) {
      if (error instanceof Stripe.errors.StripeCardError) {
        return {
          status: "declined",
          declineCode: error.decline_code ?? error.code ?? "card_declined",
        };
      }
      return this.call(() => Promise.reject(error));
    }
  }

  /** P1-3 RNPL: kayıtlı kartla off-session, otomatik capture'lı PaymentIntent. */
  async chargeSaved(input: {
    amount: Money;
    paymentMethodRef: string;
    customerRef?: string;
    idempotencyKey: string;
    metadata?: Record<string, string>;
  }): Promise<ChargeSavedResult> {
    try {
      const intent = await this.stripe.paymentIntents.create(
        {
          amount: input.amount.amount,
          currency: input.amount.currency.toLowerCase(),
          payment_method: input.paymentMethodRef,
          ...(input.customerRef ? { customer: input.customerRef } : {}),
          off_session: true,
          confirm: true,
          metadata: { ...input.metadata, purpose: "rnpl" },
        },
        { idempotencyKey: input.idempotencyKey }
      );
      if (intent.status === "succeeded") return { status: "captured", providerRef: intent.id };
      return {
        status: "declined",
        providerRef: intent.id,
        declineCode: "authentication_required",
      };
    } catch (error) {
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

  /**
   * v5#1: iptal `payment_intent_unexpected_state` ile reddedilirse intent'in gerçek durumu okunur —
   * `succeeded` → `already_captured` (capture kesin), `canceled` → zaten void (idempotent).
   */
  async void(providerRef: string) {
    try {
      await this.call(() => this.stripe.paymentIntents.cancel(providerRef));
    } catch (error) {
      if (
        !(error instanceof PaymentProviderError) ||
        error.code !== "payment_intent_unexpected_state"
      )
        throw error;
      const intent = await this.call(() => this.stripe.paymentIntents.retrieve(providerRef));
      if (intent.status === "canceled") return { status: "voided" as const };
      if (intent.status === "succeeded") {
        throw new PaymentProviderError(ALREADY_CAPTURED_CODE, "Ödeme zaten tahsil edilmiş");
      }
      throw error;
    }
    return { status: "voided" as const };
  }
}
