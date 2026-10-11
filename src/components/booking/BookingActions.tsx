"use client";

import { useEffect, useId, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ApiError, apiFetch, isNetworkError } from "@/lib/api-client";
import {
  CardValidationError,
  MOCK_3DS_CODE,
  TEST_CARDS,
  tokenizeCard,
} from "@/lib/payment/card-token";
import { useFormat } from "@/i18n/use-format";
import { Field, focusRing } from "@/components/ui/ui";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import type { PayResponse } from "./StripePaymentForm";
import StepUpDialog from "./StepUpDialog";
import WalletCreditOption from "./WalletCreditOption";
import RnplOption from "./RnplOption";

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

type CardField = "number" | "exp" | "cvc";
type FieldErrors = Partial<Record<CardField, string>>;

/** 3DS adımında bu kodlar geldiğinde bekleyen doğrulama kapanmıştır: kart formuna dönülür. */
const CHALLENGE_CLOSED = new Set([
  "PAYMENT_DECLINED",
  "NO_PENDING_CHALLENGE",
  "PAYMENT_ATTEMPTS_EXCEEDED",
]);

/** Kart doğrulama kodu → ilgili alan. */
const CARD_ERROR_FIELD: Record<string, CardField> = {
  CARD_NUMBER_INVALID: "number",
  CVC_INVALID: "cvc",
  CARD_EXPIRED: "exp",
};

/** "1230", "12/30", "12-30", "12 / 2030" → { mm, yyyy }; geçersizse null. */
function parseExpiry(value: string): { mm: number; yyyy: number } | null {
  const m = /^\s*(\d{1,2})\s*[/\-. ]?\s*(\d{2}|\d{4})\s*$/.exec(value);
  if (!m) return null;
  const mm = Number(m[1]);
  const yy = Number(m[2]);
  if (mm < 1 || mm > 12) return null;
  return { mm, yyyy: m[2].length === 4 ? yy : 2000 + yy };
}

/** Yazarken AA/YY biçimine getirir (otomatik "/"). */
function formatExpiry(value: string): string {
  const d = value.replace(/\D/g, "").slice(0, 4);
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
}

