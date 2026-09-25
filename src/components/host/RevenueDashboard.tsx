"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api-client";
import { useFormat } from "@/i18n/use-format";
import {
  Button,
  Card,
  LlmBadge,
  Status,
  errorMessage,
  inputClass,
  useLoader,
} from "@/components/ui/ui";

interface Contribution {
  factor: "occupancy" | "lead_time" | "holiday" | "event" | "clamp";
  label: string;
  multiplier: number;
  amountMinor: number;
}

interface SuggestionView {
  id: string;
  roomId: string;
  roomName: string;
  date: string;
  currency: string;
  currentMinor: number;
  suggestedMinor: number;
  floorMinor: number;
  ceilingMinor: number;
  contributions: Contribution[];
  explanation: string;
  llmMode: string;
  status: "PENDING" | "ACCEPTED" | "REJECTED";
}

interface Overview {
  property: { id: string; title: string; currency: string };
  rooms: Array<{ id: string; name: string }>;
  kpis: {
    currency: string;
    from: string;
    to: string;
    availableRoomNights: number;
    soldRoomNights: number;
    revenueMinor: number;
    occupancy: number;
    adrMinor: number;
    revparMinor: number;
  };
  pickup: Array<{ date: string; pickup: number; onBooks: number }>;
  suggestions: SuggestionView[];
}

const CHART = { width: 640, height: 180, pad: 28 } as const;

