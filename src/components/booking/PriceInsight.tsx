"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ApiError, apiFetch, type SessionUser } from "@/lib/api-client";
import { useFormat } from "@/i18n/use-format";
import { focusRing, loginHref, useErrorText } from "@/components/ui/ui";

/** /api/price-insight yanıtı (tutarlar minor-unit, gece başı). */
interface PriceInsightView {
  currency: string;
  nightlyMinor: number;
  predictedMinor: number;
  level: number;
  interval: { low: number; high: number } | null;
  label: "low" | "typical" | "high" | null;
  calibrationSize: number;
}

interface Props {
  roomId: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  /** Oturumdaki kullanıcı (`null` = oturum yok); verilmezse bilinmiyor sayılır. */
  user?: SessionUser | null;
}

type AlertState =
  | { kind: "ok"; alertId: string; undoError?: string }
  | { kind: "removed" }
  | { kind: "login"; href: string }
  | { kind: "error"; text: string }
  | null;

/** Girişten dönüşte alarmı kurmak için dönüş adresine eklenen niyet parametresi. */
const ALERT_INTENT_PARAM = "priceAlert";
/** Aralık yalnız darsa gösterilir: üst sınır alt sınırın en çok bu katı olabilir. */
const MAX_INTERVAL_RATIO = 2;

/** Geçerli sayfaya (seçimlerle) alarm niyetiyle dönen giriş bağlantısı. */
function alertLoginHref(): string {
  const params = new URLSearchParams(window.location.search);
  params.set(ALERT_INTENT_PARAM, "1");
  return loginHref(`${window.location.pathname}?${params.toString()}${window.location.hash}`);
}

/**
 * Fiyat değerlendirmesi (P1-4) + fiyat alarmı. İçgörü alınamazsa hiçbir şey gösterilmez;
 * rezervasyon akışını etkilemez (butonlar `type="button"`, formu göndermez). Tarih/oda
 * değişince yeni veri gelene kadar önceki veri `aria-busy` ile kalır (yerleşim kaymaz).
 */
