"use client";

import { useState, useSyncExternalStore, type FormEvent } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-client";
import { CardValidationError, TEST_CARDS, tokenizeCard } from "@/lib/payment/card-token";
import { formatMinor } from "@/lib/ui/format";
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
        error: err instanceof CardValidationError ? err.message : "Kart doğrulanamadı",
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
        message: `Devir tamamlandı. Ödenen: ${formatMinor(res.paidMinor, res.currency)}.`,
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
        Geçerli bir devir bağlantısı bulunamadı. Satıcının paylaştığı bağlantının tamamını açın.
      </p>
    );
  }

  return (
    <Card title="Ödeme bilgileri" id="claim">
      {bookingId ? (
        <p className="text-sm text-gray-900">
          Rezervasyon artık sizin:{" "}
          <Link
            href={`/booking/${bookingId}`}
            className={`font-semibold text-[#003580] underline ${focusRing}`}
          >
            rezervasyonu görüntüle
          </Link>
        </p>
      ) : (
        <form onSubmit={submit} className="grid gap-3 md:grid-cols-4">
          <div className="md:col-span-4">
            <Field
              label="Kart numarası"
              id="card-number"
              hint={`Demo kartları: onay ${TEST_CARDS.success}, ret ${TEST_CARDS.decline}. Kart bilgisi sunucuya gönderilmez; yalnızca token gider.`}
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
          <Field label="Ay" id="card-month">
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
          <Field label="Yıl" id="card-year">
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
          <Field label="CVC" id="card-cvc">
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
              {busy ? "İşleniyor…" : "Öde ve devral"}
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
