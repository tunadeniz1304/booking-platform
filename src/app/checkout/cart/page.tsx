"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ApiError, apiFetch } from "@/lib/api-client";
import { CardValidationError, TEST_CARDS, tokenizeCard } from "@/lib/payment/card-token";
import { useFormat } from "@/i18n/use-format";
import { useCart, type CartDTO } from "@/components/cart/useCart";
import { SplitPayPanel } from "@/components/cart/SplitPayPanel";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useErrorText } from "@/components/ui/ui";
import type { SplitPlanDTO } from "@/lib/cart/split-payment";

type PayOutcome =
  | { status: "confirmed"; cartId: string; bookingIds: string[]; amount: number; currency: string }
  | { status: "requires_action"; cartId: string; challenge?: { hint?: string } }
  | { status: "pending_confirmation"; cartId: string };

type Step =
  "loading" | "done" | "none" | "hold" | "challenge" | "pending" | "expired" | "split" | "pay";

const newKey = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : String(Date.now());

/** Sunucu hata kodları → `cart.errors.*` (sunucunun Türkçe iletisi gösterilmez). */
const ERROR_CODES = new Set([
  "CART_NOT_HELD",
  "CART_PAYMENT_IN_PROGRESS",
  "CART_NOT_CONFIRMABLE",
  "FRAUD_BLOCKED",
  "NO_PENDING_CHALLENGE",
  "CHALLENGE_FAILED",
  "VALIDATION_ERROR",
]);

/** Onay kuyruğundaki ödeme için yoklama: 3 sn aralık, en çok ~60 sn. */
const POLL_MS = 3000;
const POLL_MAX = 20;
/** Tutma bitişine bu kadar kala bir kez uyarı duyurulur. */
const WARN_MS = 2 * 60 * 1000;

/**
 * Grup sepeti checkout'u (P1-1): 1) tüm odaları tümü-ya-hiç tut, 2) toplamı tek ödemeyle öde
 * (mock PSP hosted fields + 3DS). Tek oda checkout'u (`/checkout`) değişmeden kalır.
 */
