"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";
import { useTranslations } from "next-intl";
import { isoDay, newIdempotencyKey } from "@/lib/ui/format";
import { useFormat } from "@/i18n/use-format";
import {
  Button,
  Card,
  Field,
  LlmBadge,
  Status,
  errorMessage,
  inputClass,
} from "@/components/ui/ui";

interface TripStop {
  city: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  stay: null | {
    propertyId: string;
    title: string;
    roomId: string;
    quoteId: string;
    total: number;
    currency: string;
  };
}

interface TripPlan {
  route: { order: string[]; totalKm: number; algorithm: string };
  stops: TripStop[];
  total: number;
  currency: string;
  narrative: string;
  llmMode: string;
}

export default function TripPlanner() {
  const router = useRouter();
  const t = useTranslations("plan");
  const tc = useTranslations("common");
  const f = useFormat();
  const [cities, setCities] = useState("İstanbul, Kapadokya, Antalya");
  const [days, setDays] = useState("6");
  const [guests, setGuests] = useState("2");
  const [startDate, setStartDate] = useState(isoDay(14));
  const [plan, setPlan] = useState<TripPlan | null>(null);
  const [keys, setKeys] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [holding, setHolding] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const list = cities
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean);
      const res = await apiFetch<TripPlan>("/api/ai/trip-plan", {
        method: "POST",
        body: JSON.stringify({
          cities: list,
          days: Number(days),
          guests: Number(guests),
          startDate: startDate || undefined,
        }),
      });
      setPlan(res);
      // Her durak için tek idempotency anahtarı: çift tıklama/yeniden deneme çift rezervasyon üretmez.
      setKeys(res.stops.map(() => newIdempotencyKey()));
    } catch (err) {
      setError(errorMessage(err, tc("unexpectedError")));
    } finally {
      setBusy(false);
    }
  }

  async function hold(index: number) {
    const stop = plan?.stops[index];
    if (!stop?.stay) return;
    setHolding(index);
    setError(null);
    try {
      const booking = await apiFetch<{ id: string }>("/api/bookings", {
        method: "POST",
        headers: { "Idempotency-Key": keys[index] },
        body: JSON.stringify({
          propertyId: stop.stay.propertyId,
          roomId: stop.stay.roomId,
          checkIn: stop.checkIn,
          checkOut: stop.checkOut,
          guestCount: Number(guests),
          quoteId: stop.stay.quoteId,
        }),
      });
      router.push(`/booking/${booking.id}`);
    } catch (err) {
      setError(errorMessage(err, tc("unexpectedError")));
      setHolding(null);
    }
  }

  return (
    <div className="space-y-6">
      <Card title={t("form.title")} id="trip-form">
        <form onSubmit={submit} className="grid gap-4 md:grid-cols-4">
          <div className="md:col-span-4">
            <Field label={t("form.cities")} id="trip-cities">
              <input
                id="trip-cities"
                className={inputClass}
                value={cities}
                required
                onChange={(e) => setCities(e.target.value)}
              />
            </Field>
          </div>
          <Field label={t("form.days")} id="trip-days">
            <input
              id="trip-days"
              type="number"
              min={1}
              max={30}
              className={inputClass}
              value={days}
              required
              onChange={(e) => setDays(e.target.value)}
            />
          </Field>
          <Field label={t("form.guests")} id="trip-guests">
            <input
              id="trip-guests"
              type="number"
              min={1}
              max={10}
              className={inputClass}
              value={guests}
              required
              onChange={(e) => setGuests(e.target.value)}
            />
          </Field>
          <Field label={t("form.startDate")} id="trip-start">
            <input
              id="trip-start"
              type="date"
              className={inputClass}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </Field>
          <div className="flex items-end">
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? t("form.submitting") : t("form.submit")}
            </Button>
          </div>
        </form>
      </Card>

      <Status error={error} />

      <div aria-live="polite">
        {plan && (
          <Card title={t("result.title")} id="trip-result">
            <div className="flex flex-wrap items-center gap-2 text-sm text-gray-800">
              <span>
                {t.rich("result.route", {
                  route: plan.route.order.join(" → "),
                  km: Math.round(plan.route.totalKm),
                  b: (chunks) => <strong>{chunks}</strong>,
                })}
              </span>
              <LlmBadge mode={plan.llmMode} />
            </div>
            <p className="mt-3 text-sm text-gray-900">{plan.narrative}</p>
            <ol className="mt-4 space-y-3">
              {plan.stops.map((s, i) => (
                <li key={`${s.city}-${s.checkIn}`} className="rounded-md border p-3 text-sm">
                  <p className="font-semibold text-gray-900">
                    {i + 1}. {s.city} · {f.date(s.checkIn)} – {f.date(s.checkOut)} (
                    {t("result.nights", { count: s.nights })})
                  </p>
                  {s.stay ? (
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      <span>
                        {s.stay.title} · <strong>{f.money(s.stay.total, s.stay.currency)}</strong>
                      </span>
                      <Button
                        onClick={() => hold(i)}
                        disabled={holding !== null}
                        aria-label={t("result.holdLabel", { city: s.city })}
                      >
                        {holding === i ? t("result.holding") : t("result.hold")}
                      </Button>
                    </div>
                  ) : (
                    <p className="mt-1 text-gray-700">{t("result.noStay")}</p>
                  )}
                </li>
              ))}
            </ol>
            <p className="mt-4 text-sm text-gray-900">
              {t.rich("result.total", {
                amount: f.money(plan.total, plan.currency),
                b: (chunks) => <strong>{chunks}</strong>,
              })}
            </p>
            <p className="mt-1 text-xs text-gray-600">{t("result.note")}</p>
          </Card>
        )}
      </div>
    </div>
  );
}
