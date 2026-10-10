"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ApiError, apiFetch } from "@/lib/api-client";
import { useFormat } from "@/i18n/use-format";
import { useCart, type CartDTO, type CartItemDTO } from "@/components/cart/useCart";
import { SplitPayPanel } from "@/components/cart/SplitPayPanel";
import { PageShell, useErrorText } from "@/components/ui/ui";
import { useConfirm } from "@/components/ui/ConfirmDialog";

const input =
  "mt-1 w-20 rounded-lg border border-gray-300 px-2 py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[#003580]";

/** Sunucu kodları arayüz dilinde gösterilir (ham sunucu metni yerine). */
const CART_ERROR_CODES = new Set([
  "CART_LOCKED",
  "CART_NOT_OPEN",
  "CONCURRENT_UPDATE",
  "CONFLICT",
  "VALIDATION_ERROR",
  "NOT_FOUND",
]);

const GUEST_LIMITS = { adults: { min: 1, max: 20 }, children: { min: 0, max: 20 } } as const;
type GuestField = keyof typeof GUEST_LIMITS;

/** Grup sepeti (P1-1): kalemleri düzenle, toplamı gör, tek ödemeye geç. */
export default function CartPage() {
  const t = useTranslations("cart");
  const f = useFormat();
  const genericError = useErrorText();
  const { confirm, confirmDialog } = useConfirm();
  const { cart, setCart, loading, error, reload } = useCart();
  // Odaktaki kontrol `disabled` yapılmaz (odak <body>'ye düşer); meşgulken olaylar yok sayılır.
  const [busy, setBusy] = useState(false);
  const [pendingItemId, setPendingItemId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [cleared, setCleared] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  const emptyHeadingRef = useRef<HTMLHeadingElement>(null);
  // Kalem kaldırıldıktan sonra odağın gideceği sıra (sonraki kalem ya da boş sepet başlığı).
  const focusAfterRemove = useRef<number | null>(null);

  const errorText = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError) {
        if (err.code && CART_ERROR_CODES.has(err.code)) return t(`errors.${err.code}`);
        if (!err.code) return t("updateFailed");
      }
      return genericError(err);
    },
    [t, genericError]
  );

  useEffect(() => {
    const index = focusAfterRemove.current;
    if (index === null) return;
    focusAfterRemove.current = null;
    const links = listRef.current?.querySelectorAll<HTMLAnchorElement>("[data-item-link]");
    if (links && links.length > 0) links[Math.min(index, links.length - 1)].focus();
    else emptyHeadingRef.current?.focus();
  }, [cart]);

  async function mutate(
    run: () => Promise<{ cart: CartDTO | null }>,
    announce: (next: CartDTO | null) => string,
    itemId: string | null = null
  ): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setPendingItemId(itemId);
    setMessage(null);
    setAnnouncement("");
    try {
      const next = (await run()).cart;
      setCart(next);
      setAnnouncement(announce(next));
      return true;
    } catch (err) {
      setMessage(errorText(err));
      await reload();
      return false;
    } finally {
      setBusy(false);
      setPendingItemId(null);
    }
  }

  const totalText = (next: CartDTO | null) =>
    next ? f.money(next.totalMinor, next.currency) : f.money(0, cart?.currency ?? "TRY");

  const patch = (item: CartItemDTO, body: Record<string, number>) =>
    mutate(
      () => apiFetch(`/api/cart/items/${item.id}`, { method: "PATCH", body: JSON.stringify(body) }),
      (next) => t("announce.updated", { total: totalText(next) }),
      item.id
    );
  const remove = (item: CartItemDTO, index: number) =>
    mutate(
      () => apiFetch(`/api/cart/items/${item.id}`, { method: "DELETE" }),
      (next) => {
        // Kaldırılan düğmenin yerine odak: sonraki kalemin başlığı ya da boş sepet başlığı.
        focusAfterRemove.current = index;
        return t("announce.removed", { name: item.propertyTitle, total: totalText(next) });
      },
      item.id
    );
  const release = (id: string) =>
    mutate(
      () => apiFetch(`/api/cart/${id}/release`, { method: "POST", body: "{}" }),
      () => t("announce.released")
    );
  const reopen = () =>
    mutate(
      () => apiFetch(`/api/cart/reopen`, { method: "POST", body: "{}" }),
      () => t("announce.reopened")
    );
  const clear = async (id: string, held: boolean) => {
    if (busy) return;
    const ok = await confirm({
      title: t("cancelConfirm"),
      body: held ? t("cancelConfirmHeld") : t("cancelConfirmBody"),
      confirmLabel: t("cancelCart"),
      cancelLabel: t("cancelKeep"),
      tone: "danger",
    });
    if (!ok) return;
    const done = await mutate(
      async () => {
        await apiFetch(`/api/cart/${id}`, { method: "DELETE" });
        return { cart: null };
      },
      () => {
        focusAfterRemove.current = 0;
        return t("announce.cleared");
      }
    );
    if (done) setCleared(true);
  };

  const liveRegion = (
    <p role="status" aria-live="polite" className="sr-only">
      {announcement}
    </p>
  );

  if (loading) {
    return (
      <PageShell title={t("title")}>
        <p role="status" className="text-gray-500">
          {t("loading")}
        </p>
      </PageShell>
    );
  }

  const locked = cart?.status === "HELD";

  return (
    <PageShell title={t("title")}>
      <div className="max-w-3xl">
        {liveRegion}
        {(error || message) && (
          <div role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            {message ?? t("loadFailed")}
          </div>
        )}

        {!cart || cart.items.length === 0 ? (
          <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-sm">
            <h2
              ref={emptyHeadingRef}
              tabIndex={-1}
              className="text-lg font-semibold text-gray-900 focus:outline-none"
            >
              {t("empty")}
            </h2>
            <p className="mt-2 text-sm text-gray-600">{t("emptyHint")}</p>
            <div className="mt-4 flex flex-wrap justify-center gap-3">
              <Link
                href="/"
                className="inline-flex min-h-[44px] items-center rounded-lg bg-[#003580] px-4 py-2 text-sm font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#003580] focus-visible:ring-offset-2"
              >
                {t("browse")}
              </Link>
              {!cart && !cleared && (
                <button
                  type="button"
                  onClick={() => void reopen()}
                  aria-disabled={busy || undefined}
                  aria-busy={busy || undefined}
                  className="min-h-[44px] rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#003580] focus-visible:ring-offset-2"
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
                  onClick={() => void release(cart.id)}
                  aria-disabled={busy || undefined}
                  aria-busy={busy || undefined}
                  className="min-h-[44px] rounded-md border border-amber-700 px-3 py-1 font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-[#003580] sm:min-h-0"
                >
                  {t("release")}
                </button>
              </div>
            )}
            <ul ref={listRef} className="mt-6 space-y-4" data-testid="cart-items">
              {cart.items.map((item, index) => (
                <CartItemRow
                  key={item.id}
                  item={item}
                  currency={cart.currency}
                  locked={locked}
                  busy={busy}
                  pending={pendingItemId === item.id}
                  onPatch={patch}
                  onRemove={() => void remove(item, index)}
                />
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
                  className="flex-1 rounded-lg bg-[#003580] px-4 py-3 text-center text-sm font-semibold text-white hover:bg-[#002b66] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#003580] focus-visible:ring-offset-2"
                >
                  {t("proceed")}
                </Link>
                <button
                  type="button"
                  onClick={() => void clear(cart.id, locked)}
                  aria-disabled={busy || undefined}
                  className="rounded-lg border border-gray-300 px-4 py-3 text-sm font-semibold text-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#003580] focus-visible:ring-offset-2"
                >
                  {t("cancelCart")}
                </button>
              </div>
            </section>
          </>
        )}
        {confirmDialog}
      </div>
    </PageShell>
  );
}

type Drafts = { adults: string; children: string; quantity: number };
const draftsOf = (item: CartItemDTO): Drafts => ({
  adults: String(item.adults),
  children: String(item.children),
  quantity: item.quantity,
});

/**
 * Tek sepet kalemi: kişi sayıları kontrollü alanlardır (ekrandaki değer sunucu değerinden
 * sessizce ayrışmaz). Geçersiz giriş alan altında açıklanır ve kayıtlı değere geri döner.
 */
function CartItemRow({
  item,
  currency,
  locked,
  busy,
  pending,
  onPatch,
  onRemove,
}: {
  item: CartItemDTO;
  currency: string;
  locked: boolean;
  busy: boolean;
  pending: boolean;
  onPatch: (item: CartItemDTO, body: Record<string, number>) => Promise<boolean>;
  onRemove: () => void;
}) {
  const t = useTranslations("cart");
  const f = useFormat();
  const uid = useId();
  const [drafts, setDrafts] = useState<Drafts>(() => draftsOf(item));
  const [synced, setSynced] = useState(item);
  const [errors, setErrors] = useState<Partial<Record<GuestField, string>>>({});
  const quantityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sunucu değeri değişince (kaydetme, yeniden yükleme) taslak ona eşitlenir.
  if (synced !== item) {
    setSynced(item);
    setDrafts(draftsOf(item));
  }

  useEffect(
    () => () => {
      if (quantityTimer.current) clearTimeout(quantityTimer.current);
    },
    []
  );

  async function commitGuests(field: GuestField) {
    if (locked || busy) return;
    const raw = drafts[field].trim();
    const v = Number(raw);
    const { min, max } = GUEST_LIMITS[field];
    if (raw === "" || !Number.isInteger(v) || v < min || v > max) {
      setErrors((e) => ({
        ...e,
        [field]: t(field === "adults" ? "item.adultsRange" : "item.childrenRange", {
          min,
          max,
          saved: item[field],
        }),
      }));
      setDrafts((d) => ({ ...d, [field]: String(item[field]) }));
      return;
    }
    setErrors((e) => ({ ...e, [field]: undefined }));
    if (v === item[field]) return;
    const ok = await onPatch(item, { [field]: v });
    if (!ok) setDrafts((d) => ({ ...d, [field]: String(item[field]) }));
  }

  async function commitQuantity(value: number) {
    if (quantityTimer.current) {
      clearTimeout(quantityTimer.current);
      quantityTimer.current = null;
    }
    if (locked || busy || value === item.quantity) return;
    const ok = await onPatch(item, { quantity: value });
    if (!ok) setDrafts((d) => ({ ...d, quantity: item.quantity }));
  }

  const guestInput = (field: GuestField) => {
    const id = `${uid}-${field}`;
    const errorId = `${id}-error`;
    const error = errors[field];
    return (
      <div>
        <label htmlFor={id}>{t(`item.${field}`)}</label>
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={GUEST_LIMITS[field].min}
          max={GUEST_LIMITS[field].max}
          step={1}
          className={`${input} block`}
          value={drafts[field]}
          disabled={locked}
          readOnly={busy}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(e) => setDrafts((d) => ({ ...d, [field]: e.target.value }))}
          onBlur={() => void commitGuests(field)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void commitGuests(field);
            }
          }}
        />
        {error && (
          <p id={errorId} className="mt-1 max-w-[12rem] text-xs font-medium text-red-700">
            {error}
          </p>
        )}
      </div>
    );
  };

  return (
    <li
      className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"
      data-testid="cart-item"
      aria-busy={pending || undefined}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href={`/property/${item.propertyId}`}
            data-item-link
            className="font-semibold text-gray-900 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#003580]"
          >
            {item.propertyTitle}
          </Link>
          <p className="text-sm text-gray-600">
            {t("item.room")}: {item.roomTypeName}
            {item.city ? ` · ${item.city}` : ""}
          </p>
          <p className="text-sm text-gray-600">
            {t("item.dates")}: {f.date(item.checkIn, "medium")} → {f.date(item.checkOut, "medium")}{" "}
            ({t("item.nights", { count: item.nights })})
          </p>
        </div>
        <p className="text-lg font-semibold text-gray-900">{f.money(item.totalMinor, currency)}</p>
      </div>
      <div className="mt-3 flex flex-wrap items-start gap-4 text-sm text-gray-700">
        {guestInput("adults")}
        {guestInput("children")}
        <div>
          <label htmlFor={`${uid}-quantity`}>{t("item.quantity")}</label>
          <select
            id={`${uid}-quantity`}
            className={`${input} block`}
            value={drafts.quantity}
            disabled={locked}
            aria-disabled={busy || undefined}
            onChange={(e) => {
              if (busy) return;
              const value = Number(e.target.value);
              setDrafts((d) => ({ ...d, quantity: value }));
              // Ok tuşlarıyla gezinirken her adımda istek atılmaz: kısa bekleme ya da odak çıkışı.
              if (quantityTimer.current) clearTimeout(quantityTimer.current);
              quantityTimer.current = setTimeout(() => void commitQuantity(value), 600);
            }}
            onBlur={() => void commitQuantity(drafts.quantity)}
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={() => {
            if (!busy) onRemove();
          }}
          disabled={locked}
          aria-disabled={busy || undefined}
          aria-label={t("item.removeLabel", { name: item.propertyTitle })}
          className="ml-auto mt-5 min-h-[44px] rounded-md px-3 py-1 text-sm font-semibold text-red-700 hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#003580] disabled:text-gray-400 sm:min-h-0"
        >
          {t("item.remove")}
        </button>
      </div>
    </li>
  );
}
