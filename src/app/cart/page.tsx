"use client";

import { Fragment, useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ApiError, apiFetch } from "@/lib/api-client";
import { useFormat } from "@/i18n/use-format";
import { useCart, type CartDTO, type CartItemDTO } from "@/components/cart/useCart";
import { SplitPayPanel } from "@/components/cart/SplitPayPanel";
import { Button, PageShell, useErrorText } from "@/components/ui/ui";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { GuestCountStepper } from "@/components/booking/GuestCountStepper";
import { propertyHref } from "@/components/property/PropertyCard";
import { setHeaderCartCount } from "@/components/layout/useHeaderCartCount";
import type { SplitPlanDTO } from "@/lib/cart/split-payment";

const select =
  "mt-1 block h-11 w-20 rounded-lg border border-gray-300 px-2 text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-[#003580] disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm";

/** Sunucu kodları arayüz dilinde gösterilir (ham sunucu metni yerine). */
const CART_ERROR_CODES = new Set([
  "CART_LOCKED",
  "CART_NOT_OPEN",
  "CONCURRENT_UPDATE",
  "CONFLICT",
  "VALIDATION_ERROR",
  "NOT_FOUND",
]);

// Sunucu sınırlarıyla aynı (cartItemPatchSchema: kişi 1-20/0-20, oda adedi 1-10).
const GUEST_LIMITS = { adults: { min: 1, max: 20 }, children: { min: 0, max: 20 } } as const;
type GuestField = keyof typeof GUEST_LIMITS;
const GUEST_FIELDS: readonly GuestField[] = ["adults", "children"];
const ROOM_OPTIONS = Array.from({ length: 10 }, (_, i) => i + 1);
/** Değer değişikliklerinin (−/+, oda adedi) toplanıp tek istekle kaydedilmesi için bekleme. */
const COMMIT_DELAY_MS = 600;
const SAVED_HINT_MS = 4000;
/** Tutmayı bırakmanın ödemeleri iptal edeceği bölünmüş ödeme durumları. */
const ACTIVE_SPLIT = new Set<string>(["COLLECTING", "FALLBACK"]);

type PendingKind = "update" | "remove";
/** Hata iletisinin yeri: kalem kimliği, "undo" (geri alma satırı) ya da sayfa başı (null). */
type CartMessage = { text: string; scope: string | null };
/** İşlem bitince odağın gideceği yer (kalem sırası/kimliği, geri alma düğmesi, boş sepet). */
type FocusTarget = { index: number; id?: string } | "undo" | "empty";
type RemovedItem = { item: CartItemDTO; index: number; currency: string };
type PatchResult = boolean | null;

/** İlan bağlantısı kalemin tarih, kişi ve oda seçimini taşır (ilan sayfası aynı teklifi açar). */
function itemHref(item: CartItemDTO): string {
  const href = propertyHref(item.propertyId, {
    checkIn: item.checkIn,
    checkOut: item.checkOut,
    guests: item.adults + item.children,
    roomId: item.roomTypeId,
    ratePlanId: item.ratePlanId,
  });
  return `${href}${href.includes("?") ? "&" : "?"}adults=${item.adults}&children=${item.children}`;
}

