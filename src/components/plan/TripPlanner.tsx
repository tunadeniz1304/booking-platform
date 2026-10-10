"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { ApiError, apiFetch } from "@/lib/api-client";
import { useTranslations } from "next-intl";
import { isoDay, newIdempotencyKey } from "@/lib/ui/format";
import { useFormat } from "@/i18n/use-format";
import {
  Button,
  Card,
  Field,
  LlmBadge,
  Status,
  focusRing,
  inputClass,
  useErrorText,
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

interface SavedState {
  cities: string;
  days: string;
  guests: string;
  startDate: string;
  plan: TripPlan | null;
  keys: string[];
  /** Durak sırası → tutulan rezervasyon kimliği. */
  held: Record<number, string>;
}

type FieldName = "cities" | "days" | "guests" | "startDate";
type FieldErrors = Partial<Record<FieldName, string>>;

/** Plan sekme oturumunda saklanır: ödeme sayfasından dönünce kaybolmaz. */
const STORAGE_KEY = "trip-planner-state";
const MAX_CITIES = 6;
const FIELD_IDS: Record<FieldName, string> = {
  cities: "trip-cities",
  days: "trip-days",
  guests: "trip-guests",
  startDate: "trip-start",
};
const FIELD_ORDER: FieldName[] = ["cities", "days", "guests", "startDate"];

function loadState(): SavedState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SavedState) : null;
  } catch {
    return null;
  }
}

function splitCities(value: string): string[] {
  return value
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
}

export default function TripPlanner() {
  const t = useTranslations("plan");
  const errorText = useErrorText();
  const f = useFormat();
  const [initial] = useState(loadState);
  const [cities, setCities] = useState(initial?.cities ?? "İstanbul, Kapadokya, Antalya");
  const [days, setDays] = useState(initial?.days ?? "6");
  const [guests, setGuests] = useState(initial?.guests ?? "2");
  const [startDate, setStartDate] = useState(initial?.startDate ?? isoDay(14));
  const [plan, setPlan] = useState<TripPlan | null>(initial?.plan ?? null);
  const [keys, setKeys] = useState<string[]>(initial?.keys ?? []);
  const [held, setHeld] = useState<Record<number, string>>(initial?.held ?? {});
  const [busy, setBusy] = useState(false);
  const [holding, setHolding] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  useEffect(() => {
    try {
      const state: SavedState = { cities, days, guests, startDate, plan, keys, held };
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* depolama kapalıysa plan yalnızca bu görünümde kalır */
    }
  }, [cities, days, guests, startDate, plan, keys, held]);

  function showFieldErrors(errors: FieldErrors) {
    setFieldErrors(errors);
    const first = FIELD_ORDER.find((name) => errors[name]);
    if (first) document.getElementById(FIELD_IDS[first])?.focus();
  }

  function validate(list: string[]): FieldErrors {
    const errors: FieldErrors = {};
    if (list.length === 0) errors.cities = t("errors.citiesRequired");
    else if (list.length > MAX_CITIES)
      errors.cities = t("errors.tooManyCities", { max: MAX_CITIES, count: list.length });
    else {
      const bad = list.find((c) => c.length < 2 || c.length > 60);
      if (bad) errors.cities = t("errors.cityLength", { city: bad });
    }
    return errors;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    const list = splitCities(cities);
    const clientErrors = validate(list);
    if (Object.keys(clientErrors).length > 0) {
      showFieldErrors(clientErrors);
      return;
    }
    setFieldErrors({});
    setBusy(true);
    try {
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
      setHeld({});
      // Her durak için tek idempotency anahtarı: çift tıklama/yeniden deneme çift rezervasyon üretmez.
      setKeys(res.stops.map(() => newIdempotencyKey()));
    } catch (err) {
      const fieldErrorsFromServer = serverFieldErrors(err);
      if (fieldErrorsFromServer) showFieldErrors(fieldErrorsFromServer);
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  /** Sunucu doğrulama hatasını (`details.fieldErrors`) ilgili alanlara eşler. */
  function serverFieldErrors(err: unknown): FieldErrors | null {
    if (!(err instanceof ApiError) || err.code !== "VALIDATION_ERROR") return null;
    const fe = (err.details as { fieldErrors?: Record<string, unknown> } | undefined)?.fieldErrors;
    if (!fe) return null;
    const errors: FieldErrors = {};
    for (const name of FIELD_ORDER) {
      if (fe[name]) errors[name] = t(`errors.invalid.${name}`);
    }
    return Object.keys(errors).length > 0 ? errors : null;
  }

  async function hold(index: number) {
    const stop = plan?.stops[index];
    if (!stop?.stay || holding !== null || held[index]) return;
    setHolding(index);
    setError(null);
    try {
      const res = await apiFetch<{ booking: { id: string } }>("/api/bookings", {
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
      setHeld((prev) => ({ ...prev, [index]: res.booking.id }));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setHolding(null);
    }
  }

  const holdable = plan ? plan.stops.filter((s) => s.stay).length : 0;
  const heldCount = Object.keys(held).length;

  return (
    <div className="space-y-6">
      <Card title={t("form.title")} id="trip-form">
        <form onSubmit={submit} aria-busy={busy} className="grid gap-4 md:grid-cols-4">
          <div className="md:col-span-4">
            <Field
              label={t("form.cities")}
              id="trip-cities"
              hint={t("form.citiesHint")}
              error={fieldErrors.cities}
            >
              <input
                id="trip-cities"
                className={inputClass}
                value={cities}
                required
                autoComplete="off"
                onChange={(e) => setCities(e.target.value)}
              />
            </Field>
          </div>
          <Field label={t("form.days")} id="trip-days" error={fieldErrors.days}>
            <input
              id="trip-days"
              type="number"
              inputMode="numeric"
              min={1}
              max={30}
              className={inputClass}
              value={days}
              required
              onChange={(e) => setDays(e.target.value)}
            />
          </Field>
          <Field label={t("form.guests")} id="trip-guests" error={fieldErrors.guests}>
            <input
              id="trip-guests"
              type="number"
              inputMode="numeric"
              min={1}
              max={10}
              className={inputClass}
              value={guests}
              required
              onChange={(e) => setGuests(e.target.value)}
            />
          </Field>
          <Field label={t("form.startDate")} id="trip-start" error={fieldErrors.startDate}>
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
                      {held[i] ? (
                        <span className="flex flex-wrap items-center gap-3">
                          <span className="text-gray-900">{t("result.held")}</span>
                          <Link
                            href={`/booking/${held[i]}`}
                            className={`inline-flex min-h-[44px] items-center font-semibold text-[#003580] underline sm:min-h-0 ${focusRing}`}
                            aria-label={t("result.payLabel", { city: s.city })}
                          >
                            {t("result.pay")}
                          </Link>
                        </span>
                      ) : (
                        <Button
                          onClick={() => hold(i)}
                          disabled={holding !== null}
                          aria-busy={holding === i}
                          aria-label={t("result.holdLabel", { city: s.city })}
                        >
                          {holding === i ? t("result.holding") : t("result.hold")}
                        </Button>
                      )}
                    </div>
                  ) : (
                    <p className="mt-1 text-gray-700">{t("result.noStay")}</p>
                  )}
                </li>
              ))}
            </ol>
            {holdable > 0 && (
              <p className="mt-4 text-sm text-gray-900">
                {t("result.heldSummary", { held: heldCount, total: holdable })}
              </p>
            )}
            <p className="mt-2 text-sm text-gray-900">
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
