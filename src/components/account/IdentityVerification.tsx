"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ApiError, apiFetch } from "@/lib/api-client";
import { useFormat } from "@/i18n/use-format";
import {
  Button,
  Card,
  ErrorText,
  Field,
  LoadError,
  focusRing,
  inputClass,
} from "@/components/ui/ui";
import { useAccountErrorText } from "./ReauthDialog";

type KycStatus = "NOT_STARTED" | "PENDING" | "VERIFIED" | "REQUIRES_INPUT" | "FAILED";

interface IdentityStatus {
  status: KycStatus;
  provider: "mock" | "stripe";
  verifiedAt: string | null;
  lastError: string | null;
  required: { host: boolean; guest: boolean };
  testDocuments: string[];
  /** Günlük başlatma sınırı (sunucu verirse metinde gösterilir). */
  maxStartsPerDay?: number;
}

const STATUS_STYLE: Record<KycStatus, string> = {
  NOT_STARTED: "bg-gray-100 text-gray-800",
  PENDING: "bg-blue-50 text-blue-800",
  VERIFIED: "bg-green-50 text-green-800",
  REQUIRES_INPUT: "bg-amber-50 text-amber-900",
  FAILED: "bg-red-50 text-red-800",
};

/** "İnceleniyor" durumunda yoklama: sekme görünürken 15 sn aralıkla, en fazla 30 dk. */
const POLL_INTERVAL_MS = 15_000;
const POLL_MAX_TRIES = 120;

const fetchStatus = () => apiFetch<IdentityStatus>("/api/account/identity");

/** Sağlayıcı dönüş adresi `/account?kyc=return` (kyc.ts). */
const isKycReturn = () => new URLSearchParams(window.location.search).get("kyc") === "return";

/** Kartın başlığına odak taşır (`scroll`: başlığı görünümün üstüne getirir). */
function focusCardHeading(root: HTMLElement | null, scroll: boolean) {
  window.requestAnimationFrame(() => {
    const heading = root?.querySelector<HTMLElement>("h2");
    if (!heading) return;
    heading.tabIndex = -1;
    if (scroll) heading.scrollIntoView({ block: "start" });
    heading.focus({ preventScroll: scroll });
  });
}

type ResendState = "idle" | "sending" | "sent" | "verified" | "failed" | "login";

/** E-posta doğrulanmadığı için başlatılamadıysa doğrulama e-postasını yeniden gönderir. */
function KycEmailResend() {
  const t = useTranslations("trust.kyc");
  const tv = useTranslations("auth.verify");
  const [state, setState] = useState<ResendState>("idle");

  async function resend() {
    setState("sending");
    try {
      const res = await apiFetch<{ sent?: boolean; alreadyVerified?: boolean }>(
        "/api/auth/verify-email/resend",
        { method: "POST", body: "{}" }
      );
      setState(res.alreadyVerified ? "verified" : "sent");
    } catch (err) {
      setState(err instanceof ApiError && err.status === 401 ? "login" : "failed");
    }
  }

  const statusText =
    state === "sent"
      ? t("emailSent")
      : state === "verified"
        ? t("emailAlreadyVerified")
        : state === "failed"
          ? tv("resendFailed")
          : state === "login"
            ? tv("loginToResend")
            : "";

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="secondary" busy={state === "sending"} onClick={resend}>
        {state === "sending" ? tv("resending") : tv("resend")}
      </Button>
      <span role="status" className="text-gray-700">
        {statusText}
      </span>
    </div>
  );
}

/**
 * Hesap ▸ Kimlik doğrulama (P1-6): durum + başlat. Stripe Identity'de sağlayıcı sayfasına
 * yönlendirir; demo (mock) sağlayıcıda test belgesi seçilir ve sonuç hemen görünür.
 */
