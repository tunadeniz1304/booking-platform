"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ApiError, apiFetch } from "@/lib/api-client";
import { CardValidationError, TEST_CARDS, tokenizeCard } from "@/lib/payment/card-token";
import { useFormat } from "@/i18n/use-format";
import type { ShareOutcome, ShareViewDTO } from "@/lib/cart/split-payment";

const newKey = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : String(Date.now());

const field = "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";

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
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [share, setShare] = useState<ShareViewDTO | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [card, setCard] = useState({ number: "", exp: "12/30", cvc: "" });
  const [payKey, setPayKey] = useState(newKey);
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<"authorized" | "confirmed" | null>(null);

  const errorText = useCallback(
    (err: unknown): string => {
      if (!(err instanceof ApiError)) return tp("failed");
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
          return err.message;
      }
    },
    [t, tp]
  );

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<{ share: ShareViewDTO }>(`/api/pay/share/${token}`, {
        cache: "no-store",
      });
      setShare(res.share);
      setLoadError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace(`/login?redirect=${encodeURIComponent(window.location.pathname)}`);
        return;
      }
      setLoadError(errorText(err));
    }
  }, [token, router, errorText]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  async function finish(outcome: ShareOutcome) {
    if (outcome.status === "requires_action") {
      setChallenge(outcome.challenge?.hint ?? tp("verificationRequired"));
      return;
    }
    setChallenge(null);
    setResult(outcome.status);
    await load();
  }

  async function failed(err: unknown) {
    setMessage(errorText(err));
    setChallenge(null);
    setPayKey(newKey());
    await load();
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
      setMessage(err instanceof CardValidationError ? err.message : tp("invalidCard"));
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

  if (loadError) {
    return (
      <main id="main" className="mx-auto max-w-xl px-4 py-8 text-center">
        <h1 className="text-2xl font-bold text-gray-900">{t("share.title")}</h1>
        <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {loadError}
        </p>
        <Link href="/trips" className="mt-4 inline-block text-primary-600 hover:underline">
          {tc("checkout.trips")}
        </Link>
      </main>
    );
  }
  if (!share) {
    return (
      <main id="main" className="mx-auto max-w-xl px-4 py-8">
        <p className="text-gray-500">{t("share.loading")}</p>
      </main>
    );
  }

  const paid = share.paidByMe || result !== null;
  return (
    <main id="main" className="mx-auto max-w-xl px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900">{t("share.title")}</h1>
      {share.organizerName && !share.isOrganizer && (
        <p className="mt-2 text-gray-700">{t("share.from", { name: share.organizerName })}</p>
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

      <div aria-live="polite">
        {message && (
          <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            {message}
          </p>
        )}
        {paid && (
          <p
            className="mt-4 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800"
            data-testid="share-paid"
          >
            {result === "confirmed" || share.planStatus === "SETTLED"
              ? t("share.confirmed")
              : t("share.authorized")}
          </p>
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
          <button
            type="submit"
            disabled={busy}
            data-testid="share-pay"
            className="w-full rounded-lg bg-[#003580] px-4 py-3 text-sm font-semibold text-white hover:bg-[#002b66] disabled:bg-gray-300 disabled:text-gray-700"
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
          <h2 className="text-lg font-semibold text-gray-900">{tp("threeDsTitle")}</h2>
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
            disabled={busy}
            className="w-full rounded-lg bg-[#003580] px-4 py-3 text-sm font-semibold text-white disabled:bg-gray-300 disabled:text-gray-700"
          >
            {busy ? tp("processing") : tp("verify")}
          </button>
        </form>
      )}
    </main>
  );
}