/** Grup sepeti (P1-1): kalemleri düzenle, toplamı gör, tek ödemeye geç. */
export default function CartPage() {
  const t = useTranslations("cart");
  const tc = useTranslations("common");
  const f = useFormat();
  const router = useRouter();
  const genericError = useErrorText();
  const { confirm, confirmDialog } = useConfirm();
  const { cart, setCart, loading, error, reload, restorable } = useCart();
  // Odaktaki kontrol `disabled` yapılmaz (odak <body>'ye düşer); meşgulken olaylar yok sayılır.
  const [busy, setBusy] = useState(false);
  // Aynı tıklamada (alan blur → kayıt → bağlantı) state henüz güncellenmemiş olabilir.
  const busyRef = useRef(false);
  const proceedAfterSave = useRef(false);
  const [pending, setPending] = useState<{ id: string; kind: PendingKind } | null>(null);
  const [message, setMessage] = useState<CartMessage | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [cleared, setCleared] = useState(false);
  const [reopenMissing, setReopenMissing] = useState(false);
  const [removed, setRemoved] = useState<RemovedItem | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [focusTick, setFocusTick] = useState(0);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [splitPlan, setSplitPlan] = useState<SplitPlanDTO | null>(null);
  // Kalemlerin bekleyen (gecikmeli) kayıtları; "Ödemeye geç" önce bunları kaydeder.
  const flushers = useRef(new Set<() => void>());
  const lockedNoticeId = useId();
  const nextStepsId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const emptyHeadingRef = useRef<HTMLHeadingElement>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  const undoTextId = useId();
  const focusAfter = useRef<FocusTarget | null>(null);

  const errorText = useCallback(
    (err: unknown, fallback?: string) => {
      if (err instanceof ApiError) {
        if (err.code && CART_ERROR_CODES.has(err.code)) return t(`errors.${err.code}`);
        if (!err.code) return fallback ?? t("updateFailed");
      }
      return genericError(err, fallback);
    },
    [t, genericError]
  );

  useEffect(() => {
    const target = focusAfter.current;
    if (target === null) return;
    focusAfter.current = null;
    if (target === "undo" && undoRef.current) {
      undoRef.current.focus();
      return;
    }
    const links = Array.from(
      listRef.current?.querySelectorAll<HTMLAnchorElement>("[data-item-link]") ?? []
    );
    if (typeof target === "object" && links.length > 0) {
      const byId = target.id ? links.find((l) => l.dataset.itemLink === target.id) : undefined;
      (byId ?? links[Math.min(target.index, links.length - 1)]).focus();
    } else emptyHeadingRef.current?.focus();
  }, [focusTick]);

  // Başlıktaki sepet rozeti gezinmeyi beklemeden sepetle eşitlenir (yükleme hatasında dokunulmaz).
  useEffect(() => {
    if (loading || (error && !cart)) return;
    setHeaderCartCount(cart?.items.length ?? 0);
  }, [cart, loading, error]);

  useEffect(() => {
    if (!savedId) return;
    const timer = setTimeout(() => setSavedId(null), SAVED_HINT_MS);
    return () => clearTimeout(timer);
  }, [savedId]);

  const registerFlush = useCallback((flush: () => void) => {
    flushers.current.add(flush);
    return () => {
      flushers.current.delete(flush);
    };
  }, []);

  const activeSplit =
    splitPlan && cart?.status === "HELD" && ACTIVE_SPLIT.has(splitPlan.status) ? splitPlan : null;

  /** `null`: başka bir işlem sürdüğü için başlatılmadı (çağıran sonra yeniden dener). */
  async function mutate(
    run: () => Promise<{ cart: CartDTO | null }>,
    announce: (next: CartDTO | null) => string,
    opts: { pending?: { id: string; kind: PendingKind }; scope?: string; fallback?: string } = {}
  ): Promise<PatchResult> {
    if (busyRef.current) return null;
    busyRef.current = true;
    setBusy(true);
    setPending(opts.pending ?? null);
    setMessage(null);
    setNotice(null);
    setSavedId(null);
    setAnnouncement("");
    try {
      const next = (await run()).cart;
      setCart(next);
      setAnnouncement(announce(next));
      setFocusTick((n) => n + 1);
      return true;
    } catch (err) {
      proceedAfterSave.current = false;
      setMessage({
        text: errorText(err, opts.fallback),
        scope: opts.scope ?? opts.pending?.id ?? null,
      });
      await reload();
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
      setPending(null);
      // Kayıt sürerken "Ödemeye geç"e basıldıysa bekleyen kayıtlar bitince güncel toplamla geçilir.
      if (proceedAfterSave.current) {
        for (const flush of flushers.current) flush();
        if (!busyRef.current) {
          proceedAfterSave.current = false;
          router.push("/checkout/cart");
        }
      }
    }
  }

  const totalText = (next: CartDTO | null) =>
    next ? f.money(next.totalMinor, next.currency) : f.money(0, cart?.currency ?? "TRY");

  const patch = (item: CartItemDTO, body: Record<string, number>) =>
    mutate(
      () => apiFetch(`/api/cart/items/${item.id}`, { method: "PATCH", body: JSON.stringify(body) }),
      (next) => {
        setSavedId(item.id);
        return t("announce.itemUpdated", { name: item.propertyTitle, total: totalText(next) });
      },
      { pending: { id: item.id, kind: "update" } }
    );
  const remove = (item: CartItemDTO, index: number, currency: string) =>
    mutate(
      () => apiFetch(`/api/cart/items/${item.id}`, { method: "DELETE" }),
      (next) => {
        // Kaldırılan satırın yerinde "Geri al" kalır; odak oradaki düğmeye taşınır.
        setRemoved({ item, index, currency });
        focusAfter.current = "undo";
        return t("announce.removed", { name: item.propertyTitle, total: totalText(next) });
      },
      { pending: { id: item.id, kind: "remove" } }
    );
  const undoRemove = (entry: RemovedItem) => {
    const { item } = entry;
    const before = new Set(cart?.items.map((i) => i.id) ?? []);
    return mutate(
      () =>
        apiFetch(`/api/cart/items`, {
          method: "POST",
          body: JSON.stringify({
            propertyId: item.propertyId,
            roomTypeId: item.roomTypeId,
            ...(item.ratePlanId ? { ratePlanId: item.ratePlanId } : {}),
            checkIn: item.checkIn,
            checkOut: item.checkOut,
            adults: item.adults,
            children: item.children,
            quantity: item.quantity,
            currency: entry.currency,
          }),
        }),
      (next) => {
        setRemoved(null);
        const added = next?.items.find((i) => !before.has(i.id));
        focusAfter.current = { index: entry.index, id: added?.id };
        return t("announce.restored", { name: item.propertyTitle, total: totalText(next) });
      },
      { scope: "undo", fallback: t("item.restoreFailed", { name: item.propertyTitle }) }
    );
  };
  const release = async (id: string) => {
    if (busyRef.current) return;
    // Bölünmüş ödeme sürüyorsa bırakmak yapılmış ödemeleri iptal eder; onay metni bunu söyler.
    const plan = activeSplit;
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
    await mutate(
      () => apiFetch(`/api/cart/${id}/release`, { method: "POST", body: "{}" }),
      () => {
        setRemoved(null);
        setSplitPlan(null);
        // Görünür bildirim kendi canlı bölgesinde okunur; ayrıca duyurulmaz (çift okuma olmasın).
        setNotice(plan ? t("releasedSplit") : t("released"));
        focusAfter.current = { index: 0 };
        return "";
      }
    );
  };
  const reopen = () =>
    mutate(
      () => apiFetch(`/api/cart/reopen`, { method: "POST", body: "{}" }),
      (next) => {
        if (next) {
          focusAfter.current = { index: 0 };
          return t("announce.reopened");
        }
        // Sunucu yalnız süresi dolmuş sepeti geri yükler; yoksa düğme kalkar ve nedeni yazılır.
        setReopenMissing(true);
        focusAfter.current = "empty";
        return t("reopenNone");
      }
    );
  const clear = async (id: string, held: boolean) => {
    if (busyRef.current) return;
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
        setRemoved(null);
        focusAfter.current = "empty";
        return t("announce.cleared");
      }
    );
    if (done) setCleared(true);
  };

  async function retryLoad() {
    if (retrying) return;
    setRetrying(true);
    focusAfter.current = { index: 0 };
    await reload();
    setRetrying(false);
    // Yeniden başarısız olursa uyarı yeniden bağlanır ve tekrar duyurulur.
    setLoadAttempt((n) => n + 1);
    setFocusTick((n) => n + 1);
  }

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

  // Yükleme hatası "boş sepet" gibi gösterilmez (sepet silinmiş sanılmasın).
  if (error && !cart) {
    return (
      <PageShell title={t("title")}>
        <section className="max-w-3xl rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <div key={loadAttempt} role="alert">
            <h2 className="text-lg font-semibold text-gray-900">{t("loadFailed")}</h2>
            <p className="mt-2 text-sm text-gray-600">{t("loadFailedHint")}</p>
          </div>
          <Button className="mt-4 min-h-[44px]" busy={retrying} onClick={() => void retryLoad()}>
            {tc("errorPage.retry")}
          </Button>
        </section>
      </PageShell>
    );
  }

  const locked = cart?.status === "HELD";
  const items = cart?.items ?? [];
  const messageInRow =
    message?.scope === "undo" ? removed !== null : items.some((i) => i.id === message?.scope);
  const topError = message && !messageInRow ? message.text : error ? t("loadFailed") : null;
  const undoAt = removed ? Math.min(removed.index, items.length) : -1;

  const undoRow = removed && (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-gray-300 bg-white px-5 py-3 text-sm text-gray-700">
      <p id={undoTextId}>{t("item.removedNotice", { name: removed.item.propertyTitle })}</p>
      <Button
        ref={undoRef}
        variant="secondary"
        busy={busy}
        aria-describedby={undoTextId}
        onClick={() => void undoRemove(removed)}
        className="min-h-[44px] sm:min-h-0"
      >
        {t("item.undo")}
      </Button>
      {message?.scope === "undo" && (
        <p role="alert" className="w-full font-medium text-red-700">
          {message.text}
        </p>
      )}
    </div>
  );

  return (
    <PageShell title={t("title")}>
      <div className="max-w-3xl">
        {liveRegion}
        <div
          role="status"
          className={
            notice
              ? "mt-4 rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700"
              : undefined
          }
        >
          {notice}
        </div>
        {topError && (
          <div role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            {topError}
          </div>
        )}

        {!cart || items.length === 0 ? (
          <>
            {undoRow && <div className="mt-6">{undoRow}</div>}
            <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-sm">
              <h2
                ref={emptyHeadingRef}
                tabIndex={-1}
                className="text-lg font-semibold text-gray-900 focus:outline-none"
              >
                {t("empty")}
              </h2>
              <p className="mt-2 text-sm text-gray-600">{t("emptyHint")}</p>
              {reopenMissing && <p className="mt-2 text-sm text-gray-700">{t("reopenNone")}</p>}
              <div className="mt-4 flex flex-wrap justify-center gap-3">
                <Link
                  href="/"
                  className="inline-flex min-h-[44px] items-center rounded-lg bg-[#003580] px-4 py-2 text-sm font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#003580] focus-visible:ring-offset-2"
                >
                  {t("browse")}
                </Link>
                {/* Yalnız sunucu geri yüklenebilir sepet bildirdiyse (elle boşaltılanda yok). */}
                {!cart && restorable && !cleared && !removed && !reopenMissing && (
                  <button
                    type="button"
                    onClick={() => void reopen()}
                    aria-disabled={busy || undefined}
                    aria-busy={busy || undefined}
                    className="min-h-[44px] rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#003580] focus-visible:ring-offset-2 aria-disabled:cursor-wait aria-disabled:opacity-60"
                  >
                    {t("reopen")}
                  </button>
                )}
              </div>
            </section>
          </>
        ) : (
          <>
            {locked && (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
                <span id={lockedNoticeId}>
                  {cart.holdExpiresAt
                    ? t(activeSplit ? "lockedNoticeSplit" : "lockedNoticeUntil", {
                        time: f.time(cart.holdExpiresAt),
                      })
                    : t("lockedNotice")}
                </span>
                <button
                  type="button"
                  onClick={() => void release(cart.id)}
                  aria-disabled={busy || undefined}
                  aria-busy={busy || undefined}
                  className="min-h-[44px] rounded-md border border-amber-700 px-3 py-1 font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-[#003580] aria-disabled:cursor-wait aria-disabled:opacity-60"
                >
                  {t("release")}
                </button>
              </div>
            )}
            <ul ref={listRef} className="mt-6 space-y-4" data-testid="cart-items">
              {items.map((item, index) => (
                <Fragment key={item.id}>
                  {undoAt === index && <li>{undoRow}</li>}
                  <CartItemRow
                    item={item}
                    currency={cart.currency}
                    locked={locked}
                    busy={busy}
                    pending={pending?.id === item.id ? pending.kind : null}
                    saved={savedId === item.id}
                    error={message?.scope === item.id ? message.text : null}
                    lockedNoticeId={locked ? lockedNoticeId : undefined}
                    registerFlush={registerFlush}
                    onPatch={patch}
                    onRemove={() => void remove(item, index, cart.currency)}
                  />
                </Fragment>
              ))}
              {undoAt === items.length && <li>{undoRow}</li>}
            </ul>

            {locked && (
              // P1-2: bölünmüş ödeme varsa pay durum listesi (plan checkout'ta kurulur).
              <SplitPayPanel
                cartId={cart.id}
                totalMinor={cart.totalMinor}
                currency={cart.currency}
                allowCreate={false}
                onPlan={setSplitPlan}
              />
            )}

            <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">{t("total")}</h2>
                <span className="text-xl font-bold text-gray-900" data-testid="cart-total">
                  {f.money(cart.totalMinor, cart.currency)}
                </span>
              </div>
              <p className="mt-2 text-xs text-gray-500">{t("totalNotice")}</p>
              <div className="mt-4 flex flex-wrap gap-3">
                <Link
                  href="/checkout/cart"
                  aria-disabled={busy || undefined}
                  aria-describedby={nextStepsId}
                  onClick={(e) => {
                    // Bekleyen değişiklikler önce kaydedilir.
                    for (const flush of flushers.current) flush();
                    if (!busyRef.current) return;
                    // Kayıt bitmeden eski toplamla ödemeye geçilmez; kayıt bitince geçilir.
                    e.preventDefault();
                    proceedAfterSave.current = true;
                  }}
                  className="flex-1 rounded-lg bg-[#003580] px-4 py-3 text-center text-sm font-semibold text-white hover:bg-[#002b66] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#003580] focus-visible:ring-offset-2 aria-disabled:cursor-wait aria-disabled:opacity-60"
                >
                  {t("proceed")}
                </Link>
                <button
                  type="button"
                  onClick={() => void clear(cart.id, locked)}
                  aria-disabled={busy || undefined}
                  className="rounded-lg border border-gray-300 px-4 py-3 text-sm font-semibold text-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#003580] focus-visible:ring-offset-2 aria-disabled:cursor-wait aria-disabled:opacity-60"
                >
                  {t("cancelCart")}
                </button>
              </div>
              <p id={nextStepsId} className="mt-2 text-xs text-gray-600">
                {t("checkout.nextStepsHint")}
              </p>
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
const serverKeyOf = (item: CartItemDTO) => `${item.adults}/${item.children}/${item.quantity}`;

/**
 * Tek sepet kalemi: kişi sayıları kontrollü alanlardır (ekrandaki değer sunucu değerinden
 * sessizce ayrışmaz). −/+ ve oda adedi değişiklikleri kısa beklemeyle tek istekte kaydedilir;
 * geçersiz giriş alan altında açıklanır ve kayıtlı değere geri döner.
 */
function CartItemRow({
  item,
  currency,
  locked,
  busy,
  pending,
  saved,
  error,
  lockedNoticeId,
  registerFlush,
  onPatch,
  onRemove,
}: {
  item: CartItemDTO;
  currency: string;
  locked: boolean;
  busy: boolean;
  /** Bu kalemde süren işlem (görünür "Güncelleniyor…/Kaldırılıyor…"). */
  pending: PendingKind | null;
  /** Bu kalem az önce kaydedildi (görünür kısa "Kaydedildi"). */
  saved: boolean;
  /** Bu kaleme ait sunucu hatası (sayfa başı yerine kalemin içinde gösterilir). */
  error: string | null;
  /** Sepet kilitliyken alanları açıklayan uyarının kimliği. */
  lockedNoticeId?: string;
  /** Bekleyen kaydı hemen yapan işlevi kaydeder (ödemeye geçmeden önce çağrılır). */
  registerFlush: (flush: () => void) => () => void;
  onPatch: (item: CartItemDTO, body: Record<string, number>) => Promise<PatchResult>;
  onRemove: () => void;
}) {
  const t = useTranslations("cart");
  const ts = useTranslations("search");
  const f = useFormat();
  const uid = useId();
  const [drafts, setDrafts] = useState<Drafts>(() => draftsOf(item));
  // Başka kalemin kaydı bu kalemin bekleyen taslağını silmesin: yalnız değer değişince eşitlenir.
  const [synced, setSynced] = useState<string | null>(() => serverKeyOf(item));
  const [errors, setErrors] = useState<Partial<Record<GuestField, string>>>({});
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<{ drafts: Drafts; commit: (next: Drafts) => Promise<void> } | null>(null);
  const errorId = `${uid}-error`;

  // Sunucu değeri değişince (kayıt, yeniden yükleme) ya da kayıt başarısız olunca taslak eşitlenir.
  if (synced !== serverKeyOf(item)) {
    setSynced(serverKeyOf(item));
    setDrafts(draftsOf(item));
  }

  function cancelTimer() {
    if (commitTimer.current) clearTimeout(commitTimer.current);
    commitTimer.current = null;
  }

  function schedule() {
    cancelTimer();
    commitTimer.current = setTimeout(() => {
      commitTimer.current = null;
      const l = latest.current;
      if (l) void l.commit(l.drafts);
    }, COMMIT_DELAY_MS);
  }

  /** Değişen kişi/oda sayılarını tek istekte kaydeder; geçersiz kişi sayısı eski değere döner. */
  async function commit(next: Drafts) {
    cancelTimer();
    if (locked) return;
    const body: Record<string, number> = {};
    const restored: Partial<Drafts> = {};
    const fieldErrors: Partial<Record<GuestField, string>> = {};
    for (const field of GUEST_FIELDS) {
      const raw = next[field].trim();
      const v = Number(raw);
      const { min, max } = GUEST_LIMITS[field];
      if (raw === "" || !Number.isInteger(v) || v < min || v > max) {
        fieldErrors[field] = t(field === "adults" ? "item.adultsRange" : "item.childrenRange", {
          min,
          max,
          saved: item[field],
        });
        restored[field] = String(item[field]);
      } else if (v !== item[field]) {
        body[field] = v;
      }
    }
    // Değişmeyen alanın önceki hata metni korunur; düzeltilen ya da yeni hatalı alan güncellenir.
    setErrors((e) => {
      const out = { ...e };
      for (const field of GUEST_FIELDS) {
        if (fieldErrors[field]) out[field] = fieldErrors[field];
        else if (field in body) out[field] = undefined;
      }
      return out;
    });
    if (restored.adults !== undefined || restored.children !== undefined) {
      setDrafts((d) => ({ ...d, ...restored }));
    }
    if (next.quantity !== item.quantity) body.quantity = next.quantity;
    if (Object.keys(body).length === 0) return;
    const ok = await onPatch(item, body);
    // Başka bir işlem sürüyorsa değişiklik kaybolmaz: kısa süre sonra yeniden denenir.
    if (ok === null) schedule();
    else if (!ok) setSynced(null);
  }

  useEffect(() => {
    latest.current = { drafts, commit };
  });

  useEffect(() => {
    return registerFlush(() => {
      if (!commitTimer.current) return;
      const l = latest.current;
      if (l) void l.commit(l.drafts);
    });
  }, [registerFlush]);

  useEffect(
    () => () => {
      if (commitTimer.current) clearTimeout(commitTimer.current);
    },
    []
  );

  const describedBy = [error ? errorId : null, lockedNoticeId].filter(Boolean).join(" ");

  const guestStepper = (field: GuestField) => (
    <GuestCountStepper
      id={`${uid}-${field}`}
      label={t(`item.${field}`)}
      value={drafts[field]}
      min={GUEST_LIMITS[field].min}
      max={GUEST_LIMITS[field].max}
      disabled={locked}
      busy={busy}
      error={errors[field]}
      describedBy={describedBy || undefined}
      decreaseLabel={ts(field === "adults" ? "bar.decreaseAdults" : "bar.decreaseChildren")}
      increaseLabel={ts(field === "adults" ? "bar.increaseAdults" : "bar.increaseChildren")}
      valueText={(n) => `${t(`item.${field}`)}: ${n}`}
      onChange={(value) => {
        // Yazım sürerken bekleyen kayıt yarım değeri göndermesin; kayıt alandan çıkınca yapılır.
        cancelTimer();
        setDrafts((d) => ({ ...d, [field]: value }));
      }}
      onStep={(n) => {
        setErrors((e) => ({ ...e, [field]: undefined }));
        setDrafts((d) => ({ ...d, [field]: String(n) }));
        schedule();
      }}
      onCommit={() => void commit(drafts)}
    />
  );

  return (
    <li
      className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"
      data-testid="cart-item"
      aria-busy={pending ? true : undefined}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id={`${uid}-title`} className="font-semibold text-gray-900">
            <Link
              href={itemHref(item)}
              data-item-link={item.id}
              className="underline decoration-1 underline-offset-2 hover:decoration-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#003580]"
            >
              {item.propertyTitle}
            </Link>
          </h2>
          <p id={`${uid}-room`} className="text-sm text-gray-600">
            {t("item.room")}: {item.roomTypeName}
            {item.city && (
              <>
                <span aria-hidden="true"> · </span>
                <span className="sr-only">, </span>
                {item.city}
              </>
            )}
          </p>
          <p id={`${uid}-dates`} className="text-sm text-gray-600">
            {t("item.dates")}: {f.date(item.checkIn, "medium")} <span aria-hidden="true">→</span>
            <span className="sr-only">{t("item.to")}</span> {f.date(item.checkOut, "medium")} (
            {t("item.nights", { count: item.nights })})
          </p>
        </div>
        <div className="text-right">
          <p className="text-lg font-semibold text-gray-900">
            {f.money(item.totalMinor, currency)}
          </p>
          {pending && (
            <p className="text-sm text-gray-600">
              {pending === "remove" ? t("item.removing") : t("item.updating")}
            </p>
          )}
          {!pending && saved && <p className="text-sm text-gray-600">{t("item.saved")}</p>}
        </div>
      </div>
      {/* Tekrarlanan "Yetişkin/Çocuk/Oda adedi" alanları kalem adı, oda ve tarihle gruplanır. */}
      <div
        role="group"
        aria-labelledby={`${uid}-title ${uid}-room ${uid}-dates`}
        className="mt-3 flex flex-wrap items-start gap-4 text-sm text-gray-700"
      >
        {guestStepper("adults")}
        {guestStepper("children")}
        <div>
          <label htmlFor={`${uid}-quantity`}>{t("item.quantity")}</label>
          <select
            id={`${uid}-quantity`}
            className={select}
            value={drafts.quantity}
            disabled={locked}
            aria-disabled={busy || undefined}
            aria-describedby={describedBy || undefined}
            onChange={(e) => {
              if (busy) return;
              setDrafts((d) => ({ ...d, quantity: Number(e.target.value) }));
              // Ok tuşlarıyla gezinirken her adımda istek atılmaz: kısa bekleme ya da odak çıkışı.
              schedule();
            }}
            onBlur={() => {
              if (commitTimer.current) void commit(drafts);
            }}
          >
            {ROOM_OPTIONS.map((n) => (
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
          aria-describedby={lockedNoticeId}
          aria-label={t("item.removeLabel", { name: item.propertyTitle })}
          className="ml-auto mt-6 min-h-[44px] rounded-md px-3 py-1 text-sm font-semibold text-red-700 hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#003580] disabled:cursor-not-allowed disabled:text-gray-400 aria-disabled:cursor-wait aria-disabled:opacity-60"
        >
          {t("item.remove")}
        </button>
      </div>
      {error && (
        <p
          id={errorId}
          role="alert"
          className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </p>
      )}
    </li>
  );
}
