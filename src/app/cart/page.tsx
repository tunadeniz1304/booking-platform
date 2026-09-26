"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ApiError, apiFetch } from "@/lib/api-client";
import { useFormat } from "@/i18n/use-format";
import { useCart, type CartDTO, type CartItemDTO } from "@/components/cart/useCart";
import { SplitPayPanel } from "@/components/cart/SplitPayPanel";

const input =
  "mt-1 w-20 rounded-lg border border-gray-300 px-2 py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[#003580]";

/** Grup sepeti (P1-1): kalemleri düzenle, toplamı gör, tek ödemeye geç. */
export default function CartPage() {
  const t = useTranslations("cart");
  const f = useFormat();
  const { cart, setCart, loading, error, reload } = useCart();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function mutate(run: () => Promise<{ cart: CartDTO | null }>) {
    setBusy(true);
    setMessage(null);
    try {
      setCart((await run()).cart);
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : t("updateFailed"));
      await reload();
    } finally {
      setBusy(false);
    }
  }

  const patch = (item: CartItemDTO, body: Record<string, number>) =>
    mutate(() =>
      apiFetch(`/api/cart/items/${item.id}`, { method: "PATCH", body: JSON.stringify(body) })
    );
  const remove = (item: CartItemDTO) =>
    mutate(() => apiFetch(`/api/cart/items/${item.id}`, { method: "DELETE" }));
  const release = (id: string) =>
    mutate(() => apiFetch(`/api/cart/${id}/release`, { method: "POST", body: "{}" }));
  const reopen = () => mutate(() => apiFetch(`/api/cart/reopen`, { method: "POST", body: "{}" }));
  const clear = (id: string) => {
    if (!window.confirm(t("cancelConfirm"))) return;
    return mutate(async () => {
      await apiFetch(`/api/cart/${id}`, { method: "DELETE" });
      return { cart: null };
    });
  };

  if (loading) {
    return (
      <main id="main" className="mx-auto max-w-3xl px-4 py-8">
        <p className="text-gray-500">{t("loading")}</p>
      </main>
    );
  }

  const locked = cart?.status === "HELD";

  return (
    <main id="main" className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900">{t("title")}</h1>
      {(error || message) && (
        <div role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {message ?? t("loadFailed")}
        </div>
      )}

      {!cart || cart.items.length === 0 ? (
        <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-sm">
          <p className="text-lg font-semibold text-gray-900">{t("empty")}</p>
          <p className="mt-2 text-sm text-gray-600">{t("emptyHint")}</p>
          <div className="mt-4 flex flex-wrap justify-center gap-3">
            <Link
              href="/"
              className="rounded-lg bg-[#003580] px-4 py-2 text-sm font-semibold text-white"
            >
              {t("browse")}
            </Link>
            {!cart && (
              <button
                type="button"
                onClick={reopen}
                disabled={busy}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-800"
              >
                {t("reopen")}
              </button>
            )}
          </div>
        </section>
      ) : (
        <>
          {locked && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <span>{t("lockedNotice")}</span>
              <button
                type="button"
                onClick={() => release(cart.id)}
                disabled={busy}
                className="rounded-md border border-amber-700 px-3 py-1 font-semibold"
              >
                {t("release")}
              </button>
            </div>
          )}
          <ul className="mt-6 space-y-4" data-testid="cart-items">
            {cart.items.map((item) => (
              <li
                key={item.id}
                className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"
                data-testid="cart-item"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <Link
                      href={`/property/${item.propertyId}`}
                      className="font-semibold text-gray-900 hover:underline"
                    >
                      {item.propertyTitle}
                    </Link>
                    <p className="text-sm text-gray-600">
                      {t("item.room")}: {item.roomTypeName}
                      {item.city ? ` · ${item.city}` : ""}
                    </p>
                    <p className="text-sm text-gray-600">
                      {t("item.dates")}: {f.date(item.checkIn, "medium")} →{" "}
                      {f.date(item.checkOut, "medium")} ({t("item.nights", { count: item.nights })})
                    </p>
                  </div>
                  <p className="text-lg font-semibold text-gray-900">
                    {f.money(item.totalMinor, cart.currency)}
                  </p>
                </div>
                <div className="mt-3 flex flex-wrap items-end gap-4 text-sm text-gray-700">
                  <label>
                    {t("item.adults")}
                    <input
                      type="number"
                      min={1}
                      max={20}
                      className={`${input} block`}
                      defaultValue={item.adults}
                      disabled={locked || busy}
                      onBlur={(e) => {
                        const v = Number(e.target.value);
                        if (v >= 1 && v !== item.adults) void patch(item, { adults: v });
                      }}
                    />
                  </label>
                  <label>
                    {t("item.children")}
                    <input
                      type="number"
                      min={0}
                      max={20}
                      className={`${input} block`}
                      defaultValue={item.children}
                      disabled={locked || busy}
                      onBlur={(e) => {
                        const v = Number(e.target.value);
                        if (v >= 0 && v !== item.children) void patch(item, { children: v });
                      }}
                    />
                  </label>
                  <label>
                    {t("item.quantity")}
                    <select
                      className={`${input} block`}
                      value={item.quantity}
                      disabled={locked || busy}
                      onChange={(e) => void patch(item, { quantity: Number(e.target.value) })}
                    >
                      {[1, 2, 3, 4, 5].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() => remove(item)}
                    disabled={locked || busy}
                    aria-label={t("item.removeLabel", { name: item.propertyTitle })}
                    className="ml-auto rounded-md px-3 py-1 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:text-gray-400"
                  >
                    {t("item.remove")}
                  </button>
                </div>
              </li>
            ))}
          </ul>

          {locked && (
            // P1-2: bölünmüş ödeme varsa pay durum listesi (plan checkout'ta kurulur).
            <SplitPayPanel
              cartId={cart.id}
              totalMinor={cart.totalMinor}
              currency={cart.currency}
              allowCreate={false}
            />
          )}

          <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-lg font-semibold text-gray-900">{t("total")}</span>
              <span className="text-xl font-bold text-gray-900" data-testid="cart-total">
                {f.money(cart.totalMinor, cart.currency)}
              </span>
            </div>
            <p className="mt-2 text-xs text-gray-500">{t("totalNotice")}</p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link
                href="/checkout/cart"
                className="flex-1 rounded-lg bg-[#003580] px-4 py-3 text-center text-sm font-semibold text-white hover:bg-[#002b66]"
              >
                {t("proceed")}
              </Link>
              <button
                type="button"
                onClick={() => clear(cart.id)}
                disabled={busy}
                className="rounded-lg border border-gray-300 px-4 py-3 text-sm font-semibold text-gray-800"
              >
                {t("cancelCart")}
              </button>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
