"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { ApiError, apiFetch } from "@/lib/api-client";
import { CardValidationError, TEST_CARDS, tokenizeCard } from "@/lib/payment/card-token";
import { useFormat } from "@/i18n/use-format";
import type { PayResponse } from "./StripePaymentForm";
import StepUpDialog from "./StepUpDialog";

// Stripe.js yalnızca `PAYMENT_PROVIDER=stripe` iken ve istemcide yüklenir.
const StripePaymentForm = dynamic(() => import("./StripePaymentForm"), { ssr: false });

interface PaymentConfig {
  provider: "stripe" | "mock";
  publishableKey: string | null;
}

interface Props {
  bookingId: string;
  status: string;
  holdExpiresAt?: string | null;
  /** Tahsil edilecek tutar (Stripe Payment Element'in `amount` seçeneği için). */
  amountMinor?: number;
  currency?: string;
  onChanged: () => void;
}

/**
 * Ödeme (HELD) ve iptal (HELD/CONFIRMED) eylemleri.
 * Kart numarası tarayıcıda token'a çevrilir; sunucuya yalnızca `cardToken` gider.
 * `PAYMENT_PROVIDER=stripe` iken Stripe Payment Element, aksi hâlde mock hosted fields (#10).
 */
export default function BookingActions({
  bookingId,
  status,
  holdExpiresAt,
  amountMinor,
  currency,
  onChanged,
}: Props) {
  const t = useTranslations("payment");
  const f = useFormat();
  const [payConfig, setPayConfig] = useState<PaymentConfig>({
    provider: "mock",
    publishableKey: null,
  });
  const [card, setCard] = useState({ number: "", exp: "12/30", cvc: "" });
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  /** Step-up bekleyen ödeme (mock formda doğrulamadan sonra otomatik yeniden denenir). */
  const [stepUp, setStepUp] = useState<{ cardToken: string } | null>(null);
  const [idemKey] = useState(() =>
    typeof crypto !== "undefined" ? crypto.randomUUID() : String(Date.now())
  );

  useEffect(() => {
    if (status !== "HELD") return;
    apiFetch<PaymentConfig>("/api/payments/config")
      .then(setPayConfig)
      .catch(() => undefined); // Yapılandırma okunamazsa mock form kalır.
  }, [status]);

  const useStripeForm =
    payConfig.provider === "stripe" && !!payConfig.publishableKey && !!amountMinor && !!currency;

  function showError(err: unknown, fallback: string) {
    setMessage({ kind: "error", text: err instanceof ApiError ? err.message : fallback });
  }

  // BIN ve cihaz kimliği gönderilmez (v4#13): sunucu token metadata'sı ve imzalı çerezden okur.
  function submitToken(cardToken: string) {
    return apiFetch<PayResponse>(`/api/bookings/${bookingId}/pay`, {
      method: "POST",
      headers: { "Idempotency-Key": idemKey },
      body: JSON.stringify({ cardToken }),
    });
  }

  const isStepUp = (err: unknown) => err instanceof ApiError && err.code === "STEP_UP_REQUIRED";

  async function afterStepUp() {
    const pending = stepUp;
    setStepUp(null);
    if (!pending?.cardToken) {
      setMessage({ kind: "info", text: t("verifiedRetry") });
      return;
    }
    setBusy(true);
    try {
      const out = await submitToken(pending.cardToken);
      if (out.status === "requires_action")
        setChallenge(out.challenge?.hint ?? t("verificationRequired"));
      else onChanged();
    } catch (err) {
      showError(err, t("failed"));
    } finally {
      setBusy(false);
    }
  }

  async function stripeSubmit(cardToken: string): Promise<PayResponse> {
    setMessage(null);
    setBusy(true);
    try {
      const out = await submitToken(cardToken);
      if (out.status !== "requires_action") onChanged();
      return out;
    } catch (err) {
      // Stripe akışında token tekrar kullanılamaz: doğrulamadan sonra kullanıcı yeniden gönderir.
      if (isStepUp(err)) setStepUp({ cardToken: "" });
      else showError(err, t("failed"));
      return { status: "failed" };
    } finally {
      setBusy(false);
    }
  }

  async function stripeConfirm() {
    try {
      await apiFetch(`/api/bookings/${bookingId}/pay/confirm`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      onChanged();
    } catch (err) {
      showError(err, t("verificationFailed"));
    }
  }

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    let cardToken: string;
    try {
      const [mm, yy] = card.exp.split("/").map((v) => Number(v.trim()));
      cardToken = tokenizeCard({
        number: card.number,
        expMonth: mm,
        expYear: 2000 + yy,
        cvc: card.cvc,
      });
    } catch (err) {
      setMessage({
        kind: "error",
        text: err instanceof CardValidationError ? err.message : t("invalidCard"),
      });
      return;
    }
    setBusy(true);
    try {
      const out = await submitToken(cardToken);
      if (out.status === "requires_action")
        setChallenge(out.challenge?.hint ?? t("verificationRequired"));
      else onChanged();
    } catch (err) {
      if (isStepUp(err)) {
        setStepUp({ cardToken });
        return;
      }
      setMessage({
        kind: "error",
        text: err instanceof ApiError ? err.message : t("failed"),
      });
    } finally {
      setBusy(false);
    }
  }

  async function confirm3ds(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await apiFetch(`/api/bookings/${bookingId}/pay/confirm`, {
        method: "POST",
        body: JSON.stringify({ code }),
      });
      setChallenge(null);
      onChanged();
    } catch (err) {
      setMessage({
        kind: "error",
        text: err instanceof ApiError ? err.message : t("verificationFailed"),
      });
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!window.confirm(t("cancel.confirm"))) return;
    setBusy(true);
    try {
      const res = await apiFetch<{
        refund: { refundMinor: number; currency: string; refundPercent: number };
      }>(`/api/bookings/${bookingId}`, { method: "DELETE" });
      setMessage({
        kind: "info",
        text:
          res.refund.refundMinor > 0
            ? t("cancel.refunded", {
                amount: f.money(res.refund.refundMinor, res.refund.currency),
                percent: String(res.refund.refundPercent),
              })
            : t("cancel.noRefund"),
      });
      onChanged();
    } catch (err) {
      setMessage({
        kind: "error",
        text: err instanceof ApiError ? err.message : t("cancel.failed"),
      });
    } finally {
      setBusy(false);
    }
  }

  const input = "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";
  return (
    <div className="space-y-4 border-t border-gray-100 pt-6">
      {status === "HELD" && useStripeForm && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-gray-900">{t("title")}</h2>
          <StripePaymentForm
            publishableKey={payConfig.publishableKey!}
            amountMinor={amountMinor!}
            currency={currency!}
            busy={busy}
            submit={stripeSubmit}
            confirm={stripeConfirm}
            onError={(text) => setMessage({ kind: "error", text })}
          />
        </div>
      )}

      {status === "HELD" && !useStripeForm && !challenge && (
        <form onSubmit={pay} className="space-y-3" aria-label={t("title")}>
          <h2 className="text-lg font-semibold text-gray-900">{t("title")}</h2>
          {holdExpiresAt && (
            <p className="text-sm text-amber-700">
              {t("holdUntil", { time: f.time(holdExpiresAt) })}
            </p>
          )}
          <label className="block text-sm font-medium text-gray-700">
            {t("cardNumber")}
            <input
              className={input}
              inputMode="numeric"
              autoComplete="cc-number"
              value={card.number}
              onChange={(e) => setCard({ ...card, number: e.target.value })}
              required
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm font-medium text-gray-700">
              {t("expiry")}
              <input
                className={input}
                autoComplete="cc-exp"
                value={card.exp}
                onChange={(e) => setCard({ ...card, exp: e.target.value })}
                required
              />
            </label>
            <label className="block text-sm font-medium text-gray-700">
              {t("cvc")}
              <input
                className={input}
                inputMode="numeric"
                autoComplete="cc-csc"
                value={card.cvc}
                onChange={(e) => setCard({ ...card, cvc: e.target.value })}
                required
              />
            </label>
          </div>
          <p className="text-xs text-gray-500">
            {t("testCards", {
              success: TEST_CARDS.success,
              decline: TEST_CARDS.decline,
              threeDs: TEST_CARDS.threeDs,
            })}
          </p>
          <button
            disabled={busy}
            className="w-full rounded-lg bg-[#003580] px-4 py-3 text-sm font-semibold text-white disabled:bg-gray-300 disabled:text-gray-700"
          >
            {busy ? t("processing") : t("payAndConfirm")}
          </button>
        </form>
      )}

      {challenge && (
        <form onSubmit={confirm3ds} className="space-y-3" aria-label={t("threeDsTitle")}>
          <h2 className="text-lg font-semibold text-gray-900">{t("threeDsTitle")}</h2>
          <p className="text-sm text-gray-600">{challenge}</p>
          <input
            className={input}
            inputMode="numeric"
            aria-label={t("verificationCode")}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
          />
          <button
            disabled={busy}
            className="w-full rounded-lg bg-[#003580] px-4 py-3 text-sm font-semibold text-white disabled:bg-gray-300 disabled:text-gray-700"
          >
            {t("verify")}
          </button>
        </form>
      )}

      {(status === "HELD" || status === "CONFIRMED") && (
        <button
          type="button"
          onClick={cancel}
          disabled={busy}
          className="rounded-lg border border-red-300 px-6 py-3 text-sm font-semibold text-red-700 hover:bg-red-50"
        >
          {t("cancel.button")}
        </button>
      )}

      {stepUp && (
        <StepUpDialog onVerified={() => void afterStepUp()} onCancel={() => setStepUp(null)} />
      )}

      {message && (
        <p
          role={message.kind === "error" ? "alert" : "status"}
          className={message.kind === "error" ? "text-sm text-red-700" : "text-sm text-green-700"}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
