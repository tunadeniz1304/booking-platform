"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ApiError, apiFetch, fetchCurrentUser, isTimeoutError } from "@/lib/api-client";
import { useFormat } from "@/i18n/use-format";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { useCart, type CartDTO, type CartItemDTO } from "@/components/cart/useCart";
import { SplitPayPanel, type SplitLoadState } from "@/components/cart/SplitPayPanel";
import {
  CardFields,
  tokenizeCardFields,
  type CardField,
  type CardFieldErrors,
} from "@/components/payment/CardFields";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { ThreeDsForm } from "@/components/payment/ThreeDsForm";
import { Button, ErrorText, focusFirstInvalid, useErrorText } from "@/components/ui/ui";
import type { SplitPlanDTO } from "@/lib/cart/split-payment";

type PayOutcome =
  | { status: "confirmed"; cartId: string; bookingIds: string[]; amount: number; currency: string }
  | { status: "requires_action"; cartId: string; challenge?: { hint?: string } }
  | { status: "pending_confirmation"; cartId: string };

type Step =
  "loading" | "done" | "none" | "hold" | "challenge" | "pending" | "expired" | "split" | "pay";

/** Başarı ekranı: `card` tek ödeme, `split` bölüşme, `restored` kalıcı adresten (`?paid=`). */
type DoneState = {
  outcome: PayOutcome & { status: "confirmed" };
  cart: CartDTO;
  via: "card" | "split" | "restored";
};

/** 409 PRICE_CHANGED ayrıntısı (sepet biriminde minor tutarlar). */
type PriceChange = { itemId: string; previousTotal: number; currentTotal: number };

/** Bölüşme panelinin sayfa içi bağlantı hedefi. */
const SPLIT_ANCHOR = "cart-split-pay";
/** E-posta doğrulama uyarısı ("Odaları tut" düğmesinin açıklaması). */
const VERIFY_ID = "cart-verify-email";

/** Birincil düğmenin pasif / meşgul görünümü (mevcut gri renkler korunur). */
const PRIMARY_DISABLED =
  "aria-disabled:bg-gray-300 aria-disabled:text-gray-700 aria-disabled:opacity-100";

/** Görsel ayraç: ekran okuyucu "orta nokta" yerine kısa bir duraklama (virgül) duyar. */
function Sep() {
  return (
    <>
      <span aria-hidden="true"> · </span>
      <span className="sr-only">, </span>
    </>
  );
}

/** Ret yanıtındaki kalan deneme hakkı (sunucu `details.attemptsLeft` gönderirse). */
function attemptsLeftOf(err: unknown): number | null {
  if (!(err instanceof ApiError) || !err.details || typeof err.details !== "object") return null;
  const left = (err.details as { attemptsLeft?: unknown }).attemptsLeft;
  return typeof left === "number" && left > 0 ? left : null;
}

/** Üst ve alt bilgi çerçevesi (tek oda checkout'uyla aynı gezinme). */
function CartCheckoutFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      {children}
      <Footer />
    </div>
  );
}