export default function CartCheckoutPage() {
  const t = useTranslations("cart");
  const tp = useTranslations("payment");
  const f = useFormat();
  const errText = useErrorText();
  const { confirm, confirmDialog } = useConfirm();
  const { cart, setCart, loading, reload } = useCart();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [holdKey] = useState(newKey);
  const [payKey, setPayKey] = useState(newKey);
  const [card, setCard] = useState({ number: "", exp: "12/30", cvc: "" });
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [splitPlan, setSplitPlan] = useState<SplitPlanDTO | null>(null);
  const [pendingCartId, setPendingCartId] = useState<string | null>(null);
  const [pendingTimedOut, setPendingTimedOut] = useState(false);
  const [expired, setExpired] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [done, setDone] = useState<{
    outcome: PayOutcome & { status: "confirmed" };
    cart: CartDTO;
  } | null>(null);

  const titleRef = useRef<HTMLHeadingElement>(null);
  const payHeadingRef = useRef<HTMLHeadingElement>(null);
  const challengeHeadingRef = useRef<HTMLHeadingElement>(null);
  const doneHeadingRef = useRef<HTMLHeadingElement>(null);
  const statusBoxRef = useRef<HTMLDivElement>(null);
  const noCartRef = useRef<HTMLParagraphElement>(null);
  const prevStep = useRef<Step>("loading");
  const warned = useRef(false);

  /** Bilinen kodu çevirir; genel kodlar `common.errors`, gerisi verilen yerel metin. */
  const apiText = useCallback(
    (err: unknown, fallback: string): string => {
      if (err instanceof ApiError) {
        if (err.code && ERROR_CODES.has(err.code)) return t(`errors.${err.code}`);
        const generic = errText(err);
        return generic !== err.message ? generic : fallback;
      }
      return err instanceof Error ? errText(err) : fallback;
    },
    [t, errText]
  );

  const held = cart?.status === "HELD";
  const holdExpiresMs = held && cart?.holdExpiresAt ? Date.parse(cart.holdExpiresAt) : null;
  const holdExpired = holdExpiresMs !== null && now >= holdExpiresMs;
  // P1-2: aktif bölünmüş ödeme varken tek ödeme formu gizlenir (paylar ayrı ödenir).
  const splitActive = !!splitPlan && splitPlan.status !== "ABORTED";

  const step: Step = loading
    ? "loading"
    : done
      ? "done"
      : !cart || cart.items.length === 0
        ? "none"
        : !held
          ? "hold"
          : pendingCartId
            ? "pending"
            : challenge
              ? "challenge"
              : holdExpired
                ? "expired"
                : splitActive
                  ? "split"
                  : "pay";

  // Adım değişince odak yeni adımın başlığına taşınır (gönder düğmesi DOM'dan kalkınca
  // odak body'ye düşmesin; ekran okuyucu yeni adımı duysun).
  useEffect(() => {
    const prev = prevStep.current;
    prevStep.current = step;
    if (prev === step || prev === "loading") return;
    const target =
      step === "done"
        ? doneHeadingRef.current
        : step === "pay"
          ? payHeadingRef.current
          : step === "challenge"
            ? challengeHeadingRef.current
            : step === "pending" || step === "expired"
              ? statusBoxRef.current
              : step === "none"
                ? noCartRef.current
                : step === "hold"
                  ? titleRef.current
                  : null;
    target?.focus();
  }, [step]);

  // Tutma geri sayımı: 10 sn'de bir yenilenir; bitişe 2 dk kala bir kez duyurulur.
  useEffect(() => {
    if (holdExpiresMs === null) return;
    warned.current = holdExpiresMs - Date.now() <= WARN_MS;
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (!warned.current && holdExpiresMs - current <= WARN_MS && holdExpiresMs > current) {
        warned.current = true;
        setNotice(t("checkout.expiringSoon"));
      }
    }, 10_000);
    return () => clearInterval(timer);
  }, [holdExpiresMs, t]);

  // Ödeme alındı ama onay kuyrukta: sepet CHECKED_OUT olana dek yokla.
  useEffect(() => {
    if (!pendingCartId) return;
    let tries = 0;
    let stopped = false;
    const timer = setInterval(async () => {
      tries += 1;
      try {
        const res = await apiFetch<{ cart: CartDTO }>(`/api/cart/${pendingCartId}`, {
          cache: "no-store",
        });
        if (stopped) return;
        if (res.cart.status === "CHECKED_OUT") {
          stopped = true;
          clearInterval(timer);
          setDone({
            outcome: {
              status: "confirmed",
              cartId: pendingCartId,
              bookingIds: res.cart.items.flatMap((i) => (i.bookingId ? [i.bookingId] : [])),
              amount: res.cart.totalMinor,
              currency: res.cart.currency,
            },
            cart: res.cart,
          });
          setPendingCartId(null);
          setNotice(null);
          return;
        }
      } catch {
        // geçici okuma hatası: sonraki denemede tekrar
      }
      if (!stopped && tries >= POLL_MAX) {
        stopped = true;
        clearInterval(timer);
        setPendingTimedOut(true);
      }
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [pendingCartId]);

  function holdError(err: unknown): string {
    if (!(err instanceof ApiError)) return apiText(err, t("checkout.holdFailed"));
    if (err.code === "PRICE_CHANGED") return t("checkout.priceChanged");
    const details = err.details as { itemId?: string } | undefined;
    if (err.status === 409 && details?.itemId) return t("checkout.itemUnavailable");
    return apiText(err, t("checkout.holdFailed"));
  }

  async function hold() {
    if (!cart) return;
    setBusy(true);
    setMessage(null);
    setNotice(null);
    try {
      const res = await apiFetch<{ cart: CartDTO }>(`/api/cart/${cart.id}/hold`, {
        method: "POST",
        headers: { "Idempotency-Key": holdKey },
        body: "{}",
      });
      setCart(res.cart);
      setExpired(false);
      setNow(Date.now());
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
    if (outcome.status === "pending_confirmation") {
      // fix-sweep-3: tahsilat alındı, onay kuyrukta (iade yok) → bilgi olarak göster ve yokla.
      setChallenge(null);
      setNotice(t("checkout.confirmPending"));
      setPendingTimedOut(false);
      setPendingCartId(outcome.cartId);
      return;
    }
    // Ödeme onaylandı: sepet okuması başarısız olsa da başarı ekranı gösterilir.
    let doneCart: CartDTO | null = cart;
    try {
      const res = await apiFetch<{ cart: CartDTO }>(`/api/cart/${outcome.cartId}`);
      doneCart = res.cart;
    } catch {
      // bağlantılar Seyahatlerim'de görünür
    }
    if (doneCart) setDone({ outcome, cart: doneCart });
  }

  async function payFailed(err: unknown) {
    if (err instanceof ApiError && err.code === "PAYMENT_DECLINED") {
      setMessage(t("checkout.declined"));
    } else if (err instanceof ApiError && err.code === "HOLD_EXPIRED") {
      setMessage(t("checkout.expired"));
      setExpired(true);
    } else {
      setMessage(apiText(err, tp("failed")));
    }
    setChallenge(null);
    setPayKey(newKey());
    await reload();
  }

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    if (!cart || busy) return;
    setMessage(null);
    setNotice(null);
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
    if (!cart || busy) return;
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

  async function postRelease(cartId: string): Promise<CartDTO> {
    const res = await apiFetch<{ cart: CartDTO }>(`/api/cart/${cartId}/release`, {
      method: "POST",
      body: "{}",
    });
    return res.cart;
  }

  async function release() {
    if (!cart || busy) return;
    const plan = splitActive ? splitPlan : null;
    const paid = plan
      ? plan.shares.filter((s) => s.status === "AUTHORIZED" || s.status === "CAPTURED").length
      : 0;
    const ok = await confirm(
      plan
        ? {
            title: t("releaseConfirm.splitTitle"),
            body: t("releaseConfirm.splitBody", {
              count: paid,
              funded: f.money(plan.fundedMinor, plan.currency),
            }),
            confirmLabel: t("releaseConfirm.splitConfirm"),
            tone: "danger",
          }
        : {
            title: t("releaseConfirm.title"),
            body: t("releaseConfirm.body"),
            confirmLabel: t("release"),
            tone: "danger",
          }
    );
    if (!ok) return;
    setBusy(true);
    setMessage(null);
    setNotice(null);
    try {
      setCart(await postRelease(cart.id));
      setNotice(plan ? t("releasedSplit") : t("released"));
    } catch (err) {
      setMessage(apiText(err, t("updateFailed")));
    } finally {
      setBusy(false);
    }
  }

  /** Süresi dolmuş tutmayı bırakıp sepeti yeniden tutulabilir hale getirir. */
  async function recoverExpired() {
    if (!cart || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      setCart(await postRelease(cart.id));
      setNotice(t("checkout.rehold"));
    } catch {
      setExpired(true);
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function reopen() {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await apiFetch<{ cart: CartDTO | null }>(`/api/cart/reopen`, {
        method: "POST",
        body: "{}",
      });
      setCart(res.cart);
      setExpired(false);
      setNotice(t("checkout.reopened"));
    } catch (err) {
      setMessage(apiText(err, t("updateFailed")));
    } finally {
      setBusy(false);
    }
  }

  const statusRegion = (
    <div aria-live="polite">
      {message && (
        <div role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {message}
        </div>
      )}
      {notice && (
        <p role="status" className="mt-4 text-sm text-gray-700">
          {notice}
        </p>
      )}
    </div>
  );

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
        <h1
          ref={doneHeadingRef}
          tabIndex={-1}
          className="text-2xl font-bold text-green-700 focus:outline-none"
        >
          {t("checkout.success")}
        </h1>
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
        <p ref={noCartRef} tabIndex={-1} className="text-gray-700 focus:outline-none">
          {expired ? t("checkout.expiredNoCart") : t("checkout.noCart")}
        </p>
        {statusRegion}
        {expired && (
          <button
            type="button"
            onClick={reopen}
            disabled={busy}
            aria-busy={busy}
            className="mt-4 min-h-[44px] rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-800"
          >
            {t("reopen")}
          </button>
        )}
        <div>
          <Link href="/cart" className="mt-4 inline-block text-primary-600 hover:underline">
            {t("checkout.backToCart")}
          </Link>
        </div>
        {confirmDialog}
      </main>
    );
  }

  const field = "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";
  const remainingMinutes =
    holdExpiresMs !== null ? Math.max(0, Math.ceil((holdExpiresMs - now) / 60000)) : null;

  return (
    <main id="main" className="mx-auto max-w-3xl px-4 py-8">
      <h1
        ref={titleRef}
        tabIndex={-1}
        className="text-2xl font-bold text-gray-900 focus:outline-none"
      >
        {t("checkout.title")}
      </h1>

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

      {statusRegion}

      {!held && (
        <section className="mt-6">
          <p className="text-sm text-gray-600">{t("checkout.holdHint")}</p>
          <button
            type="button"
            onClick={hold}
            disabled={busy}
            aria-busy={busy}
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

      {step === "pending" && (
        <div
          ref={statusBoxRef}
          tabIndex={-1}
          className="mt-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm focus:outline-none"
        >
          <h2 className="text-lg font-semibold text-gray-900">{t("checkout.pendingTitle")}</h2>
          <p className="mt-2 text-sm text-gray-700">
            {pendingTimedOut ? t("checkout.pendingSlow") : t("checkout.pendingWait")}
          </p>
          {pendingTimedOut && (
            <Link
              href="/trips"
              className="mt-3 inline-block font-semibold text-primary-600 hover:underline"
            >
              {t("checkout.trips")}
            </Link>
          )}
        </div>
      )}

      {step === "expired" && (
        <div
          ref={statusBoxRef}
          tabIndex={-1}
          className="mt-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm focus:outline-none"
        >
          <h2 className="text-lg font-semibold text-gray-900">{t("checkout.expiredTitle")}</h2>
          <p className="mt-2 text-sm text-gray-700">{t("checkout.expiredHint")}</p>
          <button
            type="button"
            onClick={recoverExpired}
            disabled={busy}
            aria-busy={busy}
            className="mt-3 w-full rounded-lg bg-[#003580] px-4 py-3 text-sm font-semibold text-white hover:bg-[#002b66] disabled:bg-gray-300 disabled:text-gray-700"
          >
            {t("checkout.reholdButton")}
          </button>
        </div>
      )}

      {held && cart.holdExpiresAt && (step === "pay" || step === "split") && (
        <p className="mt-6 text-sm text-amber-700">
          <span>{t("checkout.heldUntil", { time: f.time(cart.holdExpiresAt) })}</span>{" "}
          {remainingMinutes !== null && (
            <span role="timer" className="font-semibold">
              {t("checkout.remaining", { minutes: remainingMinutes })}
            </span>
          )}
        </p>
      )}

      {step === "pay" && (
        <form
          onSubmit={pay}
          className="mt-3 space-y-3 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"
          aria-label={tp("title")}
          aria-busy={busy}
        >
          <h2
            ref={payHeadingRef}
            tabIndex={-1}
            className="text-lg font-semibold text-gray-900 focus:outline-none"
          >
            {tp("title")}
          </h2>
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
          {/* Yıkıcı eylem birincil düğmeden ayrık durur (yanlış dokunuşu önler). */}
          <div className="pt-3">
            <button
              type="button"
              onClick={release}
              disabled={busy}
              className="min-h-[44px] w-full rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-800"
            >
              {t("release")}
            </button>
          </div>
        </form>
      )}

      {held && (step === "pay" || step === "split") && (
        <SplitPayPanel
          cartId={cart.id}
          totalMinor={cart.totalMinor}
          currency={cart.currency}
          allowCreate
          onPlan={setSplitPlan}
        />
      )}
      {step === "split" && (
        <button
          type="button"
          onClick={release}
          disabled={busy}
          className="mt-6 min-h-[44px] w-full rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-800"
        >
          {t("release")}
        </button>
      )}

      {step === "challenge" && (
        <form
          onSubmit={confirm3ds}
          aria-label={tp("threeDsTitle")}
          aria-busy={busy}
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
            disabled={busy}
            className="w-full rounded-lg bg-[#003580] px-4 py-3 text-sm font-semibold text-white disabled:bg-gray-300 disabled:text-gray-700"
          >
            {busy ? tp("processing") : tp("verify")}
          </button>
        </form>
      )}
      {confirmDialog}
    </main>
  );
}
