"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ApiError, apiFetch, logout } from "@/lib/api-client";
import { CardValidationError, TEST_CARDS, tokenizeCard } from "@/lib/payment/card-token";
import { useFormat } from "@/i18n/use-format";
import type { ShareOutcome, ShareViewDTO } from "@/lib/cart/split-payment";
import { PageShell, focusRing, loginHref, useErrorText, useSession } from "@/components/ui/ui";

const newKey = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : String(Date.now());

const field = "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";
const linkClass = `inline-flex min-h-[44px] items-center text-primary-600 hover:underline sm:min-h-0 ${focusRing}`;
const actionClass = `min-h-[44px] rounded-md border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-800 ${focusRing}`;

type ResendState = "idle" | "sending" | "sent" | "verified" | "failed";

/**
 * Bölünmüş ödeme katılımcı sayfası (P1-2): imzalı + süreli davet linki. Oturum ve doğrulanmış
 * e-posta gerekir; pay yalnız yetkilendirilir, tüm paylar gelince hepsi tahsil edilir.
 */
export default function SharePayPage() {
  const t = useTranslations("cart.split");
  const tp = useTranslations("payment");
  const tc = useTranslations("cart");
  const f = useFormat();
  const router = useRouter();
  const genericError = useErrorText();
  const session = useSession();
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [share, setShare] = useState<ShareViewDTO | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Hata koduna göre kurtarma yolu gösterilir (doğrulama e-postası, hesap değiştirme).
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [resend, setResend] = useState<ResendState>("idle");
  const [card, setCard] = useState({ number: "", exp: "12/30", cvc: "" });
  const [payKey, setPayKey] = useState(newKey);
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<"authorized" | "confirmed" | null>(null);
  const challengeHeadingRef = useRef<HTMLHeadingElement>(null);
  const paidRef = useRef<HTMLParagraphElement>(null);

  const errorText = useCallback(
    (err: unknown): string => {
      if (!(err instanceof ApiError))
        return err instanceof Error ? genericError(err) : tp("failed");
      switch (err.code) {
        case "SHARE_LINK_INVALID":
          return t("share.invalid");
        case "SHARE_LINK_EXPIRED":
          return t("share.expired");
        case "SHARE_EMAIL_MISMATCH":
          return t("share.notYours");
        case "EMAIL_NOT_VERIFIED":
          return t("share.verifyEmail");
        case "SHARE_ALREADY_PAID":
          return t("share.alreadyPaid");
        case "SPLIT_DEADLINE_PASSED":
          return t("share.deadlinePassed");
        case "SPLIT_CLOSED":
          return t("share.closed");
        case "PAYMENT_DECLINED":
          return t("share.declined");
        default:
          return genericError(err);
      }
    },
    [t, tp, genericError]
  );

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<{ share: ShareViewDTO }>(`/api/pay/share/${token}`, {
        cache: "no-store",
      });
      setShare(res.share);
      setLoadError(null);
      setErrorCode(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace(loginHref(window.location.pathname));
        return;
      }
      setErrorCode(err instanceof ApiError ? (err.code ?? null) : null);
      setLoadError(errorText(err));
    }
  }, [token, router, errorText]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  // Ödeme formu yerini 3DS formuna ya da sonuca bırakınca odak yeni içeriğe taşınır.
  useEffect(() => {
    if (challenge) challengeHeadingRef.current?.focus();
  }, [challenge]);
  useEffect(() => {
    if (result) paidRef.current?.focus();
  }, [result]);

  /** Sunucunun Türkçe ipucu yerine arayüz dilinde metin; demo kodu varsa ayrıca gösterilir. */
  function challengeText(outcome: Extract<ShareOutcome, { status: "requires_action" }>) {
    const c = outcome.challenge;
    if (!c || c.type !== "3ds_otp") return tp("verificationRequired");
    const demo = c.hint?.match(/\b(\d{4,8})\b/)?.[1];
    return demo
      ? `${t("share.threeDsIntro")} ${t("share.threeDsDemoHint", { code: demo })}`
      : t("share.threeDsIntro");
  }

  async function finish(outcome: ShareOutcome) {
    if (outcome.status === "requires_action") {
      setChallenge(challengeText(outcome));
      return;
    }
    setChallenge(null);
    setResult(outcome.status);
    await load();
  }

  async function failed(err: unknown) {
    setErrorCode(err instanceof ApiError ? (err.code ?? null) : null);
    setMessage(errorText(err));
    setChallenge(null);
    setPayKey(newKey());
    await load();
  }

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setMessage(null);
    setErrorCode(null);
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
      const key = err instanceof CardValidationError && err.code ? `errors.${err.code}` : null;
      setMessage(key && tp.has(key) ? tp(key) : tp("invalidCard"));
      return;
    }
    setBusy(true);
    try {
      await finish(
        await apiFetch<ShareOutcome>(`/api/pay/share/${token}`, {
          method: "POST",
          headers: { "Idempotency-Key": payKey },
          body: JSON.stringify({ cardToken }),
        })
      );
    } catch (err) {
      await failed(err);
    } finally {
      setBusy(false);
    }
  }

  async function confirm3ds(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await finish(
        await apiFetch<ShareOutcome>(`/api/pay/share/${token}/confirm`, {
          method: "POST",
          body: JSON.stringify({ code }),
        })
      );
    } catch (err) {
      await failed(err);
    } finally {
      setBusy(false);
    }
  }

  async function resendVerification() {
    if (resend === "sending") return;
    setResend("sending");
    try {
      const res = await apiFetch<{ sent?: boolean; alreadyVerified?: boolean }>(
        "/api/auth/verify-email/resend",
        { method: "POST", body: "{}" }
      );
      setResend(res.alreadyVerified ? "verified" : "sent");
    } catch {
      setResend("failed");
    }
  }

  async function switchAccount() {
    await logout();
    window.location.assign(loginHref(window.location.pathname));
  }

  const resendStatus: Record<ResendState, string> = {
    idle: "",
    sending: "",
    sent: t("share.resendSent"),
    verified: t("share.alreadyVerified"),
    failed: t("share.resendFailed"),
  };

  /** Hata koduna bağlı kurtarma yolu: e-posta doğrulama ya da doğru hesaba geçiş. */
  const recovery =
    errorCode === "EMAIL_NOT_VERIFIED" ? (
      <div className="mt-3 space-y-2 text-sm text-gray-800">
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void resendVerification()}
            aria-disabled={resend === "sending" || undefined}
            aria-busy={resend === "sending" || undefined}
            className={actionClass}
          >
            {resend === "sending" ? t("share.resendSending") : t("share.resendVerify")}
          </button>
          <button type="button" onClick={() => window.location.reload()} className={actionClass}>
            {t("share.refresh")}
          </button>
        </div>
        <p role="status">{resendStatus[resend]}</p>
      </div>
    ) : errorCode === "SHARE_EMAIL_MISMATCH" ? (
      <div className="mt-3 space-y-2 text-sm text-gray-800">
        {session.status === "ready" && session.user && (
          <p>{t("share.signedInAs", { email: session.user.email })}</p>
        )}
        <button type="button" onClick={() => void switchAccount()} className={actionClass}>
          {t("share.switchAccount")}
        </button>
      </div>
    ) : null;

  const exitLinks = (
    <div className="mt-4 flex flex-wrap gap-4">
      <Link href="/trips" className={linkClass}>
        {tc("checkout.trips")}
      </Link>
      <Link href="/" className={linkClass}>
        {t("share.home")}
      </Link>
    </div>
  );

  if (loadError) {
    return (
      <PageShell title={t("share.title")}>
        <div className="max-w-xl">
          <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            {loadError}
          </p>
          {recovery}
          {exitLinks}
        </div>
      </PageShell>
    );
  }
  if (!share) {
    return (
      <PageShell title={t("share.title")}>
        <p role="status" className="text-gray-500">
          {t("share.loading")}
        </p>
      </PageShell>
    );
  }

  const paid = share.paidByMe || result !== null;
  return (
    <PageShell title={t("share.title")}>
      <div className="max-w-xl">
        {share.organizerName && !share.isOrganizer && (
          <p className="text-gray-700">{t("share.from", { name: share.organizerName })}</p>
        )}

        <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <ul className="divide-y divide-gray-100 text-sm">
            {share.items.map((i, idx) => (
              <li key={idx} className="py-2 text-gray-700">
                {i.propertyTitle} · {i.roomTypeName} · {f.date(i.checkIn, "medium")} →{" "}
                {f.date(i.checkOut, "medium")}
              </li>
            ))}
          </ul>
          <div className="mt-4 flex justify-between border-t border-gray-200 pt-4 text-sm">
            <span className="text-gray-600">{t("share.cartTotal")}</span>
            <span className="text-gray-900">{f.money(share.cartTotalMinor, share.currency)}</span>
          </div>
          <div className="mt-2 flex justify-between">
            <span className="font-semibold text-gray-900">
              {share.isFallback ? t("fallbackLabel") : t("share.yourShare")}
            </span>
            <span className="text-xl font-bold text-gray-900" data-testid="share-amount">
              {f.money(share.amountMinor, share.currency)}
            </span>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            {t(`status.${share.status}`)} · {t("deadline", { time: f.dateTime(share.deadlineAt) })}
          </p>
        </section>

        {message && (
          <div className="mt-4">
            <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
              {message}
            </p>
            {recovery}
          </div>
        )}
        <div aria-live="polite">
          {paid && (
            <div className="mt-4">
              <p
                ref={paidRef}
                tabIndex={-1}
                className="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800 focus:outline-none"
                data-testid="share-paid"
              >
                {result === "confirmed" || share.planStatus === "SETTLED"
                  ? t("share.confirmed")
                  : t("share.authorized")}
              </p>
              {exitLinks}
            </div>
          )}
          {!paid && !share.canPay && (
            <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {t("share.closed")}
            </p>
          )}
        </div>

        {!paid && share.canPay && !challenge && (
          <form
            onSubmit={pay}
            className="mt-6 space-y-3 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"
            aria-label={tp("title")}
          >
            <h2 className="text-lg font-semibold text-gray-900">{tp("title")}</h2>
            <label className="block text-sm font-medium text-gray-700">
              {tp("cardNumber")}
              <input
                className={field}
                inputMode="numeric"
                autoComplete="cc-number"
                value={card.number}
                onChange={(e) => setCard({ ...card, number: e.target.value })}
                required
              />
            </label>
            <div className="flex gap-3">
              <label className="block flex-1 text-sm font-medium text-gray-700">
                {tp("expiry")}
                <input
                  className={field}
                  autoComplete="cc-exp"
                  value={card.exp}
                  onChange={(e) => setCard({ ...card, exp: e.target.value })}
                  required
                />
              </label>
              <label className="block flex-1 text-sm font-medium text-gray-700">
                {tp("cvc")}
                <input
                  className={field}
                  inputMode="numeric"
                  autoComplete="cc-csc"
                  value={card.cvc}
                  onChange={(e) => setCard({ ...card, cvc: e.target.value })}
                  required
                />
              </label>
            </div>
            <p className="text-xs text-gray-500">
              {tp("testCards", {
                success: TEST_CARDS.success,
                decline: TEST_CARDS.decline,
                threeDs: TEST_CARDS.threeDs,
              })}
            </p>
            {/* Meşgulken `disabled` yerine aria-disabled: odak düğmede kalır, çift gönderim yok. */}
            <button
              type="submit"
              aria-disabled={busy || undefined}
              aria-busy={busy || undefined}
              data-testid="share-pay"
              className={`w-full rounded-lg bg-[#003580] px-4 py-3 text-sm font-semibold text-white hover:bg-[#002b66] aria-disabled:bg-gray-300 aria-disabled:text-gray-700 ${focusRing}`}
            >
              {busy
                ? tp("processing")
                : `${t("share.pay")} · ${f.money(share.amountMinor, share.currency)}`}
            </button>
          </form>
        )}

        {challenge && (
          <form
            onSubmit={confirm3ds}
            aria-label={tp("threeDsTitle")}
            className="mt-6 space-y-3 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"
          >
            <h2
              ref={challengeHeadingRef}
              tabIndex={-1}
              className="text-lg font-semibold text-gray-900 focus:outline-none"
            >
              {tp("threeDsTitle")}
            </h2>
            <p className="text-sm text-gray-600">{challenge}</p>
            <label className="block text-sm font-medium text-gray-700">
              {tp("verificationCode")}
              <input
                className={field}
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
              />
            </label>
            <button
              type="submit"
              aria-disabled={busy || undefined}
              aria-busy={busy || undefined}
              className={`w-full rounded-lg bg-[#003580] px-4 py-3 text-sm font-semibold text-white aria-disabled:bg-gray-300 aria-disabled:text-gray-700 ${focusRing}`}
            >
              {busy ? tp("processing") : tp("verify")}
            </button>
          </form>
        )}
      </div>
    </PageShell>
  );
}
