"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { useFormat } from "@/i18n/use-format";

/** Sunucunun `/pay` yanıtı (yalnızca formun ihtiyaç duyduğu alanlar). */
export interface PayResponse {
  status: string;
  challenge?: { hint: string; clientSecret?: string };
}

interface Props {
  publishableKey: string;
  amountMinor: number;
  currency: string;
  busy: boolean;
  /** `pm_…` kimliğini `/pay`'e gönderir. */
  submit: (cardToken: string) => Promise<PayResponse>;
  /** 3DS tamamlandıktan sonra sunucuya intent'i yeniden okutur (`/pay/confirm`). */
  confirm: () => Promise<void>;
  onError: (text: string) => void;
}

/**
 * Stripe Payment Element (#10): kart verisi Stripe iframe'inde kalır (PCI SAQ A).
 * Tarayıcı yalnızca PaymentMethod oluşturur; PaymentIntent sunucuda `capture_method=manual`
 * ile yaratılır. 3DS gerekirse `handleNextAction(clientSecret)` ile tarayıcıda tamamlanır.
 */
export default function StripePaymentForm(props: Props) {
  const stripePromise = useMemo(() => loadStripe(props.publishableKey), [props.publishableKey]);
  // Kart alanları ve Stripe hata metinleri tarayıcı dilini değil arayüz dilini izler (F771).
  const locale = useLocale() === "en" ? "en" : "tr";
  return (
    <Elements
      stripe={stripePromise}
      options={{
        locale,
        mode: "payment",
        amount: props.amountMinor,
        currency: props.currency.toLowerCase(),
        captureMethod: "manual",
        paymentMethodCreation: "manual",
      }}
    >
      <InnerForm {...props} />
    </Elements>
  );
}

function InnerForm({
  publishableKey,
  amountMinor,
  currency,
  busy,
  submit,
  confirm,
  onError,
}: Props) {
  const t = useTranslations("payment");
  const f = useFormat();
  // Test notu yalnız test anahtarında; canlı anahtarda gerçek tahsilat tutarı söylenir.
  const testMode = publishableKey.startsWith("pk_test_");
  const stripe = useStripe();
  const elements = useElements();
  const [working, setWorking] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements || busy || working) return;
    setWorking(true);
    try {
      const { error: submitError } = await elements.submit();
      if (submitError) {
        // Alan doğrulama hatasını PaymentElement kendi altında gösterir; ikinci kez
        // duyurmak yerine odağı forma taşı (F1238).
        if (submitError.type === "validation_error") {
          elements.getElement("payment")?.focus();
          return;
        }
        return onError(submitError.message ?? t("invalidCard"));
      }
      const { paymentMethod, error } = await stripe.createPaymentMethod({ elements });
      if (error || !paymentMethod) return onError(error?.message ?? t("invalidCard"));
      const out = await submit(paymentMethod.id);
      if (out.status !== "requires_action") return;
      const clientSecret = out.challenge?.clientSecret;
      if (!clientSecret) return onError(t("verificationStartFailed"));
      const next = await stripe.handleNextAction({ clientSecret });
      if (next.error) return onError(next.error.message ?? t("verificationFailed"));
      await confirm();
    } finally {
      setWorking(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3" aria-label={t("title")}>
      <PaymentElement />
      <p className="text-xs text-gray-500">
        {testMode
          ? t("stripeTestMode")
          : t("stripeLiveCharge", { amount: f.money(amountMinor, currency) })}
      </p>
      <button
        type="submit"
        aria-busy={busy || working || undefined}
        disabled={busy || working || !stripe}
        className="w-full rounded-lg bg-[#003580] px-4 py-3 text-sm font-semibold text-white disabled:bg-gray-300 disabled:text-gray-700"
      >
        {busy || working ? t("processing") : t("payAndConfirm")}
      </button>
    </form>
  );
}
