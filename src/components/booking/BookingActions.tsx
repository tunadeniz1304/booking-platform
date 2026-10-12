"use client";

import { useEffect, useId, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ApiError, apiFetch, isNetworkError, isTimeoutError } from "@/lib/api-client";
import { MOCK_3DS_CODE } from "@/lib/payment/card-token";
import { useFormat } from "@/i18n/use-format";
import { Button, ErrorText, Field, focusRing } from "@/components/ui/ui";
import {
  freeCancellation,
  type PolicySnapshotView,
} from "@/lib/booking/free-cancellation-deadline";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import {
  CardFields,
  tokenizeCardFields,
  type CardField,
  type CardFieldErrors,
  type CardValues,
} from "@/components/payment/CardFields";
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
  /**
   * RNPL planı açık, tahsilat henüz yapılmadı. `false` verilirse sunucunun `not_paid` gerekçesi
   * (ör. önceden tamamen iade edilmiş ödeme) iptal sonucunda "ödeme alınmadı" diye gösterilmez.
   */
  chargePending?: boolean;
  /**
   * Durum değişti (ödeme/iptal): sayfa yeniden okur. F2-04: iptal sonucu (iade metni) sayfanın
   * durum duyurusuna ve başlık altındaki açıklamaya eklenir; burada ayrıca gösterilmez.
   */
  onChanged: (resultText?: string) => void;
  /** F2-15: süresi dolan tutmada "aynı tarihlerle yeniden ara" bağlantısı (sayfayla aynı hedef). */
  rebookHref?: string;
  /** F2-01: onay penceresinde ücretsiz iptal sonucu için (CancellationDeadlineNote ile aynı veri). */
  policySnapshot?: unknown;
  checkIn?: string;
  createdAt?: string | null;
  timeZone?: string | null;
  checkInTime?: string | null;
}

/** Tesis saat dilimi bilinmiyorsa (freeCancellation ile aynı varsayılan). */
const DEFAULT_TIME_ZONE = "Europe/Istanbul";

/**
 * `at: "cancel"` → hata iptal düğmesinin yanında; aksi hâlde etkin ödeme formunda gösterilir.
 * `note`: nötr bilgi (ör. ek doğrulamadan vazgeçildi); ödeme düğmesinin yanında görünür.
 */
interface Message {
  kind: "error" | "info" | "note";
  text: string;
  /** F2-47: yalnız başarı yeşil; nötr gri, uyarı (ör. zaman aşımı kontrolü) amber. */
  tone?: "success" | "neutral" | "warning";
  at?: "cancel";
  /** Yalnız rezervasyon HELD iken geçerli (ör. zaman aşımından sonraki durum kontrolü notu). */
  whileHeld?: boolean;
}

/** 3DS adımında bu kodlar geldiğinde bekleyen doğrulama kapanmıştır: kart formuna dönülür. */
const CHALLENGE_CLOSED = new Set([
  "PAYMENT_DECLINED",
  "NO_PENDING_CHALLENGE",
  "PAYMENT_ATTEMPTS_EXCEEDED",
]);

function newIdemKey() {
  return typeof crypto !== "undefined" ? crypto.randomUUID() : String(Date.now());
}

