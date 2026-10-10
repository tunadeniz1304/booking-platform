"use client";

import { useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ApiError, apiFetch } from "@/lib/api-client";
import { CardValidationError, TEST_CARDS, tokenizeCard } from "@/lib/payment/card-token";
import { newIdempotencyKey } from "@/lib/ui/format";
import { useFormat } from "@/i18n/use-format";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import {
  Button,
  Card,
  Field,
  Status,
  focusRing,
  inputClass,
  useErrorText,
} from "@/components/ui/ui";

/** Giriş/kayıt sırasında devir token'ı kaybolmasın diye sekme oturumunda saklanır. */
const CLAIM_TOKEN_KEY = "transfer-claim-token";

function subscribe(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

function hashToken(): string {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return params.get("token") ?? "";
}

/** Oturumsuz alıcı giriş yapmaya giderken token'ı sakla (query string'e konmaz). */
export function stashClaimToken(): void {
  const token = hashToken();
  if (!token) return;
  try {
    window.sessionStorage.setItem(CLAIM_TOKEN_KEY, token);
  } catch {
    /* depolama kapalıysa bağlantı yeniden açılmalı */
  }
}

function clearStashedToken(): void {
  try {
    window.sessionStorage.removeItem(CLAIM_TOKEN_KEY);
  } catch {
    /* yok say */
  }
}

/** Token URL parçasında (#token=…) taşınır: sunucu loglarına/Referer'a gitmez. */
function readToken(): string {
  const fromHash = hashToken();
  if (fromHash) return fromHash;
  try {
    return window.sessionStorage.getItem(CLAIM_TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

type ResendState = "idle" | "sending" | "sent" | "verified" | "failed";

/** E-posta doğrulanmamışsa devir yapılamaz: açıklama + doğrulama e-postasını yeniden gönder. */
export function VerifyEmailNotice() {
  const t = useTranslations("transfers.verify");
  const [state, setState] = useState<ResendState>("idle");

  async function resend() {
    if (state === "sending") return;
    setState("sending");
    try {
      const res = await apiFetch<{ sent?: boolean; alreadyVerified?: boolean }>(
        "/api/auth/verify-email/resend",
        { method: "POST", body: "{}" }
      );
      setState(res.alreadyVerified ? "verified" : "sent");
    } catch {
      setState("failed");
    }
  }

  const statusText =
    state === "sent"
      ? t("sent")
      : state === "verified"
        ? t("alreadyVerified")
        : state === "failed"
          ? t("failed")
          : "";

  return (
    <div className="mt-3 rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-gray-900">
      <p className="font-semibold">{t("title")}</p>
      <p className="mt-1">{t("body")}</p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          onClick={resend}
          disabled={state === "sending"}
          aria-busy={state === "sending"}
        >
          {state === "sending" ? t("sending") : t("resend")}
        </Button>
        <span aria-live="polite">{statusText}</span>
      </div>
    </div>
  );
}

export function isEmailNotVerified(err: unknown): boolean {
  return err instanceof ApiError && err.code === "EMAIL_NOT_VERIFIED";
}

export default function ClaimForm() {
  const t = useTranslations("transfers.claim");
  const errorText = useErrorText();
  const f = useFormat();
  const { confirm, confirmDialog } = useConfirm();
  const token = useSyncExternalStore(subscribe, readToken, () => "");
  const [card, setCard] = useState({
    number: "",
    expMonth: "12",
    expYear: String(new Date().getUTCFullYear() + 2),
    cvc: "",
  });
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ error?: string; message?: string }>({});
  const [needsVerify, setNeedsVerify] = useState(false);
  const [maybeCharged, setMaybeCharged] = useState(false);
  const [bookingId, setBookingId] = useState<string | null>(null);
  // Aynı kartla yeniden deneme aynı anahtarı taşır: yanıt kaybolsa da çift tahsilat olmaz.
  const idempotencyKey = useRef<string>("");
  const attempted = useRef(false);

  function updateCard(next: Partial<typeof card>) {
    if (next.number !== undefined && next.number !== card.number) idempotencyKey.current = "";
    setCard({ ...card, ...next });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setFeedback({});
    setNeedsVerify(false);
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
      document.getElementById("card-number")?.focus();
      return;
    }
    if (
      !(await confirm({
        title: t("confirmTitle"),
        body: t("confirmBody"),
        confirmLabel: t("confirmAction"),
        tone: "primary",
      }))
    ) {
      return;
    }
    if (!idempotencyKey.current) idempotencyKey.current = newIdempotencyKey();
    setBusy(true);
    try {
      const res = await apiFetch<{ bookingId: string; paidMinor: number; currency: string }>(
        "/api/transfers/claim",
        {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey.current },
          body: JSON.stringify({ token, cardToken }),
        }
      );
      clearStashedToken();
      setMaybeCharged(false);
      setBookingId(res.bookingId);
      setFeedback({
        message: t("done", { amount: f.money(res.paidMinor, res.currency) }),
      });
      // Başarılı devirden sonra token'ı adres çubuğundan kaldır.
      window.history.replaceState(null, "", window.location.pathname);
    } catch (err) {
      if (isEmailNotVerified(err)) {
        setNeedsVerify(true);
      } else if (err instanceof ApiError && err.status === 409 && attempted.current) {
        // Önceki deneme sunucuya ulaşmış olabilir: ödeme alınmış ve devir tamamlanmış olabilir.
        setMaybeCharged(true);
      }
      setFeedback({ error: errorText(err) });
    } finally {
      attempted.current = true;
      setBusy(false);
    }
  }

  if (!token && !bookingId) {
    return <p className="text-sm text-red-700">{t("invalidLink")}</p>;
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
        <form onSubmit={submit} aria-busy={busy} className="grid gap-3 md:grid-cols-4">
          <p className="text-sm text-gray-800 md:col-span-4">{t("reviewNote")}</p>
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
                onChange={(e) => updateCard({ number: e.target.value })}
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
              onChange={(e) => updateCard({ expMonth: e.target.value })}
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
              onChange={(e) => updateCard({ expYear: e.target.value })}
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
              onChange={(e) => updateCard({ cvc: e.target.value })}
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
      {needsVerify && <VerifyEmailNotice />}
      {maybeCharged && (
        <p className="mt-3 text-sm text-gray-900">
          {t.rich("maybeCharged", {
            link: (chunks) => (
              <Link href="/trips" className={`font-semibold text-[#003580] underline ${focusRing}`}>
                {chunks}
              </Link>
            ),
          })}
        </p>
      )}
      {confirmDialog}
    </Card>
  );
}
