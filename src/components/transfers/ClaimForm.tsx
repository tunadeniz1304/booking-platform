"use client";

import { useState, useSyncExternalStore, type FormEvent } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api-client";
import { CardValidationError, TEST_CARDS, tokenizeCard } from "@/lib/payment/card-token";
import { useFormat } from "@/i18n/use-format";
import {
  Button,
  Card,
  Field,
  Status,
  errorMessage,
  focusRing,
  inputClass,
} from "@/components/ui/ui";

function subscribe(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

/** Token URL parçasında (#token=…) taşınır: sunucu loglarına/Referer'a gitmez. */
function readToken(): string {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return params.get("token") ?? "";
}

export default function ClaimForm() {
  const t = useTranslations("transfers.claim");
  const f = useFormat();
  const token = useSyncExternalStore(subscribe, readToken, () => "");
  const [card, setCard] = useState({
    number: "",
    expMonth: "12",
    expYear: String(new Date().getUTCFullYear() + 2),
    cvc: "",
  });
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ error?: string; message?: string }>({});
  const [bookingId, setBookingId] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFeedback({});
    let cardToken: string;
    try {
      cardToken = tokenizeCard({
        number: card.number,
        expMonth: Number(card.expMonth),
        expYear: Number(card.expYear),
        cvc: card.cvc,
      });
    } catch (err) {
      setFeedback({
        error: err instanceof CardValidationError ? err.message : t("invalidCard"),
      });
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch<{ bookingId: string; paidMinor: number; currency: string }>(
        "/api/transfers/claim",
        { method: "POST", body: JSON.stringify({ token, cardToken }) }
      );
      setBookingId(res.bookingId);
      setFeedback({
        message: t("done", { amount: f.money(res.paidMinor, res.currency) }),
      });
      // Başarılı devirden sonra token'ı adres çubuğundan kaldır.
      window.history.replaceState(null, "", window.location.pathname);
    } catch (err) {
      setFeedback({ error: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  if (!token && !bookingId) {
    return (
      <p role="alert" className="text-sm text-red-700">
        {t("invalidLink")}
      </p>
    );
  }

  return (
    <Card title={t("paymentTitle")} id="claim">
      {bookingId ? (
        <p className="text-sm text-gray-900">
          {t.rich("owned", {
            link: (chunks) => (
              <Link
                href={`/booking/${bookingId}`}
                className={`font-semibold text-[#003580] underline ${focusRing}`}
              >
                {chunks}
              </Link>
            ),
          })}
        </p>
      ) : (
        <form onSubmit={submit} className="grid gap-3 md:grid-cols-4">
          <div className="md:col-span-4">
            <Field
              label={t("cardNumber")}
              id="card-number"
              hint={t("cardHint", { success: TEST_CARDS.success, decline: TEST_CARDS.decline })}
            >
              <input
                id="card-number"
                inputMode="numeric"
                autoComplete="cc-number"
                className={inputClass}
                value={card.number}
                required
                onChange={(e) => setCard({ ...card, number: e.target.value })}
              />
            </Field>
          </div>
          <Field label={t("month")} id="card-month">
            <input
              id="card-month"
              type="number"
              min={1}
              max={12}
              autoComplete="cc-exp-month"
              className={inputClass}
              value={card.expMonth}
              required
              onChange={(e) => setCard({ ...card, expMonth: e.target.value })}
            />
          </Field>
          <Field label={t("year")} id="card-year">
            <input
              id="card-year"
              type="number"
              min={2000}
              max={2100}
              autoComplete="cc-exp-year"
              className={inputClass}
              value={card.expYear}
              required
              onChange={(e) => setCard({ ...card, expYear: e.target.value })}
            />
          </Field>
          <Field label={t("cvc")} id="card-cvc">
            <input
              id="card-cvc"
              inputMode="numeric"
              autoComplete="cc-csc"
              className={inputClass}
              value={card.cvc}
              required
              maxLength={4}
              onChange={(e) => setCard({ ...card, cvc: e.target.value })}
            />
          </Field>
          <div className="flex items-end">
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? t("processing") : t("submit")}
            </Button>
          </div>
        </form>
      )}
      <div className="mt-3">
        <Status error={feedback.error} message={feedback.message} />
      </div>
    </Card>
  );
}
