"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ApiError, apiFetch, logout } from "@/lib/api-client";
import { useFormat } from "@/i18n/use-format";
import type { ShareOutcome, ShareViewDTO } from "@/lib/cart/split-payment";
import {
  Button,
  ErrorText,
  PageShell,
  Status,
  focusRing,
  loginHref,
  useErrorText,
  useSession,
} from "@/components/ui/ui";
import { ThreeDsForm } from "@/components/payment/ThreeDsForm";
import {
  CardFields,
  cardFieldId,
  tokenizeCardFields,
  type CardFieldErrors,
  type CardValues,
} from "@/components/payment/CardFields";

const newKey = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : String(Date.now());

const linkClass = `inline-flex min-h-[44px] items-center text-primary-600 hover:underline sm:min-h-0 ${focusRing}`;
// İkincil eylemler ortak Button ile (F2-11); dokunma hedefi 44px.
const actionClass = "min-h-[44px]";
/** Birincil düğmenin pasif / meşgul görünümü (mevcut gri renkler korunur). */
const PRIMARY_DISABLED =
  "aria-disabled:bg-gray-300 aria-disabled:text-gray-700 aria-disabled:opacity-100";

type ResendState = "idle" | "sending" | "sent" | "verified" | "failed";

/** Ret yanıtındaki kalan deneme hakkı (sunucu `details.attemptsLeft` gönderirse). */
function attemptsLeftOf(err: unknown): number | null {
  if (!(err instanceof ApiError) || !err.details || typeof err.details !== "object") return null;
  const left = (err.details as { attemptsLeft?: unknown }).attemptsLeft;
  return typeof left === "number" && left >= 0 ? left : null;
}

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
  // Son kullanma boş başlar (önceden dolu tarih kontrol edilmeden gönderiliyordu).
  const [card, setCard] = useState<CardValues>({ number: "", exp: "", cvc: "" });
  const [cardErrors, setCardErrors] = useState<CardFieldErrors>({});
  // Deneme sınırı aşıldı (PAYMENT_ATTEMPTS_EXCEEDED): kart formu kapanır.
  const [locked, setLocked] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const cardIds = useId();
  const focusCardRef = useRef(false);
  const [payKey, setPayKey] = useState(newKey);
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<"authorized" | "confirmed" | null>(null);
  const challengeHeadingRef = useRef<HTMLHeadingElement>(null);
  const paidRef = useRef<HTMLParagraphElement>(null);
  const messageRef = useRef<HTMLDivElement>(null);
  const [refreshing, setRefreshing] = useState(false);

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
        case "PAYMENT_ATTEMPTS_EXCEEDED":
          return t("share.attemptsExceeded");
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

  // Kalan süre ödeme açıkken 30 sn'de bir güncellenir.
  const shareOpen = share?.canPay ?? false;
  useEffect(() => {
    if (!shareOpen) return;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [shareOpen]);

  // Ödeme formu yerini 3DS formuna ya da sonuca bırakınca odak yeni içeriğe taşınır.
  useEffect(() => {
    if (challenge) challengeHeadingRef.current?.focus();
    else if (focusCardRef.current) {
      focusCardRef.current = false;
      document.getElementById(cardFieldId(cardIds, "number"))?.focus();
    }
  }, [challenge, cardIds]);
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
      setAnnouncement(tp("threeDsAnnounce"));
      return;
    }
    setChallenge(null);
    setAnnouncement("");
    setResult(outcome.status);
    await load();
  }

  async function failed(err: unknown) {
    const code = err instanceof ApiError ? (err.code ?? null) : null;
    const left = attemptsLeftOf(err);
    setErrorCode(code);
    if (code === "PAYMENT_ATTEMPTS_EXCEEDED" || left === 0) {
      setLocked(true);
      setMessage(t("share.attemptsExceeded"));
    } else {
      setMessage(
        left === null
          ? errorText(err)
          : `${errorText(err)} ${t("share.attemptsLeft", { count: left })}`
      );
    }
    // F2-31: 3DS formu kalkınca odak <body>'ye düşmesin; hata kutusuna taşınır.
    const moveFocus = challenge !== null;
    setChallenge(null);
    setAnnouncement("");
    setCode("");
    setPayKey(newKey());
    await load();
    if (moveFocus) requestAnimationFrame(() => messageRef.current?.focus());
  }

  /** Paylaşılan bağlantıdan durumu yeniden okur (katılımcı rezervasyonu burada izler, F2-09). */
  async function refreshStatus() {
    if (refreshing) return;
    setRefreshing(true);
    setAnnouncement("");
    await load();
    setRefreshing(false);
    setAnnouncement(t("share.statusRefreshed"));
  }

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    if (busy || locked) return;
    setMessage(null);
    setErrorCode(null);
    const tokenized = tokenizeCardFields(card);
    if (!tokenized.ok) {
      // Hata ilgili alanın altında gösterilir (aria-describedby) ve odak o alana taşınır.
      if (tokenized.field) {
        setCardErrors({ [tokenized.field]: tp(tokenized.messageKey) });
        document.getElementById(cardFieldId(cardIds, tokenized.field))?.focus();
      } else {
        setCardErrors({});
        setMessage(tp(tokenized.messageKey));
      }
      return;
    }
    const cardToken = tokenized.cardToken;
    setCardErrors({});
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

  /** 3DS adımından vazgeçip kart formuna döner; sonraki deneme yeni bir işlemdir. */
  function backToCard() {
    focusCardRef.current = true;
    setChallenge(null);
    setCode("");
    setAnnouncement("");
    setPayKey(newKey());
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

  const verifyActions = (
    <>
      <div className="flex flex-wrap gap-3">
        <Button
          variant="secondary"
          onClick={() => void resendVerification()}
          busy={resend === "sending"}
          className={actionClass}
        >
          {resend === "sending" ? t("share.resendSending") : t("share.resendVerify")}
        </Button>
        <Button
          variant="secondary"
          onClick={() => window.location.reload()}
          className={actionClass}
        >
          {t("share.refresh")}
        </Button>
      </div>
      <p role="status">{resendStatus[resend]}</p>
    </>
  );

  /** Hata koduna bağlı kurtarma yolu: e-posta doğrulama, doğru hesaba geçiş ya da yeni link. */
  const recovery =
    errorCode === "EMAIL_NOT_VERIFIED" ? (
      <div className="mt-3 space-y-2 text-sm text-gray-800">{verifyActions}</div>
    ) : errorCode === "SHARE_EMAIL_MISMATCH" ? (
      <div className="mt-3 space-y-2 text-sm text-gray-800">
        <p>{t("share.notYoursHelp")}</p>
        {session.status === "ready" && session.user && (
          <p>{t("share.signedInAs", { email: session.user.email })}</p>
        )}
        <Button variant="secondary" onClick={() => void switchAccount()} className={actionClass}>
          {t("share.switchAccount")}
        </Button>
      </div>
    ) : errorCode === "SHARE_LINK_INVALID" || errorCode === "SHARE_LINK_EXPIRED" ? (
      <p className="mt-3 text-sm text-gray-800">
        {errorCode === "SHARE_LINK_INVALID" ? t("share.invalidHelp") : t("share.expiredHelp")}
      </p>
    ) : null;

  const homeLink = (
    <Link href="/" className={linkClass}>
      {t("share.home")}
    </Link>
  );
  // Organizatör bölünmüş ödeme durumunu sepet sayfasında izler; oraya dönüş yolu (F717).
  const statusLink = share?.isOrganizer ? (
    <Link href="/checkout/cart" className={linkClass}>
      {t("share.backToStatus")}
    </Link>
  ) : null;
  // F2-09: rezervasyon organizatöre aittir; Seyahatlerim yalnız organizatöre gösterilir.
  // Katılımcı durumu bu bağlantıdan izler ("Durumu yenile").
  const exitLinks = share?.isOrganizer ? (
    <div className="mt-4 flex flex-wrap gap-4">
      {statusLink}
      <Link href="/trips" className={linkClass}>
        {tc("checkout.trips")}
      </Link>
      {homeLink}
    </div>
  ) : (
    <div className="mt-4 space-y-3">
      <p className="text-sm text-gray-700">
        {share?.organizerName
          ? t("share.trackHere", { name: share.organizerName })
          : t("share.trackHereGeneric")}
      </p>
      <div className="flex flex-wrap items-center gap-4">
        <Button
          variant="secondary"
          onClick={() => void refreshStatus()}
          busy={refreshing}
          className={actionClass}
        >
          {t("share.refreshStatus")}
        </Button>
        {homeLink}
      </div>
    </div>
  );

  if (loadError) {
    return (
      <PageShell title={t("share.title")}>
        <div className="max-w-xl">
          <Status error={loadError} />
          {recovery ??
            (errorCode === null && (
              <div className="mt-3">
                <Button
                  variant="secondary"
                  onClick={() => window.location.reload()}
                  className={actionClass}
                >
                  {t("share.refresh")}
                </Button>
              </div>
            ))}
          <div className="mt-4">{homeLink}</div>
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
  const deadlineMs = Date.parse(share.deadlineAt);
  const canPayNow = share.canPay && deadlineMs > now;
  const minutesLeft = Math.max(0, Math.ceil((deadlineMs - now) / 60000));
  // GET yanıtı `emailVerified` döndürürse kart formundan önce doğrulama istenir.
  const emailUnverified =
    (share as ShareViewDTO & { emailVerified?: boolean }).emailVerified === false;
  const payInfoId = `${cardIds}-info`;
  const summaryTitleId = `${cardIds}-summary-title`;
  const payTitleId = `${cardIds}-pay-title`;

  /** Pay ödenemiyorsa nedeni: başka hesapça ödendi, plan iptal/tamamlandı ya da süre doldu. */
  const closedText =
    share.status === "AUTHORIZED" || share.status === "CAPTURED"
      ? t("share.paidByOther")
      : share.planStatus === "ABORTED"
        ? t("share.aborted")
        : share.planStatus === "SETTLED"
          ? t("share.confirmed")
          : share.status === "EXPIRED" || deadlineMs <= now
            ? t("share.deadlinePassed")
            : t("share.closed");

  return (
    <PageShell title={t("share.title")}>
      <div className="max-w-xl">
        {share.organizerName && !share.isOrganizer && (
          <p className="text-gray-700">{t("share.from", { name: share.organizerName })}</p>
        )}

        <section
          aria-labelledby={summaryTitleId}
          className="mt-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"
        >
          <h2 id={summaryTitleId} className="text-lg font-semibold text-gray-900">
            {t("share.summary")}
          </h2>
          <ul className="mt-3 divide-y divide-gray-100 text-sm">
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
          <p className="mt-2 text-xs text-gray-500">{t(`status.${share.status}`)}</p>
          {/* Son ödeme ayrı ve belirgin satırda; ödeme açıkken kalan süreyle. */}
          <p className="mt-3 flex items-start gap-2 text-sm font-semibold text-gray-900">
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              className="mt-0.5 h-4 w-4 shrink-0"
            >
              <circle cx="10" cy="10" r="7.5" />
              <path d="M10 6v4l2.5 2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>
              {t("deadline", { time: f.dateTime(share.deadlineAt) })}
              {!paid && canPayNow && ` ${t("deadlineLeft", { minutes: minutesLeft })}`}
            </span>
          </p>
        </section>

        {message && (
          <div className="mt-4">
            {/* F2-44: odak kabı ref/tabIndex taşır; metin ortak ErrorText ile. */}
            <div ref={messageRef} tabIndex={-1} className="focus:outline-none">
              <ErrorText>{message}</ErrorText>
            </div>
            {recovery}
            {locked && <div className="mt-4">{homeLink}</div>}
          </div>
        )}
        <p role="status" className="sr-only">
          {announcement}
        </p>
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
          {!paid && !canPayNow && (
            <div className="mt-4">
              <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
                {closedText}
              </p>
              <div className="mt-4 flex flex-wrap gap-4">
                {statusLink}
                {homeLink}
              </div>
            </div>
          )}
        </div>

        {!paid && canPayNow && emailUnverified && (
          <div className="mt-6 space-y-2 rounded-2xl border border-gray-200 bg-white p-6 text-sm text-gray-800 shadow-sm">
            <p>{t("share.verifyEmail")}</p>
            {verifyActions}
          </div>
        )}

        {!paid && canPayNow && !emailUnverified && !locked && !challenge && (
          <form
            onSubmit={pay}
            className="mt-6 space-y-3 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"
            aria-labelledby={payTitleId}
          >
            <h2 id={payTitleId} className="text-lg font-semibold text-gray-900">
              {tp("title")}
            </h2>
            {/* Provizyon: şimdi yalnız bloke edilir; tüm paylar gelince tahsil, gelmezse iptal. */}
            <p id={payInfoId} className="text-sm text-gray-700">
              {t("share.payInfo", { amount: f.money(share.amountMinor, share.currency) })}
            </p>
            <CardFields
              values={card}
              onChange={(k, v) => {
                setCard((c) => ({ ...c, [k]: v }));
                setCardErrors((e) => (e[k] ? { ...e, [k]: null } : e));
              }}
              errors={cardErrors}
              idPrefix={cardIds}
              showTestCards
              disabled={busy}
            />
            {/* Meşgulken `disabled` yerine aria-disabled: odak düğmede kalır, çift gönderim yok. */}
            <Button
              type="submit"
              busy={busy}
              size="lg"
              fullWidth
              aria-describedby={payInfoId}
              data-testid="share-pay"
              className={PRIMARY_DISABLED}
            >
              {busy
                ? tp("processing")
                : `${t("share.pay")} · ${f.money(share.amountMinor, share.currency)}`}
            </Button>
          </form>
        )}

        {challenge && (
          <ThreeDsForm
            idPrefix={cardIds}
            headingRef={challengeHeadingRef}
            intro={challenge}
            code={code}
            onCodeChange={setCode}
            busy={busy}
            onSubmit={confirm3ds}
            onBack={backToCard}
          />
        )}
      </div>
    </PageShell>
  );
}
