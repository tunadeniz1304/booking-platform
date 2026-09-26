"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ApiError, apiFetch } from "@/lib/api-client";
import { CardValidationError, TEST_CARDS, tokenizeCard } from "@/lib/payment/card-token";
import { useFormat } from "@/i18n/use-format";
import { useCart, type CartDTO } from "@/components/cart/useCart";

type PayOutcome =
  | { status: "confirmed"; cartId: string; bookingIds: string[]; amount: number; currency: string }
  | { status: "requires_action"; cartId: string; challenge?: { hint?: string } };

const newKey = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : String(Date.now());

/**
 * Grup sepeti checkout'u (P1-1): 1) tüm odaları tümü-ya-hiç tut, 2) toplamı tek ödemeyle öde
 * (mock PSP hosted fields + 3DS). Tek oda checkout'u (`/checkout`) değişmeden kalır.
 */
export default function CartCheckoutPage() {
  const t = useTranslations("cart");
  const tp = useTranslations("payment");
  const f = useFormat();
  const { cart, setCart, loading, reload } = useCart();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [holdKey] = useState(newKey);
  const [payKey, setPayKey] = useState(newKey);
  const [card, setCard] = useState({ number: "", exp: "12/30", cvc: "" });
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [done, setDone] = useState<{
    outcome: PayOutcome & { status: "confirmed" };
    cart: CartDTO;
  } | null>(null);

  function holdError(err: unknown): string {
    if (!(err instanceof ApiError)) return t("checkout.holdFailed");
    if (err.code === "PRICE_CHANGED") return t("checkout.priceChanged");
    const details = err.details as { itemId?: string } | undefined;
    if (err.status === 409 && details?.itemId) return t("checkout.itemUnavailable");
    return err.message;
  }

  async function hold() {
    if (!cart) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await apiFetch<{ cart: CartDTO }>(`/api/cart/${cart.id}/hold`, {
        method: "POST",
        headers: { "Idempotency-Key": holdKey },
        body: "{}",
      });
      setCart(res.cart);
    } catch (err) {
      setMessage(holdError(err));
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function finish(outcome: PayOutcome) {
    if (outcome.status === "requires_action") {
      setChallenge(outcome.challenge?.hint ?? tp("verificationRequired"));
      return;
    }
    const res = await apiFetch<{ cart: CartDTO }>(`/api/cart/${outcome.cartId}`);
    setDone({ outcome, cart: res.cart });
  }

  async function payFailed(err: unknown) {
    if (err instanceof ApiError && err.code === "PAYMENT_DECLINED") {
      setMessage(t("checkout.declined"));
    } else if (err instanceof ApiError && err.code === "HOLD_EXPIRED") {
      setMessage(t("checkout.expired"));
    } else {
      setMessage(err instanceof ApiError ? err.message : tp("failed"));
    }
    setChallenge(null);
    setPayKey(newKey());
    await reload();
  }

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    if (!cart) return;
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
        await apiFetch<PayOutcome>(`/api/cart/${cart.id}/pay`, {
          method: "POST",
          headers: { "Idempotency-Key": payKey },
          body: JSON.stringify({ cardToken }),
        })
      );
    } catch (err) {
      await payFailed(err);
    } finally {
      setBusy(false);
    }
  }

  async function confirm3ds(e: React.FormEvent) {
    e.preventDefault();
    if (!cart) return;
    setBusy(true);
    try {
      await finish(
        await apiFetch<PayOutcome>(`/api/cart/${cart.id}/pay/confirm`, {
          method: "POST",
          body: JSON.stringify({ code }),
        })
      );
      setChallenge(null);
    } catch (err) {
      await payFailed(err);
    } finally {
      setBusy(false);
    }
  }

  async function release() {
    if (!cart) return;
    setBusy(true);
    try {
      const res = await apiFetch<{ cart: CartDTO }>(`/api/cart/${cart.id}/release`, {
        method: "POST",
        body: "{}",
      });
      setCart(res.cart);
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : t("updateFailed"));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <main id="main" className="mx-auto max-w-3xl px-4 py-8">
        <p className="text-gray-500">{t("loading")}</p>
      </main>
    );
  }

  if (done) {
    return (
      <main id="main" className="mx-auto max-w-3xl px-4 py-8" data-testid="cart-success">
        <h1 className="text-2xl font-bold text-green-700">{t("checkout.success")}</h1>
        <p className="mt-2 text-gray-700">
          {t("checkout.successHint", {
            amount: f.money(done.outcome.amount, done.outcome.currency),
          })}
        </p>
        <ul className="mt-6 space-y-3">
          {done.cart.items.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white p-4"
            >
              <span className="text-sm text-gray-800">
                {item.propertyTitle} · {item.roomTypeName} · {f.date(item.checkIn, "medium")}
              </span>
              {item.bookingId && (
                <Link
                  href={`/booking/${item.bookingId}`}
                  className="text-sm font-semibold text-primary-600 hover:underline"
                >
                  {t("checkout.viewBooking")}
                </Link>
              )}
            </li>
          ))}
        </ul>
        <Link
          href="/trips"
          className="mt-6 inline-block font-semibold text-primary-600 hover:underline"
        >
          {t("checkout.trips")}
        </Link>
      </main>
    );
  }

  if (!cart || cart.items.length === 0) {
    return (
      <main id="main" className="mx-auto max-w-3xl px-4 py-8 text-center">
        <p className="text-gray-700">{t("checkout.noCart")}</p>
        <Link href="/cart" className="mt-4 inline-block text-primary-600 hover:underline">
          {t("checkout.backToCart")}
        </Link>
      </main>
    );
  }

  const field = "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";
  const held = cart.status === "HELD";

  return (
    <main id="main" className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900">{t("checkout.title")}</h1>

      <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">{t("checkout.summary")}</h2>
        <ul className="mt-4 divide-y divide-gray-100 text-sm">
          {cart.items.map((item) => (
            <li key={item.id} className="flex justify-between gap-3 py-2">
              <span className="text-gray-700">
                {item.propertyTitle} · {item.roomTypeName} × {item.quantity} ·{" "}
                {f.date(item.checkIn, "medium")} → {f.date(item.checkOut, "medium")}
              </span>
              <span className="font-medium text-gray-900">
                {f.money(item.totalMinor, cart.currency)}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex justify-between border-t border-gray-200 pt-4">
          <span className="font-semibold text-gray-900">{t("total")}</span>
          <span className="text-lg font-bold text-gray-900" data-testid="checkout-total">
            {f.money(cart.totalMinor, cart.currency)}
          </span>
        </div>
        <p className="mt-2 text-xs text-gray-500">{t("totalNotice")}</p>
      </section>

      <div aria-live="polite">
        {message && (
          <div role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            {message}
          </div>
        )}
      </div>

      {!held && (
        <section className="mt-6">
          <p className="text-sm text-gray-600">{t("checkout.holdHint")}</p>
          <button
            type="button"
            onClick={hold}
            disabled={busy}
            data-testid="cart-hold"
            className="mt-3 w-full rounded-lg bg-[#003580] px-4 py-3 text-sm font-semibold text-white hover:bg-[#002b66] disabled:bg-gray-300 disabled:text-gray-700"
          >
            {busy ? t("checkout.holding") : t("checkout.hold")}
          </button>
          <Link href="/cart" className="mt-3 inline-block text-sm text-primary-600 hover:underline">
            {t("checkout.backToCart")}
          </Link>
        </section>
      )}

      {held && !challenge && (
        <form
          onSubmit={pay}
          className="mt-6 space-y-3 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"
          aria-label={tp("title")}
        >
          <h2 className="text-lg font-semibold text-gray-900">{tp("title")}</h2>
          {cart.holdExpiresAt && (
            <p className="text-sm text-amber-700">
              {t("checkout.heldUntil", { time: f.time(cart.holdExpiresAt) })}
            </p>
          )}
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
            data-testid="cart-pay"
            className="w-full rounded-lg bg-[#003580] px-4 py-3 text-sm font-semibold text-white hover:bg-[#002b66] disabled:bg-gray-300 disabled:text-gray-700"
          >
            {busy
              ? tp("processing")
              : `${tp("payAndConfirm")} · ${f.money(cart.totalMinor, cart.currency)}`}
          </button>
          <button
            type="button"
            onClick={release}
            disabled={busy}
            className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-800"
          >
            {t("release")}
          </button>
        </form>
      )}

      {held && challenge && (
        <form
          onSubmit={confirm3ds}
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