/** Ret yanıtındaki kalan deneme hakkı (sunucu `details.attemptsLeft` gönderirse). */
function attemptsLeftOf(err: unknown): number | null {
  if (!(err instanceof ApiError) || !err.details || typeof err.details !== "object") return null;
  const left = (err.details as { attemptsLeft?: unknown }).attemptsLeft;
  return typeof left === "number" && left > 0 ? left : null;
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
  chargePending,
  onChanged,
  rebookHref = "/search",
  policySnapshot,
  checkIn,
  createdAt,
  timeZone,
  checkInTime,
}: Props) {
  const t = useTranslations("payment");
  const tc = useTranslations("common");
  const f = useFormat();
  const { confirm, confirmDialog } = useConfirm();
  const ids = useId();
  /** Yapılandırma gelene kadar hiçbir form çizilmez (mock formdan Stripe'a geçişte veri kaybı). */
  const [payConfig, setPayConfig] = useState<PaymentConfig | null>(null);
  const [configFailed, setConfigFailed] = useState(false);
  const [configAttempt, setConfigAttempt] = useState(0);
  const [card, setCard] = useState<CardValues>({ number: "", exp: "", cvc: "" });
  const [fieldErrors, setFieldErrors] = useState<CardFieldErrors>({});
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  /** İptal isteği sürüyor (düğme metni "İptal ediliyor..." olur). */
  const [cancelling, setCancelling] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  /** Ekran okuyucu duyurusu (her zaman DOM'da duran tek `role=status` bölgesi). */
  const [announcement, setAnnouncement] = useState("");
  /** Step-up bekleyen ödeme (mock formda doğrulamadan sonra otomatik yeniden denenir). */
  const [stepUp, setStepUp] = useState<{ cardToken: string } | null>(null);
  /** Stripe akışı: doğrulama token'ı sonraki gönderimde kullanılır (tek kullanımlık, v4#2). */
  const [stepUpToken, setStepUpToken] = useState<string | null>(null);
  /** P1-7: cüzdan kredisinden kullanılacak tutar (minor-unit; 0 = yalnız kart). */
  const [creditMinor, setCreditMinor] = useState(0);
  /** Kredi tutarı geçerli mi (geçersizken ödeme gönderilmez; odak tutar alanına taşınır). */
  const [creditValid, setCreditValid] = useState(true);
  /** P1-3: "şimdi rezerve et, sonra öde" seçili mi (kredi ile birlikte kullanılamaz). */
  const [rnpl, setRnpl] = useState(false);
  /** Kredi ve "sonra öde" seçenekleri okundu mu: ödeme formu ancak sonra çizilir (kayma olmasın). */
  const [creditReady, setCreditReady] = useState(false);
  const [rnplReady, setRnplReady] = useState(false);
  /** Deneme sınırı aşıldı (PAYMENT_ATTEMPTS_EXCEEDED): ödeme formları kapanır. */
  const [payLocked, setPayLocked] = useState(false);
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
  const creditInputRef = useRef<HTMLInputElement>(null);
  const payButtonRef = useRef<HTMLButtonElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const lockedRef = useRef<HTMLHeadingElement>(null);
  const stripeBoxRef = useRef<HTMLDivElement>(null);
  /** Stripe akışı: step-up doğrulamasından sonra form bir kez kendiliğinden yeniden gönderilir. */
  const resubmitStripe = useRef(false);
  /** Bir sonraki çizimden sonra odaklanacak öğe (form geçişlerinde odak kaybolmasın). */
  const focusNext = useRef<"number" | "code" | "locked" | "pay" | null>(null);

  useEffect(() => {
    if (status !== "HELD") return;
    let live = true;
    apiFetch<PaymentConfig>("/api/payments/config")
      .then((config) => {
        if (live) setPayConfig(config);
      })
      // Okunamazsa mock forma düşülmez: Stripe ortamında mock token "geçersiz kart" sayılır.
      .catch(() => {
        if (live) setConfigFailed(true);
      });
    return () => {
      live = false;
    };
  }, [status, configAttempt]);

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
    const target = focusNext.current;
    focusNext.current = null;
    if (target === "code") {
      // Kod seçili gelir: hatadan sonra yeniden yazmak için silmek gerekmez.
      codeRef.current?.focus();
      codeRef.current?.select();
    } else if (target === "number") {
      // Kart formu kapandıysa (deneme sınırı) odak açıklama başlığına gider.
      (numberRef.current ?? lockedRef.current)?.focus();
    } else if (target === "locked") lockedRef.current?.focus();
    else if (target === "pay") {
      // Step-up penceresi kapandıktan sonra odak ödeme düğmesine döner (kart ya da Stripe formu).
      const stripeButton =
        stripeBoxRef.current?.querySelector<HTMLButtonElement>('button[type="submit"]');
      (payButtonRef.current ?? stripeButton)?.focus();
    }
  });

  // Hata, gönder düğmesinin yanında çizilir; dar ekranda görünür alana kaydırılır.
  useEffect(() => {
    if (message?.kind === "error") errorRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [message]);

  // Doğrulama token'ı yeni çizimdeki `submit` kapanışına geçtikten sonra form yeniden gönderilir.
  useEffect(() => {
    if (!stepUpToken || !resubmitStripe.current) return;
    resubmitStripe.current = false;
    stripeBoxRef.current?.querySelector("form")?.requestSubmit();
  }, [stepUpToken]);

  const stripeKey =
    payConfig?.provider === "stripe" && amountMinor && currency ? payConfig.publishableKey : null;
  const useStripeForm = !!stripeKey;

  function retryConfig() {
    setConfigFailed(false);
    setConfigAttempt((n) => n + 1);
  }

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

  function showError(err: unknown, fallback: string, at?: "cancel") {
    if (err instanceof ApiError && err.code === "HOLD_EXPIRED") setServerExpired(true);
    if (err instanceof ApiError && err.code === "PAYMENT_ATTEMPTS_EXCEEDED") {
      setPayLocked(true);
      focusNext.current = "locked";
    }
    // Kesin ret: sonraki deneme yeni bir işlemdir (aynı anahtar eski sonucu döndürmesin).
    // Zaman aşımı (status 0) kesin ret değildir: ödeme gerçekleşmiş olabilir, anahtar korunur.
    if (err instanceof ApiError && err.status >= 400 && err.status < 500) setIdemKey(newIdemKey());
    const text = errorText(err, fallback);
    const left = attemptsLeftOf(err);
    setMessage({
      kind: "error",
      text: left === null ? text : `${text} ${t("attempts.left", { count: left })}`,
      at,
    });
  }

  /**
   * Zaman aşımı: ödeme gerçekleşmiş olabilir. Aynı Idempotency-Key korunur (yeniden deneme iki kez
   * tahsil etmez) ve rezervasyon yeniden okunur; onaylandıysa not kendiliğinden kalkar.
   */
  function handleTimeout(err: unknown): boolean {
    if (!isTimeoutError(err)) return false;
    setMessage({ kind: "info", tone: "warning", text: t("timeoutCheck"), whileHeld: true });
    onChanged();
    return true;
  }

  /** Kredi tutarı geçersizse ödeme gönderilmez; odak tutar alanına gider (hata orada yazılı). */
  function creditBlocked(): boolean {
    if (rnpl || creditValid) return false;
    creditInputRef.current?.focus();
    return true;
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
      payConfig?.provider === "mock"
        ? t("threeDsDemoHint", { code: MOCK_3DS_CODE })
        : (hint ?? t("verificationRequired"))
    );
    setAnnouncement(t("threeDsAnnounce"));
    focusNext.current = "code";
  }

  // F2-46: başarı duyurusu tek yerden (sayfanın durum bölgesi) yapılır.
  function paid() {
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
      // Stripe'ta PaymentMethod yeniden kullanılamaz: form yeniden gönderilir (yeni pm_ oluşur).
      const form = stripeBoxRef.current?.querySelector("form");
      if (form && "requestSubmit" in form) resubmitStripe.current = true;
      else setMessage({ kind: "info", tone: "neutral", text: t("verifiedRetry") });
      return;
    }
    if (!startBusy()) return;
    try {
      const out = await submitToken(pending.cardToken, token);
      if (out.status === "requires_action") openChallenge(out.challenge?.hint);
      else paid();
    } catch (err) {
      if (!handleTimeout(err)) showError(err, t("failed"));
    } finally {
      endBusy();
    }
  }

  /** Step-up'tan vazgeçildi: ödemenin yapılmadığı söylenir, odak ödeme düğmesine döner. */
  function cancelStepUp() {
    setStepUp(null);
    const parts = [t("stepUpCancelled")];
    if (holdExpiresAt) parts.push(t("holdUntil", { time: f.time(holdExpiresAt) }));
    parts.push(t("stepUpRetry"));
    setMessage({ kind: "note", text: parts.join(" ") });
    focusNext.current = "pay";
  }

  async function stripeSubmit(cardToken: string): Promise<PayResponse> {
    if (creditBlocked()) return { status: "failed" };
    setMessage(null);
    setBusy(true);
    try {
      const out = await submitToken(cardToken);
      if (out.status !== "requires_action") paid();
      return out;
    } catch (err) {
      // Stripe akışında token tekrar kullanılamaz: doğrulamadan sonra form yeniden gönderilir.
      if (isStepUp(err)) setStepUp({ cardToken: "" });
      else if (!handleTimeout(err)) showError(err, t("failed"));
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
      if (!handleTimeout(err)) showError(err, t("verificationFailed"));
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
    if (busyRef.current || creditBlocked()) return;
    setMessage(null);
    setFieldErrors({});
    // Biçim (AA/YY) ve süre ayrı doğrulanır; hata ilgili alanın altında gösterilir.
    const result = tokenizeCardFields(card);
    if (!result.ok) {
      if (result.field) failField(result.field, t(result.messageKey));
      else setMessage({ kind: "error", text: t(result.messageKey) });
      return;
    }
    const { cardToken } = result;
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
      if (!handleTimeout(err)) showError(err, t("failed"));
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
      if (handleTimeout(err)) return;
      showError(err, t("verificationFailed"));
      // Doğrulama kapandıysa (ret / bekleyen yok / deneme sınırı) kod ekranında bırakma;
      // açık kaldıysa odak kod alanına döner (girilen kod seçili, doğrudan yeniden yazılır).
      if (err instanceof ApiError && err.code && CHALLENGE_CLOSED.has(err.code)) backToCard();
      else focusNext.current = "code";
    } finally {
      endBusy();
    }
  }

  /** F2-01: onaylı rezervasyonda iptalin iade sonucu (ücretsiz iptal son anına göre). */
  function refundOutlook(): string {
    const snapshot =
      policySnapshot && typeof policySnapshot === "object"
        ? (policySnapshot as PolicySnapshotView)
        : null;
    const state = checkIn
      ? freeCancellation(snapshot, { checkIn, createdAt, timeZone, checkInTime })
      : null;
    if (!state) return t("cancel.dialogBodyConfirmed");
    if (state.kind === "none") return t("cancel.dialogRefundNone");
    const zone = timeZone || DEFAULT_TIME_ZONE;
    const when = { date: f.date(state.deadline, "long", zone), time: f.time(state.deadline, zone) };
    return state.kind === "until"
      ? t("cancel.dialogRefundUntil", when)
      : t("cancel.dialogRefundEnded", when);
  }

  async function cancel() {
    if (busyRef.current) return;
    // HELD rezervasyonda henüz tahsilat yoktur: "iade yok" yerine "ödeme alınmadı" denir.
    const wasHeld = status === "HELD";
    const ok = await confirm({
      title: t("cancel.dialogTitle"),
      body: (
        <>
          <span className="block">{wasHeld ? t("cancel.dialogBodyHeld") : refundOutlook()}</span>
          <span className="mt-2 block">{t("cancel.irreversible")}</span>
        </>
      ),
      confirmLabel: t("cancel.confirmButton"),
      cancelLabel: t("cancel.keep"),
      tone: "danger",
    });
    if (!ok) return;
    if (!startBusy()) return;
    setCancelling(true);
    setMessage(null);
    try {
      const res = await apiFetch<{
        refund: { refundMinor: number; currency: string; refundPercent: number; reason?: string };
      }>(`/api/bookings/${bookingId}`, { method: "DELETE" });
      // `not_paid`: tahsil edilmiş tutar yok (HELD ya da tahsilatı yapılmamış RNPL planı).
      const notCharged = wasHeld || (res.refund.reason === "not_paid" && chargePending !== false);
      // F2-04: sonuç sayfanın başlık altı açıklamasında ve tek durum duyurusunda gösterilir.
      onChanged(
        res.refund.refundMinor > 0
          ? t("cancel.refunded", {
              amount: f.money(res.refund.refundMinor, res.refund.currency),
              percent: String(res.refund.refundPercent),
            })
          : notCharged
            ? t("cancel.cancelledNoCharge")
            : t("cancel.noRefund")
      );
    } catch (err) {
      showError(err, t("cancel.failed"), "cancel");
    } finally {
      setCancelling(false);
      endBusy();
    }
  }

  const input = `mt-1 w-full rounded-lg border border-gray-500 px-3 py-2 text-base sm:text-sm ${focusRing}`;
  const held = status === "HELD" && !expired;
  const remainingText =
    remainingMs !== null && remainingMs > 0
      ? `${Math.floor(remainingMs / 60_000)}:${String(Math.floor((remainingMs % 60_000) / 1000)).padStart(2, "0")}`
      : null;
  /** Seçenek kutuları belirmeden form çizilmez: yazarken alanlar aşağı kaymasın (F1021/F759). */
  const optionsReady = creditReady && (useStripeForm || rnplReady);
  const showCardForm =
    held && !!payConfig && optionsReady && !useStripeForm && !challenge && !payLocked;
  const showCodeForm = held && !!challenge && !payLocked;
  const showStripe = held && useStripeForm && optionsReady && !payLocked;
  /** Tahsil edilecek tutar düğmede de görünür (kredi düşülmüş). */
  const payLabel =
    amountMinor !== undefined && currency
      ? `${t("payAndConfirm")} · ${f.money(amountMinor - creditMinor, currency)}`
      : t("payAndConfirm");
  // Hata, onu doğuran eylemin yanında gösterilir: ödeme hatası gönder düğmesinin hemen üstünde.
  const errorAt =
    message?.kind !== "error"
      ? null
      : message.at === "cancel"
        ? "cancel"
        : showCardForm
          ? "card"
          : showCodeForm
            ? "code"
            : showStripe
              ? "stripe"
              : "page";
  const errorAlert =
    message?.kind === "error" ? (
      // F2-44: ortak ErrorText; kaydırma için ref saran öğede.
      <div ref={errorRef}>
        <ErrorText>{message.text}</ErrorText>
      </div>
    ) : null;
  // Nötr not ödeme düğmesinin yanında görünür; duyuru `role=status` bölgesinden yapılır.
  const noteText =
    message?.kind === "note" ? <p className="text-sm text-gray-700">{message.text}</p> : null;
  const holdInfo =
    held && holdExpiresAt ? (
      <div className="text-sm text-amber-700">
        <p>{t("holdUntil", { time: f.time(holdExpiresAt) })}</p>
        {remainingText && (
          <p className="font-semibold">{t("hold.remaining", { time: remainingText })}</p>
        )}
      </div>
    ) : null;
  const cancelLabel = cancelling ? t("cancel.processing") : t("cancel.button");
  /** Zaman aşımı notu rezervasyon onaylanınca (sayfa yeni durumu duyurur) gösterilmez. */
  const statusMessage = message?.whileHeld && status !== "HELD" ? null : message;
  const cancelBusyClass = "aria-disabled:cursor-not-allowed aria-disabled:opacity-60";

  return (
    <div className="space-y-4 border-t border-gray-100 pt-6">
      {expired && (
        <div className="space-y-2 text-sm text-amber-700">
          <h2 className="text-lg font-semibold text-gray-900">{t("hold.expiredTitle")}</h2>
          <p>{t("hold.expiredBody")}</p>
          <Link
            href={rebookHref}
            className={`inline-flex min-h-[44px] items-center font-semibold text-[#003580] underline ${focusRing}`}
          >
            {t("hold.rebook")}
          </Link>
        </div>
      )}

      {held && payLocked && (
        <>
          {holdInfo}
          <div className="space-y-2 text-sm text-gray-700">
            <h2 ref={lockedRef} tabIndex={-1} className="text-lg font-semibold text-gray-900">
              {t("attempts.lockedTitle")}
            </h2>
            <p>{t("attempts.lockedBody")}</p>
            <Link
              href={`/support?bookingId=${encodeURIComponent(bookingId)}`}
              className={`inline-flex min-h-[44px] items-center font-semibold text-[#003580] underline ${focusRing}`}
            >
              {t("attempts.contactSupport")}
            </Link>
          </div>
        </>
      )}

      {/* Tek "Ödeme" başlığı: ödeme zamanı, kredi ve kart formu bu başlığın altında sıralanır. */}
      {held && !payLocked && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">{t("title")}</h2>
          {holdInfo}

          {(!payConfig || !optionsReady) && (
            <div className="min-h-[18rem] space-y-3" aria-busy={!configFailed}>
              {configFailed ? (
                <>
                  <ErrorText>{t("config.failed")}</ErrorText>
                  <Button variant="secondary" size="lg" fullWidth onClick={retryConfig}>
                    {tc("errorPage.retry")}
                  </Button>
                </>
              ) : (
                <p className="text-sm text-gray-600">{t("config.loading")}</p>
              )}
            </div>
          )}

          {!!payConfig && !challenge && !useStripeForm && (
            <RnplOption
              bookingId={bookingId}
              disabled={busy}
              selected={rnpl}
              onChange={setRnpl}
              creditMinor={creditMinor}
              onLoaded={() => setRnplReady(true)}
            />
          )}
          {/* Gizlenir, kaldırılmaz: geri dönüldüğünde kutu ile gönderilen kredi aynı kalır.
              "Sonra öde" seçiliyken kutu kaybolmaz; devre dışı görünür ve nedeni yazılır. */}
          <div hidden={!payConfig || !!challenge}>
            <WalletCreditOption
              bookingId={bookingId}
              totalMinor={amountMinor}
              currency={currency}
              disabled={busy}
              onChange={setCreditMinor}
              onValidityChange={setCreditValid}
              inputRef={creditInputRef}
              rnplSelected={rnpl}
              onLoaded={() => setCreditReady(true)}
            />
          </div>

          {showStripe && (
            <div ref={stripeBoxRef} className="space-y-3">
              <StripePaymentForm
                publishableKey={stripeKey!}
                amountMinor={amountMinor! - creditMinor}
                currency={currency!}
                busy={busy}
                submit={stripeSubmit}
                confirm={stripeConfirm}
                onError={(text) => setMessage({ kind: "error", text })}
              />
              {noteText}
              {errorAt === "stripe" && errorAlert}
            </div>
          )}

          {showCardForm && (
            <form onSubmit={pay} noValidate className="space-y-3" aria-label={t("title")}>
              <CardFields
                values={card}
                onChange={updateCard}
                errors={fieldErrors}
                disabled={busy}
                idPrefix={ids}
                inputRefs={{ number: numberRef, exp: expRef, cvc: cvcRef }}
                showTestCards
              />
              {noteText}
              {errorAt === "card" && errorAlert}
              <Button ref={payButtonRef} type="submit" size="lg" fullWidth busy={busy}>
                {busy ? t("processing") : rnpl ? t("rnpl.reserve") : payLabel}
              </Button>
            </form>
          )}

          {showCodeForm && (
            <form onSubmit={confirm3ds} className="space-y-3" aria-label={t("threeDsTitle")}>
              <h3 className="text-base font-semibold text-gray-900">{t("threeDsTitle")}</h3>
              <p className="text-sm text-gray-600">{t("threeDsIntro")}</p>
              <Field label={t("verificationCode")} id={`${ids}-code`} hint={challenge}>
                <input
                  id={`${ids}-code`}
                  ref={codeRef}
                  className={input}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={8}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  required
                />
              </Field>
              {errorAt === "code" && errorAlert}
              <Button type="submit" size="lg" fullWidth busy={busy}>
                {busy ? t("processing") : t("verify")}
              </Button>
              <p id={`${ids}-nocode`} className="text-sm text-gray-600">
                {t("threeDsNoCode")}
              </p>
              <Button
                variant="secondary"
                size="lg"
                fullWidth
                busy={busy}
                onClick={backToCard}
                aria-describedby={`${ids}-nocode`}
              >
                {t("threeDsBack")}
              </Button>
            </form>
          )}
        </section>
      )}

      {errorAt === "page" && errorAlert}

      {/* Ödeme adımında iptal birincil eylem değildir: ödeme formundan ayrı, metin bağlantısı. */}
      {status === "HELD" && (
        <div
          role="group"
          aria-labelledby={`${ids}-more`}
          className="space-y-1 border-t border-gray-100 pt-4"
        >
          <p id={`${ids}-more`} className="text-sm text-gray-600">
            {t("otherOptions")}
          </p>
          <button
            type="button"
            onClick={() => void cancel()}
            aria-disabled={busy || undefined}
            aria-busy={cancelling || undefined}
            className={`inline-flex min-h-[44px] items-center text-sm font-semibold text-red-700 underline hover:no-underline ${cancelBusyClass} ${focusRing}`}
          >
            {cancelLabel}
          </button>
        </div>
      )}
      {status === "CONFIRMED" && (
        <Button variant="dangerOutline" size="lg" busy={busy} onClick={() => void cancel()}>
          {cancelLabel}
        </Button>
      )}
      {errorAt === "cancel" && errorAlert}

      {stepUp && (
        <StepUpDialog
          bookingId={bookingId}
          holdExpiresAt={holdExpiresAt}
          onVerified={(token) => void afterStepUp(token)}
          onCancel={cancelStepUp}
        />
      )}

      <p
        role="status"
        aria-live="polite"
        className={
          statusMessage?.kind !== "info"
            ? "sr-only"
            : statusMessage.tone === "success"
              ? "text-sm text-green-700"
              : statusMessage.tone === "warning"
                ? "text-sm text-amber-700"
                : "text-sm text-gray-700"
        }
      >
        {statusMessage && statusMessage.kind !== "error"
          ? statusMessage.text
          : expired
            ? t("hold.expired")
            : announcement}
      </p>

      {confirmDialog}
    </div>
  );
}