function newIdemKey() {
  return typeof crypto !== "undefined" ? crypto.randomUUID() : String(Date.now());
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
  const tc = useTranslations("common");
  const f = useFormat();
  const { confirm, confirmDialog } = useConfirm();
  const ids = useId();
  const [payConfig, setPayConfig] = useState<PaymentConfig>({
    provider: "mock",
    publishableKey: null,
  });
  const [card, setCard] = useState({ number: "", exp: "", cvc: "" });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [message, setMessage] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  /** Ekran okuyucu duyurusu (her zaman DOM'da duran tek `role=status` bölgesi). */
  const [announcement, setAnnouncement] = useState("");
  /** Step-up bekleyen ödeme (mock formda doğrulamadan sonra otomatik yeniden denenir). */
  const [stepUp, setStepUp] = useState<{ cardToken: string } | null>(null);
  /** Stripe akışı: doğrulama token'ı sonraki gönderimde kullanılır (tek kullanımlık, v4#2). */
  const [stepUpToken, setStepUpToken] = useState<string | null>(null);
  /** P1-7: cüzdan kredisinden kullanılacak tutar (minor-unit; 0 = yalnız kart). */
  const [creditMinor, setCreditMinor] = useState(0);
  /** P1-3: "şimdi rezerve et, sonra öde" seçili mi (kredi ile birlikte kullanılamaz). */
  const [rnpl, setRnpl] = useState(false);
  /** Her yeni ödeme denemesi (kesin ret sonrası) yeni bir anahtar alır; ağ hatasında aynısı kalır. */
  const [idemKey, setIdemKey] = useState(newIdemKey);
  /** Tutma süresi geri sayımı için istemci saati (SSR uyumsuzluğu olmasın diye başta null). */
  const [now, setNow] = useState<number | null>(null);
  const [serverExpired, setServerExpired] = useState(false);
  const warned = useRef({ five: false, one: false });

  const numberRef = useRef<HTMLInputElement>(null);
  const expRef = useRef<HTMLInputElement>(null);
  const cvcRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  /** Bir sonraki çizimden sonra odaklanacak öğe (form geçişlerinde odak kaybolmasın). */
  const focusNext = useRef<"number" | "code" | null>(null);

  useEffect(() => {
    if (status !== "HELD") return;
    apiFetch<PaymentConfig>("/api/payments/config")
      .then(setPayConfig)
      .catch(() => undefined); // Yapılandırma okunamazsa mock form kalır.
  }, [status]);

  useEffect(() => {
    if (status !== "HELD" || !holdExpiresAt) return;
    const end = Date.parse(holdExpiresAt);
    // Her saniye saati günceller; 5. ve 1. dakikada bir kez duyuru yapar.
    const tick = () => {
      const n = Date.now();
      setNow(n);
      const left = end - n;
      if (left <= 0) return;
      if (left <= 60_000 && !warned.current.one) {
        warned.current = { five: true, one: true };
        setAnnouncement(t("hold.warnMinutes", { minutes: 1 }));
      } else if (left <= 5 * 60_000 && !warned.current.five) {
        warned.current.five = true;
        setAnnouncement(t("hold.warnMinutes", { minutes: 5 }));
      }
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [status, holdExpiresAt, t]);

  const remainingMs =
    status === "HELD" && holdExpiresAt && now !== null ? Date.parse(holdExpiresAt) - now : null;
  const expired =
    status === "HELD" && (serverExpired || (remainingMs !== null && remainingMs <= 0));

  useEffect(() => {
    if (focusNext.current === "code") codeRef.current?.focus();
    else if (focusNext.current === "number") numberRef.current?.focus();
    focusNext.current = null;
  });

  const useStripeForm =
    payConfig.provider === "stripe" && !!payConfig.publishableKey && !!amountMinor && !!currency;

  /** Sunucu hata kodunu yerelleştirir; bilinmeyen kodda ham (tek dilli) metin yerine `fallback`. */
  function errorText(err: unknown, fallback: string): string {
    if (isNetworkError(err)) return tc("errors.network");
    if (err instanceof ApiError && err.code) {
      const decline =
        err.details && typeof err.details === "object" && "declineCode" in err.details
          ? String((err.details as { declineCode: unknown }).declineCode)
          : null;
      if (err.code === "PAYMENT_DECLINED" && decline === "authentication_failed")
        return t("errors.AUTHENTICATION_FAILED");
      if (t.has(`errors.${err.code}`)) return t(`errors.${err.code}`);
      if (tc.has(`errors.${err.code}`)) return tc(`errors.${err.code}`);
    }
    return fallback;
  }

  function showError(err: unknown, fallback: string) {
    if (err instanceof ApiError && err.code === "HOLD_EXPIRED") setServerExpired(true);
    // Kesin ret: sonraki deneme yeni bir işlemdir (aynı anahtar eski sonucu döndürmesin).
    if (err instanceof ApiError && err.status < 500 && !isNetworkError(err))
      setIdemKey(newIdemKey());
    setMessage({ kind: "error", text: errorText(err, fallback) });
  }

  function startBusy() {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    return true;
  }

  function endBusy() {
    busyRef.current = false;
    setBusy(false);
  }

  function openChallenge(hint: string | undefined) {
    setCode("");
    setChallenge(
      payConfig.provider === "mock"
        ? t("threeDsDemoHint", { code: MOCK_3DS_CODE })
        : (hint ?? t("verificationRequired"))
    );
    setAnnouncement(t("threeDsAnnounce"));
    focusNext.current = "code";
  }

  function paid() {
    setAnnouncement(t("paidAnnounce"));
    onChanged();
  }

  function backToCard() {
    setChallenge(null);
    setCode("");
    setIdemKey(newIdemKey());
    focusNext.current = "number";
  }

  // BIN ve cihaz kimliği gönderilmez (v4#13): sunucu token metadata'sı ve imzalı çerezden okur.
  function submitToken(cardToken: string, verifiedToken: string | null = stepUpToken) {
    if (verifiedToken) setStepUpToken(null);
    return apiFetch<PayResponse>(`/api/bookings/${bookingId}/pay`, {
      method: "POST",
      headers: { "Idempotency-Key": idemKey },
      body: JSON.stringify({
        cardToken,
        ...(verifiedToken ? { stepUpToken: verifiedToken } : {}),
        ...(rnpl ? { paymentOption: "rnpl" } : creditMinor > 0 ? { creditMinor } : {}),
      }),
    });
  }

  const isStepUp = (err: unknown) => err instanceof ApiError && err.code === "STEP_UP_REQUIRED";

  async function afterStepUp(token: string) {
    const pending = stepUp;
    setStepUp(null);
    if (!pending?.cardToken) {
      setStepUpToken(token);
      setMessage({ kind: "info", text: t("verifiedRetry") });
      return;
    }
    if (!startBusy()) return;
    try {
      const out = await submitToken(pending.cardToken, token);
      if (out.status === "requires_action") openChallenge(out.challenge?.hint);
      else paid();
    } catch (err) {
      showError(err, t("failed"));
    } finally {
      endBusy();
    }
  }

  async function stripeSubmit(cardToken: string): Promise<PayResponse> {
    setMessage(null);
    setBusy(true);
    try {
      const out = await submitToken(cardToken);
      if (out.status !== "requires_action") paid();
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
      paid();
    } catch (err) {
      showError(err, t("verificationFailed"));
    }
  }

  function updateCard(field: CardField, value: string) {
    setCard((c) => ({ ...c, [field]: value }));
    if (fieldErrors[field]) setFieldErrors((e) => ({ ...e, [field]: undefined }));
  }

  function failField(field: CardField, text: string) {
    setFieldErrors({ [field]: text });
    ({ number: numberRef, exp: expRef, cvc: cvcRef })[field].current?.focus();
  }

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    if (busyRef.current) return;
    setMessage(null);
    setFieldErrors({});
    const exp = parseExpiry(card.exp);
    if (!exp) {
      failField("exp", t("errors.EXPIRY_FORMAT"));
      return;
    }
    let cardToken: string;
    try {
      cardToken = tokenizeCard({
        number: card.number,
        expMonth: exp.mm,
        expYear: exp.yyyy,
        cvc: card.cvc,
      });
    } catch (err) {
      const errCode = err instanceof CardValidationError ? err.code : undefined;
      const field = errCode ? CARD_ERROR_FIELD[errCode] : undefined;
      if (errCode && field) failField(field, t(`errors.${errCode}`));
      else setMessage({ kind: "error", text: t("invalidCard") });
      return;
    }
    if (!startBusy()) return;
    try {
      const out = await submitToken(cardToken);
      if (out.status === "requires_action") openChallenge(out.challenge?.hint);
      else paid();
    } catch (err) {
      if (isStepUp(err)) {
        setStepUp({ cardToken });
        return;
      }
      showError(err, t("failed"));
    } finally {
      endBusy();
    }
  }

  async function confirm3ds(e: React.FormEvent) {
    e.preventDefault();
    if (!startBusy()) return;
    setMessage(null);
    try {
      await apiFetch(`/api/bookings/${bookingId}/pay/confirm`, {
        method: "POST",
        body: JSON.stringify({ code }),
      });
      setChallenge(null);
      paid();
    } catch (err) {
      showError(err, t("verificationFailed"));
      // Doğrulama kapandıysa (ret / bekleyen yok / deneme sınırı) kod ekranında bırakma.
      if (err instanceof ApiError && err.code && CHALLENGE_CLOSED.has(err.code)) backToCard();
    } finally {
      endBusy();
    }
  }

  async function cancel() {
    const ok = await confirm({
      title: t("cancel.dialogTitle"),
      body: (
        <>
          <span className="block">
            {status === "HELD" ? t("cancel.dialogBodyHeld") : t("cancel.dialogBodyConfirmed")}
          </span>
          <span className="mt-2 block">{t("cancel.irreversible")}</span>
        </>
      ),
      confirmLabel: t("cancel.confirmButton"),
      cancelLabel: t("cancel.keep"),
      tone: "danger",
    });
    if (!ok) return;
    if (!startBusy()) return;
    setMessage(null);
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
      showError(err, t("cancel.failed"));
    } finally {
      endBusy();
    }
  }

  const input = `mt-1 w-full rounded-lg border border-gray-500 px-3 py-2 text-sm ${focusRing}`;
  const submitClass = `w-full rounded-lg bg-[#003580] px-4 py-3 text-sm font-semibold text-white disabled:bg-gray-300 disabled:text-gray-700 aria-disabled:bg-gray-300 aria-disabled:text-gray-700 ${focusRing}`;
  const held = status === "HELD" && !expired;
  const remainingText =
    remainingMs !== null && remainingMs > 0
      ? `${Math.floor(remainingMs / 60_000)}:${String(Math.floor((remainingMs % 60_000) / 1000)).padStart(2, "0")}`
      : null;

  return (
    <div className="space-y-4 border-t border-gray-100 pt-6">
      {held && holdExpiresAt && (
        <div className="text-sm text-amber-700">
          <p>{t("holdUntil", { time: f.time(holdExpiresAt) })}</p>
          {remainingText && (
            <p className="font-semibold">{t("hold.remaining", { time: remainingText })}</p>
          )}
        </div>
      )}

      {expired && (
        <div className="space-y-2 text-sm text-amber-700">
          <h2 className="text-lg font-semibold text-gray-900">{t("hold.expiredTitle")}</h2>
          <p>{t("hold.expiredBody")}</p>
          <Link
            href="/search"
            className={`inline-flex min-h-[44px] items-center font-semibold text-[#003580] underline ${focusRing}`}
          >
            {t("hold.rebook")}
          </Link>
        </div>
      )}

      {held && !challenge && !useStripeForm && (
        <RnplOption bookingId={bookingId} disabled={busy} selected={rnpl} onChange={setRnpl} />
      )}
      {/* Gizlenir ama kaldırılmaz: geri dönüldüğünde kutu ile gönderilen kredi tutarı aynı kalır. */}
      {status === "HELD" && (
        <div hidden={!held || !!challenge || rnpl}>
          <WalletCreditOption
            bookingId={bookingId}
            totalMinor={amountMinor}
            currency={currency}
            disabled={busy}
            onChange={setCreditMinor}
          />
        </div>
      )}
      {held && useStripeForm && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-gray-900">{t("title")}</h2>
          <StripePaymentForm
            publishableKey={payConfig.publishableKey!}
            amountMinor={amountMinor! - creditMinor}
            currency={currency!}
            busy={busy}
            submit={stripeSubmit}
            confirm={stripeConfirm}
            onError={(text) => setMessage({ kind: "error", text })}
          />
        </div>
      )}

      {held && !useStripeForm && !challenge && (
        <form onSubmit={pay} noValidate className="space-y-3" aria-label={t("title")}>
          <h2 className="text-lg font-semibold text-gray-900">{t("title")}</h2>
          <Field label={t("cardNumber")} id={`${ids}-number`} error={fieldErrors.number}>
            <input
              id={`${ids}-number`}
              ref={numberRef}
              className={input}
              inputMode="numeric"
              autoComplete="cc-number"
              maxLength={23}
              value={card.number}
              onChange={(e) => updateCard("number", e.target.value)}
              required
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field
              label={t("expiry")}
              id={`${ids}-exp`}
              hint={t("expiryHint")}
              error={fieldErrors.exp}
            >
              <input
                id={`${ids}-exp`}
                ref={expRef}
                className={input}
                inputMode="numeric"
                autoComplete="cc-exp"
                maxLength={5}
                value={card.exp}
                onChange={(e) => updateCard("exp", formatExpiry(e.target.value))}
                required
              />
            </Field>
            <Field label={t("cvc")} id={`${ids}-cvc`} error={fieldErrors.cvc}>
              <input
                id={`${ids}-cvc`}
                ref={cvcRef}
                className={input}
                inputMode="numeric"
                autoComplete="cc-csc"
                maxLength={4}
                value={card.cvc}
                onChange={(e) => updateCard("cvc", e.target.value)}
                required
              />
            </Field>
          </div>
          <p className="text-xs text-gray-500">
            {t("testCards", {
              success: TEST_CARDS.success,
              decline: TEST_CARDS.decline,
              threeDs: TEST_CARDS.threeDs,
            })}
          </p>
          <button aria-disabled={busy || undefined} aria-busy={busy} className={submitClass}>
            {busy ? t("processing") : rnpl ? t("rnpl.reserve") : t("payAndConfirm")}
          </button>
        </form>
      )}

      {held && challenge && (
        <form onSubmit={confirm3ds} className="space-y-3" aria-label={t("threeDsTitle")}>
          <h2 className="text-lg font-semibold text-gray-900">{t("threeDsTitle")}</h2>
          <p className="text-sm text-gray-600">{t("threeDsIntro")}</p>
          <Field label={t("verificationCode")} id={`${ids}-code`} hint={challenge}>
            <input
              id={`${ids}-code`}
              ref={codeRef}
              className={input}
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
          </Field>
          <button aria-disabled={busy || undefined} aria-busy={busy} className={submitClass}>
            {busy ? t("processing") : t("verify")}
          </button>
          <button
            type="button"
            onClick={backToCard}
            disabled={busy}
            className={`min-h-[44px] w-full rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 ${focusRing}`}
          >
            {t("threeDsBack")}
          </button>
        </form>
      )}

      {message?.kind === "error" && (
        <p role="alert" className="text-sm text-red-700">
          {message.text}
        </p>
      )}

      {(status === "HELD" || status === "CONFIRMED") && (
        <button
          type="button"
          onClick={() => void cancel()}
          disabled={busy}
          className={`rounded-lg border border-red-300 px-6 py-3 text-sm font-semibold text-red-700 hover:bg-red-50 ${focusRing}`}
        >
          {t("cancel.button")}
        </button>
      )}

      {stepUp && (
        <StepUpDialog
          bookingId={bookingId}
          onVerified={(token) => void afterStepUp(token)}
          onCancel={() => setStepUp(null)}
        />
      )}

      <p
        role="status"
        aria-live="polite"
        className={message?.kind === "info" ? "text-sm text-green-700" : "sr-only"}
      >
        {message?.kind === "info" ? message.text : expired ? t("hold.expired") : announcement}
      </p>

      {confirmDialog}
    </div>
  );
}