/** Pickup grafiği: penceredeki oda-gece (çizgi) + günlük giriş (çubuk); saf SVG. */
function PickupChart({ points }: { points: Overview["pickup"] }) {
  const t = useTranslations("revenue");
  const f = useFormat();
  if (points.length === 0) return <p className="text-sm text-gray-700">{t("pickup.noData")}</p>;
  const max = Math.max(1, ...points.map((p) => p.onBooks));
  const innerW = CHART.width - CHART.pad * 2;
  const innerH = CHART.height - CHART.pad * 2;
  const step = points.length > 1 ? innerW / (points.length - 1) : 0;
  const x = (i: number) => CHART.pad + i * step;
  const y = (v: number) => CHART.pad + innerH - (v / max) * innerH;
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.onBooks)}`).join(" ");
  const barW = Math.max(2, step * 0.6);
  const last = points[points.length - 1];
  return (
    <figure>
      <svg
        viewBox={`0 0 ${CHART.width} ${CHART.height}`}
        role="img"
        aria-labelledby="pickup-title pickup-desc"
        className="h-auto w-full"
      >
        <title id="pickup-title">{t("pickup.chartTitle")}</title>
        <desc id="pickup-desc">
          {t("pickup.chartDesc", { count: points.length, last: last.onBooks })}
        </desc>
        <line
          x1={CHART.pad}
          x2={CHART.width - CHART.pad}
          y1={CHART.pad + innerH}
          y2={CHART.pad + innerH}
          stroke="#9ca3af"
        />
        {points.map((p, i) =>
          p.pickup > 0 ? (
            <rect
              key={p.date}
              x={x(i) - barW / 2}
              y={y(p.pickup)}
              width={barW}
              height={CHART.pad + innerH - y(p.pickup)}
              fill="#93c5fd"
            >
              <title>{`${f.date(p.date, "short")}: +${p.pickup}`}</title>
            </rect>
          ) : null
        )}
        <path d={line} fill="none" stroke="#003580" strokeWidth={2} />
        <text x={CHART.pad} y={CHART.pad - 8} fontSize={11} fill="#374151">
          {max}
        </text>
        <text x={CHART.pad} y={CHART.height - 6} fontSize={11} fill="#374151">
          {f.date(points[0].date, "short")}
        </text>
        <text
          x={CHART.width - CHART.pad}
          y={CHART.height - 6}
          fontSize={11}
          fill="#374151"
          textAnchor="end"
        >
          {f.date(last.date, "short")}
        </text>
      </svg>
      <figcaption className="mt-1 text-xs text-gray-700">{t("pickup.caption")}</figcaption>
    </figure>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <dt className="text-xs text-gray-700">{label}</dt>
      <dd className="text-lg font-semibold text-gray-900">{value}</dd>
    </div>
  );
}

function SuggestionRow({ s, onDecided }: { s: SuggestionView; onDecided: () => void }) {
  const t = useTranslations("revenue");
  const f = useFormat();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const decide = async (action: "accept" | "reject") => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/host/revenue/suggestions/${s.id}/${action}`, { method: "POST" });
      onDecided();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="space-y-2 rounded-lg border border-gray-200 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium text-gray-900">
          {s.roomName} · {f.date(s.date, "short")}
        </p>
        <p className="text-sm text-gray-800">
          {f.money(s.currentMinor, s.currency)} →{" "}
          <strong>{f.money(s.suggestedMinor, s.currency)}</strong>
          <span className="ml-2 text-xs text-gray-700">
            {t("suggestions.bounds", {
              floor: f.money(s.floorMinor, s.currency),
              ceiling: f.money(s.ceilingMinor, s.currency),
            })}
          </span>
        </p>
      </div>
      <table className="min-w-full text-left text-sm">
        <caption className="sr-only">{t("suggestions.caption")}</caption>
        <thead className="border-b text-gray-700">
          <tr>
            <th scope="col" className="py-1 pr-4">
              {t("suggestions.columns.factor")}
            </th>
            <th scope="col" className="py-1 pr-4">
              {t("suggestions.columns.detail")}
            </th>
            <th scope="col" className="py-1 pr-4">
              {t("suggestions.columns.multiplier")}
            </th>
            <th scope="col" className="py-1 pr-4 text-right">
              {t("suggestions.columns.contribution")}
            </th>
          </tr>
        </thead>
        <tbody>
          {s.contributions.map((c) => (
            <tr key={c.factor} className="border-b last:border-0">
              <td className="py-1 pr-4">{t(`factor.${c.factor}`)}</td>
              <td className="py-1 pr-4 text-gray-700">{c.label}</td>
              <td className="py-1 pr-4">×{c.multiplier.toFixed(2)}</td>
              <td className="py-1 pr-4 text-right">
                {c.amountMinor > 0 ? "+" : ""}
                {f.money(c.amountMinor, s.currency)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-sm text-gray-800">
        {s.explanation} <LlmBadge mode={s.llmMode} />
      </p>
      <div className="flex gap-2">
        <Button onClick={() => decide("accept")} disabled={busy}>
          {t("suggestions.accept")}
        </Button>
        <Button variant="secondary" onClick={() => decide("reject")} disabled={busy}>
          {t("suggestions.reject")}
        </Button>
      </div>
      <Status error={error} />
    </li>
  );
}

function PropertyRevenue({ propertyId }: { propertyId: string }) {
  const t = useTranslations("revenue");
  const f = useFormat();
  const { data, error, reload } = useLoader(
    () => apiFetch<Overview>(`/api/host/revenue?propertyId=${encodeURIComponent(propertyId)}`),
    [propertyId]
  );
  const [roomId, setRoomId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [genError, setGenError] = useState<string | null>(null);

  if (error) return <Status error={error} />;
  if (!data) return <p className="text-sm text-gray-600">{t("loading")}</p>;
  const k = data.kpis;
  const selectedRoom = roomId || data.rooms[0]?.id || "";

  const generate = async () => {
    setBusy(true);
    setGenError(null);
    setMessage(null);
    try {
      const res = await apiFetch<{ suggestions: SuggestionView[] }>(
        "/api/host/revenue/suggestions",
        { method: "POST", body: JSON.stringify({ roomId: selectedRoom }) }
      );
      setMessage(t("suggestions.generated", { count: res.suggestions.length }));
      reload();
    } catch (e) {
      setGenError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card
        title={t("kpis.title", { from: f.date(k.from, "short"), to: f.date(k.to, "short") })}
        id="revenue-kpis"
      >
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kpi
            label={t("kpis.occupancy")}
            value={t("percent", { value: (k.occupancy * 100).toFixed(1) })}
          />
          <Kpi label={t("kpis.adr")} value={f.money(k.adrMinor, k.currency)} />
          <Kpi label={t("kpis.revpar")} value={f.money(k.revparMinor, k.currency)} />
          <Kpi label={t("kpis.revenue")} value={f.money(k.revenueMinor, k.currency)} />
        </dl>
        <p className="mt-2 text-xs text-gray-700">
          {t("kpis.sold", { sold: k.soldRoomNights, available: k.availableRoomNights })}
        </p>
      </Card>

      <Card title={t("pickup.title")} id="revenue-pickup">
        <PickupChart points={data.pickup} />
      </Card>

      <Card title={t("suggestions.title")} id="revenue-suggestions">
        <p className="mb-3 text-sm text-gray-700">{t("suggestions.intro")}</p>
        <div className="mb-4 flex flex-wrap items-end gap-2">
          <label className="text-sm text-gray-800">
            {t("suggestions.room")}
            <select
              className={inputClass}
              value={selectedRoom}
              onChange={(e) => setRoomId(e.target.value)}
            >
              {data.rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <Button onClick={generate} disabled={busy || !selectedRoom}>
            {t("suggestions.generate")}
          </Button>
        </div>
        <Status error={genError} message={message} />
        {data.suggestions.length === 0 ? (
          <p className="text-sm text-gray-700">{t("suggestions.empty")}</p>
        ) : (
          <ul className="space-y-3">
            {data.suggestions.map((s) => (
              <SuggestionRow key={s.id} s={s} onDecided={reload} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

export default function RevenueDashboard() {
  const t = useTranslations("revenue");
  const { data, error } = useLoader(() =>
    apiFetch<Array<{ id: string; title: string }>>("/api/host/properties")
  );
  const [propertyId, setPropertyId] = useState("");
  if (error) return <Status error={error} />;
  if (!data) return <p className="text-sm text-gray-600">{t("loadingProperties")}</p>;
  if (data.length === 0) return <p className="text-sm text-gray-700">{t("noProperties")}</p>;
  const selected = propertyId || data[0].id;
  return (
    <div className="space-y-6">
      <label className="block max-w-sm text-sm text-gray-800">
        {t("propertyLabel")}
        <select
          className={inputClass}
          value={selected}
          onChange={(e) => setPropertyId(e.target.value)}
        >
          {data.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
      </label>
      <PropertyRevenue key={selected} propertyId={selected} />
    </div>
  );
}