function doneFrom(cart: CartDTO, via: DoneState["via"]): DoneState {
  return {
    outcome: {
      status: "confirmed",
      cartId: cart.id,
      bookingIds: cart.items.flatMap((i) => (i.bookingId ? [i.bookingId] : [])),
      amount: cart.totalMinor,
      currency: cart.currency,
    },
    cart,
    via,
  };
}

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
  const tc = useTranslations("checkout");
  const tcommon = useTranslations("common");
  const f = useFormat();
  const errText = useErrorText();
  const { confirm, confirmDialog } = useConfirm();
  const formIds = useId();
  const { cart, setCart, loading, error, reload } = useCart();
  const [busy, setBusy] = useState(false);
  // Sepet yüklenemediğinde yeniden deneme; başarısız denemede uyarı yeniden duyurulur.
  const [retrying, setRetrying] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [holdKey, setHoldKey] = useState(newKey);
  const [payKey, setPayKey] = useState(newKey);
  const [card, setCard] = useState({ number: "", exp: "", cvc: "" });
  const [cardErrors, setCardErrors] = useState<CardFieldErrors>({});
  // Tutma hatasında sorunlu kalemler: müsait olmayan oda ve fiyatı değişen odalar.
  const [unavailableId, setUnavailableId] = useState<string | null>(null);
  const [priceChanges, setPriceChanges] = useState<Record<string, PriceChange>>({});
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [splitPlan, setSplitPlan] = useState<SplitPlanDTO | null>(null);
  // Bölüşme planı okunana dek tek ödeme formu gösterilmez (var olan plan üstüne çift ödeme yok).
  const [splitLoad, setSplitLoad] = useState<SplitLoadState>("loading");
  // Çok fazla başarısız kart denemesi: tek ödeme formu kapanır (bölüşme ve bırakma açık kalır).
  const [payLocked, setPayLocked] = useState(false);
  const [pendingCartId, setPendingCartId] = useState<string | null>(null);
  const [pendingTimedOut, setPendingTimedOut] = useState(false);
  const [expired, setExpired] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [done, setDone] = useState<DoneState | null>(null);
  // `?paid=<sepet>` adresinden başarı ekranı geri yükleniyor (yenileme / geri dönüş).
  const [restoring, setRestoring] = useState(true);
  // Ödeme yolu seçimi: tamamını tek kartla öde ya da grupla bölüş (biri gösterilir).
  const [payMethod, setPayMethod] = useState<"card" | "split">("card");
  // Doğrulanmamış e-postada tutma ve bölüşme sunucuda reddedilir; eylemden önce söylenir.
  const [emailUnverified, setEmailUnverified] = useState(false);
  const [resending, setResending] = useState(false);

  const titleRef = useRef<HTMLHeadingElement>(null);
  const payHeadingRef = useRef<HTMLHeadingElement>(null);
  const challengeHeadingRef = useRef<HTMLHeadingElement>(null);
  const doneHeadingRef = useRef<HTMLHeadingElement>(null);
  const statusBoxRef = useRef<HTMLDivElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const heldInfoRef = useRef<HTMLParagraphElement>(null);
  const verifyRef = useRef<HTMLDivElement>(null);
  const noCartRef = useRef<HTMLParagraphElement>(null);
  const payFormRef = useRef<HTMLFormElement>(null);
  const holdButtonRef = useRef<HTMLButtonElement>(null);
  const unavailableNoteRef = useRef<HTMLParagraphElement>(null);
  const focusAfterBusy = useRef<"hold" | "unavailable" | "alert" | "verify" | null>(null);
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

  const step: Step =
    loading || restoring
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

  // Panel bağlı değilken (başka adım) okuma durumu sıfırlanır; yeniden bağlanınca eski "ready" ile
  // form bir an görünüp kalkmasın (odak kaybolmasın).
  const splitMounted = held && (step === "pay" || step === "split");
  if (!splitMounted && splitLoad !== "loading") setSplitLoad("loading");

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
          ? prev === "hold"
            ? (heldInfoRef.current ?? payHeadingRef.current)
            : (payHeadingRef.current ?? heldInfoRef.current)
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

  // İşlem bitince odak kaybolmasın: hata kutusuna, sorunlu odanın notuna, doğrulama kutusuna
  // ya da "Odaları tut"a.
  useEffect(() => {
    if (busy || !focusAfterBusy.current) return;
    const next = focusAfterBusy.current;
    const target =
      next === "unavailable"
        ? unavailableNoteRef.current
        : next === "alert"
          ? alertRef.current
          : next === "verify"
            ? verifyRef.current
            : null;
    focusAfterBusy.current = null;
    (target ?? holdButtonRef.current)?.focus();
  }, [busy]);

  // Oturumdaki e-posta doğrulanmamışsa "Odaları tut"tan önce uyarı gösterilir.
  useEffect(() => {
    let active = true;
    fetchCurrentUser()
      .then((user) => {
        if (active && user && !user.emailVerified) setEmailUnverified(true);
      })
      .catch(() => {
        // oturum bilgisi alınamadı: sunucu tutmada yine denetler
      });
    return () => {
      active = false;
    };
  }, []);

  // Kalıcı başarı adresi: `?paid=<sepet>` ödenmiş (CHECKED_OUT) sepeti yeniden gösterir.
  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      const paid = new URLSearchParams(window.location.search).get("paid");
      if (paid) {
        try {
          const res = await apiFetch<{ cart: CartDTO }>(`/api/cart/${encodeURIComponent(paid)}`, {
            cache: "no-store",
          });
          if (!active) return;
          if (res.cart.status === "CHECKED_OUT") setDone(doneFrom(res.cart, "restored"));
          else window.history.replaceState(null, "", window.location.pathname);
        } catch {
          if (active) window.history.replaceState(null, "", window.location.pathname);
        }
      }
      if (active) setRestoring(false);
    }, 0);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, []);

  // Başarı ekranı adrese yazılır; yenilemede ya da geri gelişte aynı ekran açılır.
  const doneCartId = done?.outcome.cartId ?? null;
  useEffect(() => {
    if (!doneCartId) return;
    const url = `${window.location.pathname}?paid=${encodeURIComponent(doneCartId)}`;
    if (`${window.location.pathname}${window.location.search}` !== url) {
      window.history.replaceState(null, "", url);
    }
  }, [doneCartId]);

  // Bölünmüş ödemede tüm paylar gelip plan tamamlanınca organizatöre başarı ekranı gösterilir.
  const settledCartId = splitPlan?.status === "SETTLED" && !done ? splitPlan.cartId : null;
  useEffect(() => {
    if (!settledCartId) return;
    let active = true;
    apiFetch<{ cart: CartDTO }>(`/api/cart/${settledCartId}`, { cache: "no-store" })
      .then((res) => {
        if (active && res.cart.status === "CHECKED_OUT") setDone(doneFrom(res.cart, "split"));
      })
      .catch(() => {
        // panel plan durumunu gösterir; rezervasyonlar Seyahatlerim'de
      });
    return () => {
      active = false;
    };
  }, [settledCartId]);

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
          setDone(doneFrom(res.cart, "card"));
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

  const itemName = (item: CartItemDTO) => `${item.propertyTitle} · ${item.roomTypeName}`;
  const itemDates = (item: CartItemDTO) =>
    `${f.date(item.checkIn, "medium")} – ${f.date(item.checkOut, "medium")}`;

  /** Tutma hatası iletisi; müsait olmayan / fiyatı değişen kalemleri satırda işaretler. */
  function holdError(err: unknown): string {
    if (!(err instanceof ApiError)) return apiText(err, t("checkout.holdFailed"));
    const details = err.details as { itemId?: string; items?: PriceChange[] } | undefined;
    if (err.code === "PRICE_CHANGED") {
      const list = details?.items;
      const changes = Array.isArray(list) ? list : [];
      setPriceChanges(Object.fromEntries(changes.map((c) => [c.itemId, c])));
      if (!cart || changes.length === 0) return t("checkout.priceChanged");
      const diff = changes.reduce((sum, c) => sum + c.currentTotal - c.previousTotal, 0);
      return t("checkout.priceChangedTotal", {
        previous: f.money(cart.totalMinor, cart.currency),
        current: f.money(cart.totalMinor + diff, cart.currency),
      });
    }
    if (err.status === 409 && details?.itemId) {
      const item = cart?.items.find((i) => i.id === details.itemId);
      if (!item) return t("checkout.itemUnavailable");
      setUnavailableId(item.id);
      focusAfterBusy.current = "unavailable";
      return t("checkout.itemUnavailableNamed", { name: itemName(item), dates: itemDates(item) });
    }
    return apiText(err, t("checkout.holdFailed"));
  }

  async function hold() {
    if (!cart || busy) return;
    if (emailUnverified) {
      verifyRef.current?.focus();
      return;
    }
    setBusy(true);
    setMessage(null);
    setNotice(null);
    setUnavailableId(null);
    setPriceChanges({});
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
      if (err instanceof ApiError && err.code === "EMAIL_NOT_VERIFIED") {
        setEmailUnverified(true);
        focusAfterBusy.current = "verify";
      } else {
        focusAfterBusy.current = "alert";
        setMessage(holdError(err));
      }
      await reload();
    } finally {
      setBusy(false);
    }
  }

  /** Müsait olmayan odayı sepetten çıkarır; diğer odalar yeniden tutulabilir. */
  async function removeItem(item: CartItemDTO) {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    setNotice(null);
    try {
      const res = await apiFetch<{ cart: CartDTO }>(`/api/cart/items/${item.id}`, {
        method: "DELETE",
      });
      setCart(res.cart);
      setUnavailableId(null);
      // Kalemler değişti: yeni tutma isteği yeni bir Idempotency-Key ile gönderilir.
      setHoldKey(newKey());
      setNotice(
        t("announce.removed", {
          name: itemName(item),
          total: f.money(res.cart.totalMinor, res.cart.currency),
        })
      );
      focusAfterBusy.current = "hold";
    } catch (err) {
      focusAfterBusy.current = "alert";
      setMessage(apiText(err, t("updateFailed")));
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function finish(outcome: PayOutcome) {
    if (outcome.status === "requires_action") {
      setChallenge(outcome.challenge?.hint ?? tp("verificationRequired"));
      setNotice(tp("threeDsAnnounce"));
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
    if (doneCart) setDone({ outcome, cart: doneCart, via: "card" });
  }

  async function payFailed(err: unknown) {
    const errCode = err instanceof ApiError ? err.code : undefined;
    let text: string;
    if (errCode === "PAYMENT_DECLINED") {
      text = t("checkout.declined");
    } else if (errCode === "HOLD_EXPIRED") {
      text = t("checkout.expired");
      setExpired(true);
    } else if (errCode === "PAYMENT_ATTEMPTS_EXCEEDED") {
      text = tp("errors.PAYMENT_ATTEMPTS_EXCEEDED");
      setPayLocked(true);
    } else {
      text = apiText(err, tp("failed"));
    }
    const left = attemptsLeftOf(err);
    setMessage(left === null ? text : `${text} ${tp("attempts.left", { count: left })}`);
    focusAfterBusy.current = "alert";
    setNotice(null);
    setChallenge(null);
    setCode("");
    setPayKey(newKey());
    await reload();
  }

  /**
   * Zaman aşımı (F401): ödeme sunucuda tamamlanmış olabilir. Idempotency-Key korunur (yeniden
   * deneme iki kez tahsil etmez), bilgi notu gösterilir ve sepetin son hâli okunur.
   */
  async function payTimedOut(cartId: string) {
    setMessage(null);
    setNotice(t("checkout.timeoutCheck"));
    try {
      const res = await apiFetch<{ cart: CartDTO }>(`/api/cart/${cartId}`, { cache: "no-store" });
      if (res.cart.status === "CHECKED_OUT") {
        setNotice(null);
        setChallenge(null);
        setDone(doneFrom(res.cart, "card"));
      } else {
        setCart(res.cart);
      }
    } catch {
      // okunamadı: not kalır; aynı anahtarla yeniden denemek güvenli
    }
  }

  /** 3DS adımından çıkış: kod gelmediyse ya da kart yanlışsa başka kartla yeniden denenir. */
  function backToCard() {
    if (busy) return;
    setChallenge(null);
    setCode("");
    setMessage(null);
    setNotice(null);
    setPayMethod("card");
    setPayKey(newKey());
  }

  async function resendVerification() {
    if (resending) return;
    setResending(true);
    setMessage(null);
    setNotice(null);
    try {
      const res = await apiFetch<{ sent?: boolean; alreadyVerified?: boolean }>(
        "/api/auth/verify-email/resend",
        { method: "POST", body: "{}" }
      );
      if (res.alreadyVerified) {
        // Kutu kalkmadan odak "Odaları tut"a taşınır (odak body'ye düşmesin).
        holdButtonRef.current?.focus();
        setEmailUnverified(false);
      }
      setNotice(
        res.alreadyVerified ? t("split.share.alreadyVerified") : t("split.share.resendSent")
      );
    } catch {
      setMessage(t("split.share.resendFailed"));
    } finally {
      setResending(false);
    }
  }

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    if (!cart || busy) return;
    setMessage(null);
    setNotice(null);
    // Hata ilgili alanın altında gösterilir (aria-invalid + aria-describedby), odak oraya taşınır.
    const result = tokenizeCardFields(card);
    if (!result.ok) {
      if (result.field) {
        setCardErrors({ [result.field]: tp(result.messageKey) });
        focusFirstInvalid(payFormRef.current);
      } else {
        setCardErrors({});
        setMessage(tp(result.messageKey));
      }
      return;
    }
    const { cardToken } = result;
    setCardErrors({});
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
      if (isTimeoutError(err)) await payTimedOut(cart.id);
      else await payFailed(err);
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
      if (isTimeoutError(err)) await payTimedOut(cart.id);
      else await payFailed(err);
    } finally {
      setBusy(false);
    }
  }

  async function retryLoad() {
    if (retrying) return;
    setRetrying(true);
    await reload();
    setRetrying(false);
    setLoadAttempt((n) => n + 1);
    // Yeniden deneme düğmesi kalktıysa (sepet yüklendi) odak body'ye düşmesin.
    requestAnimationFrame(() => {
      const active = document.activeElement;
      if (!active || active === document.body) (noCartRef.current ?? titleRef.current)?.focus();
    });
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
      setChallenge(null);
      setCode("");
      setPayKey(newKey());
      setNotice(plan ? t("releasedSplit") : t("released"));
    } catch (err) {
      focusAfterBusy.current = "alert";
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
      focusAfterBusy.current = "alert";
      setMessage(apiText(err, t("updateFailed")));
    } finally {
      setBusy(false);
    }
  }

  // Hata (role=alert) ve bilgi (role=status) ayrı bölgelerde; iç içe canlı bölge yok.
  const statusRegion = (
    <>
      {/* F2-44: odak kabı ref/tabIndex taşır; metin ortak ErrorText ile. */}
      {message && (
        <div ref={alertRef} tabIndex={-1} className="mt-4 focus:outline-none">
          <ErrorText>{message}</ErrorText>
        </div>
      )}
      <div role="status" className={notice ? "mt-4 text-sm text-gray-700" : undefined}>
        {notice}
      </div>
    </>
  );

  // Adım göstergesi: 1) odaları tut (ücret alınmaz), 2) öde (tek kart ya da bölüşme), 3) onay.
  const steps = [t("checkout.hold"), tp("title"), t("checkout.stepConfirm")];
  const stepIndicator = (currentStep: number) => (
    <ol aria-label={t("checkout.stepsLabel")} className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
      {steps.map((label, i) => {
        const current = currentStep === i + 1;
        return (
          <li
            key={label}
            aria-current={current ? "step" : undefined}
            className={`flex items-center gap-2 text-sm ${current ? "font-semibold text-gray-900" : "text-gray-600"}`}
          >
            <span
              aria-hidden="true"
              className={`inline-flex h-6 w-6 items-center justify-center rounded-full ${current ? "border-2 border-current" : "border border-gray-300"}`}
            >
              {i + 1}
            </span>
            {label}
          </li>
        );
      })}
    </ol>
  );

  if (step === "loading") {
    return (
      <CartCheckoutFrame>
        <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
          <h1 className="text-2xl font-bold text-gray-900">{t("checkout.title")}</h1>
          <p role="status" className="mt-4 text-gray-500">
            {t("loading")}
          </p>
        </main>
      </CartCheckoutFrame>
    );
  }

  if (done) {
    // Sepet okunamadıysa (eski görüntü) rezervasyon bağlantıları ödeme sonucundan üretilir.
    const linked = new Set(done.cart.items.flatMap((i) => (i.bookingId ? [i.bookingId] : [])));
    const unlinked = done.outcome.bookingIds.filter((id) => !linked.has(id));
    const amount = f.money(done.outcome.amount, done.outcome.currency);
    return (
      <CartCheckoutFrame>
        <main
          id="main"
          className="mx-auto w-full max-w-3xl flex-1 px-4 py-8"
          data-testid="cart-success"
        >
          <h1
            ref={doneHeadingRef}
            tabIndex={-1}
            className="text-2xl font-bold text-green-700 focus:outline-none"
          >
            {t("checkout.success")}
          </h1>
          {stepIndicator(3)}
          <p className="mt-2 text-gray-700">
            {done.via === "split"
              ? t("checkout.successSplitHint", { amount })
              : done.via === "restored"
                ? t("checkout.successPaidHint", { amount })
                : t("checkout.successHint", { amount })}
          </p>
          <ul className="mt-6 space-y-3">
            {done.cart.items.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white p-4"
              >
                <span id={`done-${item.id}`} className="text-sm text-gray-800">
                  {item.propertyTitle}
                  <Sep />
                  {item.roomTypeName}
                  <Sep />
                  {itemDates(item)}
                </span>
                {item.bookingId && (
                  <Link
                    href={`/booking/${item.bookingId}`}
                    aria-describedby={`done-${item.id}`}
                    className="text-sm font-semibold text-primary-600 hover:underline"
                  >
                    {t("checkout.viewBooking")}
                  </Link>
                )}
              </li>
            ))}
            {unlinked.map((id) => (
              <li key={id} className="rounded-xl border border-gray-200 bg-white p-4">
                <Link
                  href={`/booking/${id}`}
                  className="text-sm font-semibold text-primary-600 hover:underline"
                >
                  {t("checkout.viewBooking")}
                </Link>
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
      </CartCheckoutFrame>
    );
  }

  if (!cart || cart.items.length === 0) {
    // Yükleme hatası "ödenecek sepet yok" gibi gösterilmez (sepet silinmiş sanılmasın).
    const loadFailed = !!error && !cart;
    return (
      <CartCheckoutFrame>
        <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 text-center">
          <h1
            ref={titleRef}
            tabIndex={-1}
            className="text-2xl font-bold text-gray-900 focus:outline-none"
          >
            {t("checkout.title")}
          </h1>
          {loadFailed ? (
            <>
              <div key={loadAttempt} role="alert" className="mt-4">
                <h2 className="text-lg font-semibold text-gray-900">{t("loadFailed")}</h2>
                <p className="mt-2 text-sm text-gray-600">{t("loadFailedHint")}</p>
              </div>
              <Button
                className="mt-4 min-h-[44px]"
                busy={retrying}
                onClick={() => void retryLoad()}
              >
                {tcommon("errorPage.retry")}
              </Button>
            </>
          ) : (
            <p ref={noCartRef} tabIndex={-1} className="mt-4 text-gray-700 focus:outline-none">
              {expired ? t("checkout.expiredNoCart") : t("checkout.noCart")}
            </p>
          )}
          {statusRegion}
          {expired && (
            <button
              type="button"
              onClick={reopen}
              aria-disabled={busy || undefined}
              aria-busy={busy || undefined}
              className="mt-4 min-h-[44px] rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-800"
            >
              {t("reopen")}
            </button>
          )}
          <div>
            <Link
              href="/cart"
              className="mt-4 inline-flex min-h-[44px] items-center text-primary-600 hover:underline"
            >
              {t("checkout.backToCart")}
            </Link>
          </div>
          {/* Ödenmiş sepet artık aktif değil: rezervasyonlara giden yol gösterilir. */}
          {!loadFailed && (
            <>
              <p className="mt-6 text-sm text-gray-600">{t("checkout.noCartPaidHint")}</p>
              <Link href="/trips" className="mt-2 inline-block text-primary-600 hover:underline">
                {t("checkout.trips")}
              </Link>
            </>
          )}
          {confirmDialog}
        </main>
      </CartCheckoutFrame>
    );
  }

  const remainingMinutes =
    holdExpiresMs !== null ? Math.max(0, Math.ceil((holdExpiresMs - now) / 60000)) : null;
  const currentStep = step === "pending" ? 3 : held && !holdExpired ? 2 : 1;
  const row = "flex justify-between gap-4";
  const dt = "text-gray-600";
  const dd = "text-right font-medium text-gray-900";

  return (
    <CartCheckoutFrame>
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <h1
          ref={titleRef}
          tabIndex={-1}
          className="text-2xl font-bold text-gray-900 focus:outline-none"
        >
          {t("checkout.title")}
        </h1>
        {stepIndicator(currentStep)}

        <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">{t("checkout.summary")}</h2>
          <ul className="mt-4 divide-y divide-gray-100 text-sm">
            {cart.items.map((item) => {
              const unavailable = item.id === unavailableId;
              const change = priceChanges[item.id];
              return (
                <li key={item.id} className="py-3">
                  <dl className="space-y-1">
                    <div className={row}>
                      <dt className={dt}>{tc("stay")}</dt>
                      <dd id={`item-${item.id}-title`} className={dd}>
                        {item.propertyTitle}
                      </dd>
                    </div>
                    <div className={row}>
                      <dt className={dt}>{tc("room")}</dt>
                      <dd className={dd}>
                        {item.roomTypeName}
                        <Sep />
                        {t("checkout.roomCount", { count: item.quantity })}
                      </dd>
                    </div>
                    <div className={row}>
                      <dt className={dt}>{tc("dates")}</dt>
                      <dd className={dd}>
                        {itemDates(item)}
                        <span className="block font-normal text-gray-600">
                          {tc("nights", { count: item.nights })}
                        </span>
                      </dd>
                    </div>
                    <div className={row}>
                      <dt className={dt}>{tc("guests")}</dt>
                      <dd className={dd}>
                        {t("checkout.guestsValue", {
                          adults: item.adults,
                          children: item.children,
                        })}
                      </dd>
                    </div>
                    <div className={row}>
                      <dt className={dt}>{t("checkout.itemTotal")}</dt>
                      <dd className={dd}>{f.money(item.totalMinor, cart.currency)}</dd>
                    </div>
                  </dl>
                  {change && (
                    <p className="mt-2 text-sm font-medium text-amber-700">
                      <span aria-hidden="true">{"⚠︎"} </span>
                      {t("checkout.itemPriceChanged", {
                        previous: f.money(change.previousTotal, cart.currency),
                        current: f.money(change.currentTotal, cart.currency),
                      })}
                    </p>
                  )}
                  {unavailable && !held && (
                    <div className="mt-2">
                      <p
                        ref={unavailableNoteRef}
                        tabIndex={-1}
                        className="text-sm font-medium text-red-700 focus:outline-none"
                      >
                        <span aria-hidden="true">{"⚠︎"} </span>
                        {t("checkout.itemUnavailableRow")}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          onClick={() => removeItem(item)}
                          aria-disabled={busy || undefined}
                          aria-label={t("item.removeLabel", { name: itemName(item) })}
                          className="min-h-[44px] rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-800"
                        >
                          {t("item.remove")}
                        </button>
                        <Link
                          href={`/property/${item.propertyId}`}
                          aria-describedby={`item-${item.id}-title`}
                          className="inline-flex min-h-[44px] items-center text-sm text-primary-600 hover:underline"
                        >
                          {tc("changeDates")}
                        </Link>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
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
            <p className="mt-1 text-sm text-gray-600">{t("checkout.nextStepsHint")}</p>
            {emailUnverified && (
              <div
                ref={verifyRef}
                tabIndex={-1}
                className="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800 focus:outline-none"
              >
                <p id={VERIFY_ID}>{t("checkout.verifyEmailFirst")}</p>
                <div className="mt-2 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => void resendVerification()}
                    aria-disabled={resending || undefined}
                    aria-busy={resending || undefined}
                    className="min-h-[44px] rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-800"
                  >
                    {resending ? t("split.share.resendSending") : t("split.share.resendVerify")}
                  </button>
                  <button
                    type="button"
                    onClick={() => window.location.reload()}
                    className="min-h-[44px] rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-800"
                  >
                    {t("split.share.refresh")}
                  </button>
                </div>
              </div>
            )}
            <Button
              ref={holdButtonRef}
              onClick={hold}
              busy={busy}
              aria-disabled={emailUnverified || undefined}
              aria-describedby={emailUnverified ? VERIFY_ID : undefined}
              data-testid="cart-hold"
              size="lg"
              fullWidth
              className={`mt-3 ${PRIMARY_DISABLED}`}
            >
              {busy ? t("checkout.holding") : t("checkout.hold")}
            </Button>
            <Link
              href="/cart"
              className="mt-3 inline-flex min-h-[44px] items-center text-sm text-primary-600 hover:underline"
            >
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
            <Button
              onClick={recoverExpired}
              busy={busy}
              size="lg"
              fullWidth
              className={`mt-3 ${PRIMARY_DISABLED}`}
            >
              {t("checkout.reholdButton")}
            </Button>
          </div>
        )}

        {held && cart.holdExpiresAt && (step === "pay" || step === "split") && (
          <p
            ref={heldInfoRef}
            tabIndex={-1}
            className="mt-6 text-sm text-amber-700 focus:outline-none"
          >
            <span>{t("checkout.heldUntil", { time: f.time(cart.holdExpiresAt) })}</span>{" "}
            {remainingMinutes !== null && (
              <span role="timer" className="font-semibold">
                {t("checkout.remaining", { minutes: remainingMinutes })}
              </span>
            )}
          </p>
        )}

        {/* İki ödeme yolu birbirini dışlar: önce yol seçilir, yalnız seçilen form gösterilir. */}
        {step === "pay" && splitLoad === "ready" && (
          <fieldset className="mt-4">
            <legend className="text-sm font-semibold text-gray-900">
              {t("checkout.payMethodLegend")}
            </legend>
            <div className="mt-2 flex flex-col gap-x-6 sm:flex-row">
              {(["card", "split"] as const).map((method) => (
                <label
                  key={method}
                  className="flex min-h-[44px] cursor-pointer items-center gap-2 text-sm text-gray-800"
                >
                  <input
                    type="radio"
                    name="cart-pay-method"
                    value={method}
                    checked={payMethod === method}
                    onChange={() => setPayMethod(method)}
                    className="h-4 w-4"
                  />
                  {method === "card" ? t("checkout.payMethodCard") : t("checkout.payMethodSplit")}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {step === "pay" && payMethod === "card" && splitLoad === "ready" && !payLocked && (
          <form
            ref={payFormRef}
            onSubmit={pay}
            className="mt-3 space-y-3 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"
            aria-labelledby={`${formIds}-pay-title`}
            aria-busy={busy}
          >
            <h2
              id={`${formIds}-pay-title`}
              ref={payHeadingRef}
              tabIndex={-1}
              className="text-lg font-semibold text-gray-900 focus:outline-none"
            >
              {tp("title")}
            </h2>
            <CardFields
              idPrefix="cart-card"
              values={card}
              onChange={(field: CardField, value: string) => {
                setCard((c) => ({ ...c, [field]: value }));
                setCardErrors((errs) => (errs[field] ? { ...errs, [field]: null } : errs));
              }}
              errors={cardErrors}
              disabled={busy}
              showTestCards
            />
            <Button
              type="submit"
              busy={busy}
              data-testid="cart-pay"
              size="lg"
              fullWidth
              className={PRIMARY_DISABLED}
            >
              {busy ? (
                tp("processing")
              ) : (
                // Tek satır içi öğe: flex düğmede ayracın boşlukları kırpılmasın.
                <span>
                  {tp("payAndConfirm")}
                  <Sep />
                  {f.money(cart.totalMinor, cart.currency)}
                </span>
              )}
            </Button>
          </form>
        )}

        {/* Kart seçiliyken de bağlı (gizli) kalır: var olan bölüşme planı yüklenebilsin. Plan
            okunana dek (yükleniyor / hata) panel görünür, tek ödeme formu gösterilmez. */}
        {held && (step === "pay" || step === "split") && (
          <div
            id={SPLIT_ANCHOR}
            tabIndex={-1}
            hidden={step === "pay" && payMethod !== "split" && splitLoad === "ready"}
            className="scroll-mt-4 focus:outline-none"
          >
            <SplitPayPanel
              cartId={cart.id}
              totalMinor={cart.totalMinor}
              currency={cart.currency}
              allowCreate
              onLoadState={setSplitLoad}
              onPlan={(plan) => {
                setSplitPlan(plan);
                // Plan iptal edilirse panel (iptal özeti) görünür kalsın.
                if (plan && plan.status !== "ABORTED") setPayMethod("split");
              }}
            />
          </div>
        )}

        {step === "challenge" && (
          <ThreeDsForm
            idPrefix="cart"
            headingRef={challengeHeadingRef}
            intro={challenge}
            code={code}
            onCodeChange={setCode}
            busy={busy}
            onSubmit={confirm3ds}
            onBack={backToCard}
            noCodeText={t("checkout.threeDsNoCode")}
          />
        )}

        {/* Yıkıcı eylem ödeme yollarının altında, birincil düğmelerden ayrık durur. */}
        {(step === "pay" || step === "split" || step === "challenge") && (
          <button
            type="button"
            onClick={release}
            aria-disabled={busy || undefined}
            className="mt-6 min-h-[44px] w-full rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-800 aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
          >
            {t("release")}
          </button>
        )}
        {held && step !== "pending" && (
          <Link
            href="/cart"
            className="mt-3 inline-flex min-h-[44px] items-center text-sm text-primary-600 hover:underline"
          >
            {t("checkout.backToCart")}
          </Link>
        )}
        {confirmDialog}
      </main>
    </CartCheckoutFrame>
  );
}