export default function IdentityVerification({ role }: { role?: string }) {
  const t = useTranslations("trust.kyc");
  // F187: sunucu metni yerine arayüz dilinde hata.
  const errorText = useAccountErrorText();
  const fmt = useFormat();
  const [data, setData] = useState<IdentityStatus | null>(null);
  const [doc, setDoc] = useState("valid");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // F636: durum yüklenemedi; "Tekrar dene" ile yeniden istenir.
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloading, setReloading] = useState(false);
  // F744: durumun en son sunucudan alındığı an ("Son güncelleme").
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [emailBlocked, setEmailBlocked] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const applyStatus = useCallback((fresh: IdentityStatus) => {
    setData(fresh);
    setCheckedAt(new Date());
    setLoadFailed(false);
  }, []);

  const load = useCallback(
    () =>
      fetchStatus()
        .then((fresh) => {
          applyStatus(fresh);
          return fresh;
        })
        .catch(() => {
          setLoadFailed(true);
          return null;
        }),
    [applyStatus]
  );

  useEffect(() => {
    let cancelled = false;
    fetchStatus()
      .then((d) => {
        if (cancelled) return;
        applyStatus(d);
        // F621: sağlayıcıdan dönüşte kartı öne getir ve sonucu duyur.
        if (!isKycReturn()) return;
        setInfo(
          d.status === "PENDING"
            ? t("returnPending")
            : t("resultAnnounce", { status: t(`status.${d.status}`) })
        );
        focusCardHeading(rootRef.current, true);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [t, applyStatus]);

  // "İnceleniyor": sonuç webhook'la gelir; sayfayı elle yenilemeden kart güncellenir.
  // F744: yalnız sekme görünürken yoklanır; sekmeye dönülünce hemen bakılır.
  const pending = data?.status === "PENDING";
  useEffect(() => {
    if (!pending) return;
    let active = true;
    let tries = 0;
    let inFlight = false;
    const poll = () => {
      if (document.visibilityState !== "visible" || inFlight || tries >= POLL_MAX_TRIES) return;
      tries += 1;
      inFlight = true;
      fetchStatus()
        .then((fresh) => {
          if (!active) return;
          applyStatus(fresh);
          if (fresh.status === "PENDING") return;
          setInfo(t("resultAnnounce", { status: t(`status.${fresh.status}`) }));
        })
        .catch(() => {})
        .finally(() => {
          inFlight = false;
        });
    };
    const timer = window.setInterval(poll, POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", poll);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [pending, t, applyStatus]);

  async function retryLoad() {
    if (reloading) return;
    setReloading(true);
    const fresh = await load();
    setReloading(false);
    // Düğme kalkar; odak kaybolmasın diye kart başlığına taşınır.
    if (fresh) focusCardHeading(rootRef.current, false);
  }

  async function start(e: FormEvent) {
    e.preventDefault();
    if (!data || busy) return;
    setBusy(true);
    setError(null);
    setEmailBlocked(false);
    setInfo(null);
    try {
      const res = await apiFetch<{ redirectUrl: string | null }>("/api/account/identity", {
        method: "POST",
        body: JSON.stringify(data.provider === "mock" ? { testDocument: doc } : {}),
      });
      if (res.redirectUrl) {
        setInfo(t("redirecting"));
        window.location.assign(res.redirectUrl);
        return;
      }
      const fresh = await load();
      if (fresh) setInfo(t("resultAnnounce", { status: t(`status.${fresh.status}`) }));
    } catch (err) {
      setError(errorText(err, t("startFailed")));
      setEmailBlocked(err instanceof ApiError && err.code === "EMAIL_NOT_VERIFIED");
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    if (refreshing) return;
    setRefreshing(true);
    setError(null);
    setInfo(null);
    const fresh = await load();
    setRefreshing(false);
    if (!fresh) return;
    setInfo(
      fresh.status === "PENDING"
        ? t("stillPending")
        : t("resultAnnounce", { status: t(`status.${fresh.status}`) })
    );
  }

  const verified = data?.status === "VERIFIED";
  // Stripe'ta yarıda bırakılan oturum "İnceleniyor"da kalabilir; yeniden başlatılabilir.
  const canStart = data && !verified && (!pending || data.provider === "stripe");
  const showHost = data?.required.host && (role === "HOST" || role === "ADMIN");
  const showGuest = data?.required.guest;
  const errorKey =
    data?.lastError && t.has(`errors.${data.lastError}`) ? data.lastError : "unknown";

  return (
    <div ref={rootRef} className="mt-8">
      <Card id="kyc" title={t("title")}>
        <p className="text-sm text-gray-600">{t("intro")}</p>
        {!data && !loadFailed && <p className="mt-3 text-sm text-gray-500">{t("loading")}</p>}
        {loadFailed && (
          <div className="mt-3">
            <LoadError error={t("loadFailed")} onRetry={() => void retryLoad()} busy={reloading} />
          </div>
        )}
        {error && <ErrorText className="mt-3">{error}</ErrorText>}
        {emailBlocked && (
          <div className="mt-2 text-sm">
            <KycEmailResend />
          </div>
        )}
        {/* F620: her zaman DOM'da duran canlı bölge; sonuç ve dönüş durumu duyurulur. */}
        <div role="status">{info && <p className="mt-3 text-sm text-gray-700">{info}</p>}</div>
        {data && (
          <div className="mt-3 space-y-2 text-sm">
            <p>
              {t("statusLabel")}{" "}
              <span
                data-testid="kyc-status"
                className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[data.status]}`}
              >
                {t(`status.${data.status}`)}
              </span>
            </p>
            {data.verifiedAt && (
              <p className="text-gray-700">
                {t("verifiedAt", { date: fmt.date(data.verifiedAt, "medium") })}
              </p>
            )}
            {data.lastError && (
              <div>
                <p className="text-gray-900">{t(`errors.${errorKey}`)}</p>
                <p className="mt-1 text-xs text-gray-600">
                  {t("lastError", { code: data.lastError })}
                  <span aria-hidden="true"> · </span>
                  <Link href="/support" className={`underline ${focusRing}`}>
                    {t("supportLink")}
                  </Link>
                </p>
              </div>
            )}
            {showHost && (
              <p className="text-gray-700">
                {verified ? t("requiredHostDone") : t("requiredHost")}
              </p>
            )}
            {showGuest && (
              <p className="text-gray-700">
                {verified ? t("requiredGuestDone") : t("requiredGuest")}
              </p>
            )}
            {pending && (
              <div className="space-y-2">
                <p className="text-gray-700">{t("pendingHelp")}</p>
                {data.provider === "stripe" && (
                  <p className="text-gray-700">{t("pendingRestart")}</p>
                )}
                <div className="flex flex-wrap items-center gap-3">
                  <Button variant="secondary" busy={refreshing} onClick={refresh}>
                    {refreshing ? t("refreshing") : t("refresh")}
                  </Button>
                  {checkedAt && (
                    <p className="text-xs text-gray-600">
                      {t("lastUpdated", { time: fmt.time(checkedAt) })}
                    </p>
                  )}
                </div>
              </div>
            )}
            {canStart && data.provider === "mock" && (
              <p role="note" className="rounded-md border border-gray-200 p-3 text-gray-700">
                {t("mockNotice")}
              </p>
            )}
            {canStart && data.provider === "stripe" && (
              <p role="note" className="rounded-md border border-gray-200 p-3 text-gray-700">
                {t("providerNotice")}{" "}
                {data.maxStartsPerDay
                  ? t("dailyLimit", { count: data.maxStartsPerDay })
                  : t("dailyLimitGeneric")}
              </p>
            )}
            {canStart && (
              <form onSubmit={start} className="flex flex-wrap items-end gap-3 pt-1">
                {data.provider === "mock" && (
                  <div className="w-full sm:w-64">
                    <Field id="kyc-doc" label={t("testDocumentLabel")}>
                      <select
                        id="kyc-doc"
                        value={doc}
                        onChange={(e) => setDoc(e.target.value)}
                        className={inputClass}
                      >
                        {data.testDocuments.map((d) => (
                          <option key={d} value={d}>
                            {t(`testDocuments.${d}`)}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                )}
                <Button type="submit" busy={busy}>
                  {busy
                    ? t("starting")
                    : data.provider === "stripe"
                      ? t("startProvider")
                      : data.status === "NOT_STARTED"
                        ? t("start")
                        : t("retry")}
                </Button>
              </form>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
