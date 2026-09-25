"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { ApiError, apiFetch } from "@/lib/api-client";
import { CardValidationError, TEST_CARDS, tokenizeCard } from "@/lib/payment/card-token";
import { formatMoney, money } from "@/lib/money/money";
import { deviceFingerprint } from "@/lib/risk/device-fingerprint";
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
  const [stepUp, setStepUp] = useState<{ cardToken: string; cardBin?: string } | null>(null);
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

  function submitToken(cardToken: string, cardBin?: string) {
    return apiFetch<PayResponse>(`/api/bookings/${bookingId}/pay`, {
      method: "POST",
      headers: { "Idempotency-Key": idemKey },
      body: JSON.stringify({
        cardToken,
        ...(cardBin ? { cardBin } : {}),
        ...(deviceFingerprint() ? { deviceId: deviceFingerprint() } : {}),
      }),
    });
  }

  const isStepUp = (err: unknown) => err instanceof ApiError && err.code === "STEP_UP_REQUIRED";

  async function afterStepUp() {
    const pending = stepUp;
    setStepUp(null);
    if (!pending?.cardToken) {
      setMessage({ kind: "info", text: "Doğrulandı. Ödemeyi yeniden gönderebilirsiniz." });
      return;
    }
    setBusy(true);
    try {
      const out = await submitToken(pending.cardToken, pending.cardBin);
      if (out.status === "requires_action")
        setChallenge(out.challenge?.hint ?? "Doğrulama gerekli");
      else onChanged();
    } catch (err) {
      showError(err, "Ödeme başarısız");
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
      else showError(err, "Ödeme başarısız");
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
      showError(err, "Doğrulama başarısız");
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
        text: err instanceof CardValidationError ? err.message : "Kart bilgisi geçersiz",
      });
      return;
    }
    const digits = card.number.replace(/\D/g, "");
    const cardBin = digits.length >= 6 ? digits.slice(0, 6) : undefined;
    setBusy(true);
    try {
      const out = await submitToken(cardToken, cardBin);
      if (out.status === "requires_action")
        setChallenge(out.challenge?.hint ?? "Doğrulama gerekli");
      else onChanged();
    } catch (err) {
      if (isStepUp(err)) {
        setStepUp({ cardToken, cardBin });
        return;
      }
      setMessage({
        kind: "error",
        text: err instanceof ApiError ? err.message : "Ödeme başarısız",
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
        text: err instanceof ApiError ? err.message : "Doğrulama başarısız",
      });
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!window.confirm("Rezervasyonu iptal etmek istediğinize emin misiniz?")) return;
    setBusy(true);
    try {
      const res = await apiFetch<{
        refund: { refundMinor: number; currency: string; refundPercent: number };
      }>(`/api/bookings/${bookingId}`, { method: "DELETE" });
      setMessage({
        kind: "info",
        text:
          res.refund.refundMinor > 0
            ? `İptal edildi. İade: ${formatMoney(money(res.refund.refundMinor, res.refund.currency))} (%${res.refund.refundPercent}).`
            : "İptal edildi. Politika gereği iade yok.",
      });
      onChanged();
    } catch (err) {
      setMessage({
        kind: "error",
        text: err instanceof ApiError ? err.message : "İptal edilemedi",
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
          <h2 className="text-lg font-semibold text-gray-900">Ödeme</h2>
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
        <form onSubmit={pay} className="space-y-3" aria-label="Ödeme">
          <h2 className="text-lg font-semibold text-gray-900">Ödeme</h2>
          {holdExpiresAt && (
            <p className="text-sm text-amber-700">
              Oda sizin için{" "}
              {new Date(holdExpiresAt).toLocaleTimeString("tr-TR", {
                hour: "2-digit",
                minute: "2-digit",
              })}
              &apos;e kadar tutuluyor.
            </p>
          )}
          <label className="block text-sm font-medium text-gray-700">
            Kart numarası
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
              Son kullanma (AA/YY)
              <input
                className={input}
                autoComplete="cc-exp"
                value={card.exp}
                onChange={(e) => setCard({ ...card, exp: e.target.value })}
                required
              />
            </label>
            <label className="block text-sm font-medium text-gray-700">
              CVC
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
            Demo test kartları: {TEST_CARDS.success} (onay), {TEST_CARDS.decline} (ret),{" "}
            {TEST_CARDS.threeDs} (3D Secure). Gerçek ödeme alınmaz.
          </p>
          <button
            disabled={busy}
            className="w-full rounded-lg bg-[#003580] px-4 py-3 text-sm font-semibold text-white disabled:bg-gray-300 disabled:text-gray-700"
          >
            {busy ? "İşleniyor..." : "Öde ve onayla"}
          </button>
        </form>
      )}

      {challenge && (
        <form onSubmit={confirm3ds} className="space-y-3" aria-label="3D Secure doğrulaması">
          <h2 className="text-lg font-semibold text-gray-900">3D Secure doğrulaması</h2>
          <p className="text-sm text-gray-600">{challenge}</p>
          <input
            className={input}
            inputMode="numeric"
            aria-label="Doğrulama kodu"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
          />
          <button
            disabled={busy}
            className="w-full rounded-lg bg-[#003580] px-4 py-3 text-sm font-semibold text-white disabled:bg-gray-300 disabled:text-gray-700"
          >
            Doğrula
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
          Rezervasyonu iptal et
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