export default function PriceInsight({ roomId, checkIn, checkOut, guests, user }: Props) {
  const t = useTranslations("booking.priceInsight");
  const f = useFormat();
  const errorText = useErrorText();
  const titleId = useId();
  const hintId = useId();
  const key = new URLSearchParams({ roomId, checkIn, checkOut }).toString();
  const [insight, setInsight] = useState<{ key: string; data: PriceInsightView | null } | null>(
    null
  );
  const [alertInfo, setAlert] = useState<{ key: string; state: AlertState }>({ key, state: null });
  const [busy, setBusy] = useState<"create" | "undo" | null>(null);
  const alertButtonRef = useRef<HTMLButtonElement>(null);
  const autoAlertDone = useRef(false);

  async function createAlert() {
    if (busy) return;
    if (user === null) {
      setAlert({ key, state: { kind: "login", href: alertLoginHref() } });
      return;
    }
    setBusy("create");
    setAlert({ key, state: null });
    try {
      const created = await apiFetch<{ id: string }>("/api/price-alerts", {
        method: "POST",
        body: JSON.stringify({ roomId, checkIn, checkOut, guests }),
      });
      setAlert({ key, state: { kind: "ok", alertId: created.id } });
    } catch (err) {
      setAlert({
        key,
        state:
          err instanceof ApiError && err.status === 401
            ? { kind: "login", href: alertLoginHref() }
            : { kind: "error", text: err instanceof ApiError ? errorText(err) : t("alertFailed") },
      });
    } finally {
      setBusy(null);
    }
  }

  async function undoAlert(alertId: string) {
    if (busy) return;
    setBusy("undo");
    try {
      await apiFetch(`/api/price-alerts?id=${encodeURIComponent(alertId)}`, { method: "DELETE" });
      setAlert({ key, state: { kind: "removed" } });
      // "Geri al" düğmesi kalkıyor; odak <body>'ye düşmesin.
      alertButtonRef.current?.focus();
    } catch (err) {
      setAlert({ key, state: { kind: "ok", alertId, undoError: errorText(err, t("undoFailed")) } });
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/price-insight?${key}`, { signal: controller.signal, cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<PriceInsightView>) : null))
      .then((data) => setInsight({ key, data }))
      .catch(() => {
        if (!controller.signal.aborted) setInsight({ key, data: null });
      });
    return () => controller.abort();
  }, [key]);

  const data = insight?.data ?? null;

  // Girişten alarm niyetiyle dönüldüyse alarmı bir kez kur ve parametreyi adresten kaldır.
  useEffect(() => {
    if (autoAlertDone.current || !user || !data) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get(ALERT_INTENT_PARAM) !== "1") return;
    autoAlertDone.current = true;
    params.delete(ALERT_INTENT_PARAM);
    const search = params.toString();
    const { pathname, hash } = window.location;
    window.history.replaceState(null, "", `${pathname}${search ? `?${search}` : ""}${hash}`);
    void Promise.resolve().then(createAlert);
  });

  // İlk yüklemede yer tutucu: içerik geldiğinde altındaki düğmeler kaymasın.
  if (!insight) {
    return (
      <div
        aria-hidden="true"
        className="mt-4 min-h-[7rem] rounded-lg border border-gray-200 bg-gray-50 motion-safe:animate-pulse"
      />
    );
  }
  if (!data) return null;

  const loading = insight.key !== key;
  const alertState = alertInfo.key === key ? alertInfo.state : null;
  // Kalibrasyon yetersizse ya da aralık çok genişse (bilgi vermez) aralık gösterilmez.
  const interval =
    data.label &&
    data.interval &&
    data.interval.low > 0 &&
    data.interval.high <= data.interval.low * MAX_INTERVAL_RATIO
      ? data.interval
      : null;
  const linkClass = `font-semibold text-[#003580] underline ${focusRing}`;
  const statusError =
    alertState?.kind === "error" ||
    alertState?.kind === "login" ||
    (alertState?.kind === "ok" && !!alertState.undoError);

  return (
    <section
      aria-labelledby={titleId}
      aria-busy={loading || undefined}
      className="mt-4 min-h-[7rem] rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-800 transition-opacity aria-busy:opacity-60"
      data-testid="price-insight"
    >
      <h3 id={titleId} className="font-semibold text-gray-900">
        {t("title")}
      </h3>
      {data.label ? (
        <p className="mt-1">
          {t.rich("labelLine", {
            label: t(`labels.${data.label}`),
            b: (chunks) => <strong>{chunks}</strong>,
          })}
        </p>
      ) : (
        <p className="mt-1">{t("notEnoughData")}</p>
      )}
      {interval && (
        <p className="mt-1 text-xs text-gray-700">
          {t("interval", {
            low: f.money(interval.low, data.currency),
            high: f.money(interval.high, data.currency),
          })}
        </p>
      )}
      {data.label && (
        <details className="mt-1 text-xs text-gray-700">
          <summary className={`cursor-pointer py-2 ${focusRing}`}>{t("howAssessed")}</summary>
          <p>{t("baseRateNote", { nightly: f.money(data.nightlyMinor, data.currency) })}</p>
          {interval && (
            <p className="mt-1">
              {t("levelNote", { level: f.number(data.level, { style: "percent" }) })}
            </p>
          )}
        </details>
      )}
      <button
        ref={alertButtonRef}
        type="button"
        onClick={() => void createAlert()}
        aria-disabled={busy !== null || undefined}
        aria-busy={busy === "create" || undefined}
        aria-describedby={hintId}
        className={`mt-2 inline-flex min-h-[44px] items-center text-sm font-semibold text-[#003580] underline aria-disabled:opacity-60 sm:min-h-0 ${focusRing}`}
      >
        {busy === "create"
          ? t("settingAlert")
          : user === null
            ? t("setAlertLoginRequired")
            : t("setAlert")}
      </button>
      <p id={hintId} className="text-xs text-gray-700">
        {user ? t("alertHint", { email: user.email }) : t("alertHintAnonymous")}
      </p>
      <p
        role="status"
        aria-live="polite"
        className={`mt-1 text-xs ${statusError ? "text-red-700" : "text-green-800"}`}
      >
        {alertState?.kind === "ok" && (alertState.undoError ?? t("alertCreated"))}
        {alertState?.kind === "removed" && t("alertRemoved")}
        {alertState?.kind === "error" && alertState.text}
        {alertState?.kind === "login" &&
          t.rich("alertLoginRequired", {
            link: (chunks) => (
              <Link href={alertState.href} className={linkClass}>
                {chunks}
              </Link>
            ),
          })}
      </p>
      {alertState?.kind === "ok" && (
        <button
          type="button"
          onClick={() => void undoAlert(alertState.alertId)}
          aria-disabled={busy !== null || undefined}
          aria-busy={busy === "undo" || undefined}
          className={`mt-1 inline-flex min-h-[44px] items-center text-xs font-semibold text-[#003580] underline aria-disabled:opacity-60 sm:min-h-0 ${focusRing}`}
        >
          {busy === "undo" ? t("undoing") : t("undo")}
        </button>
      )}
    </section>
  );
}
