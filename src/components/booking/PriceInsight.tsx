"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ApiError, apiFetch } from "@/lib/api-client";
import { useFormat } from "@/i18n/use-format";
import { focusRing } from "@/components/ui/ui";

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
}

type AlertState = { kind: "ok" | "error"; text: string } | null;

/**
 * Fiyat içgörüsü (P1-4) + fiyat alarmı. İçgörü alınamazsa hiçbir şey gösterilmez;
 * rezervasyon akışını etkilemez (buton `type="button"`, formu göndermez).
 */
export default function PriceInsight({ roomId, checkIn, checkOut, guests }: Props) {
  const t = useTranslations("booking.priceInsight");
  const f = useFormat();
  const key = new URLSearchParams({ roomId, checkIn, checkOut }).toString();
  const [insight, setInsight] = useState<{ key: string; data: PriceInsightView | null } | null>(
    null
  );
  const [alertInfo, setAlert] = useState<{ key: string; state: AlertState }>({ key, state: null });
  const [busy, setBusy] = useState(false);

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

  const data = insight?.key === key ? insight.data : null;
  if (!data) return null;

  const alertState = alertInfo.key === key ? alertInfo.state : null;
  // Kalibrasyon yetersizse aralık sonsuz olabilir; o durumda aralık gösterilmez.
  const interval =
    data.interval && data.interval.high < Number.MAX_SAFE_INTEGER ? data.interval : null;

  async function createAlert() {
    setBusy(true);
    setAlert({ key, state: null });
    try {
      await apiFetch("/api/price-alerts", {
        method: "POST",
        body: JSON.stringify({ roomId, checkIn, checkOut, guests }),
      });
      setAlert({ key, state: { kind: "ok", text: t("alertCreated") } });
    } catch (err) {
      setAlert({
        key,
        state: {
          kind: "error",
          text:
            err instanceof ApiError && err.status === 401
              ? t("alertLoginRequired")
              : err instanceof ApiError
                ? err.message
                : t("alertFailed"),
        },
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="price-insight-title"
      className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-800"
      data-testid="price-insight"
    >
      <h3 id="price-insight-title" className="font-semibold text-gray-900">
        {t("title")}
      </h3>
      {data.label ? (
        <p className="mt-1">
          {t.rich("labelLine", {
            label: t(`labels.${data.label}`),
            nightly: f.money(data.nightlyMinor, data.currency),
            b: (chunks) => <strong>{chunks}</strong>,
          })}
        </p>
      ) : (
        <p className="mt-1">{t("notEnoughData")}</p>
      )}
      {data.label && interval && (
        <p className="mt-1 text-xs text-gray-700">
          {t("interval", {
            level: f.number(data.level, { style: "percent" }),
            low: f.money(interval.low, data.currency),
            high: f.money(interval.high, data.currency),
          })}
        </p>
      )}
      <button
        type="button"
        onClick={() => void createAlert()}
        disabled={busy}
        className={`mt-2 text-sm font-semibold text-[#003580] underline disabled:opacity-60 ${focusRing}`}
      >
        {t("setAlert")}
      </button>
      <p
        role="status"
        aria-live="polite"
        className={`mt-1 text-xs ${alertState?.kind === "error" ? "text-red-700" : "text-green-800"}`}
      >
        {alertState?.text ?? ""}
      </p>
    </section>
  );
}
