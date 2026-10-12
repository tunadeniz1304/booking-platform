"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { ApiError, apiFetch } from "@/lib/api-client";
import { useLocale, useTranslations } from "next-intl";
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
  /** Anlatımın dili (sunucu verirse); verilmezse anlatım Türkçedir. */
  narrativeLocale?: string;
  /** Fiyat tekliflerinin en erken bitiş zamanı (ISO; sunucu verirse gösterilir). */
  quoteExpiresAt?: string | null;
  /** Odanın ayrılma süresi, dakika (sunucu verirse nota yazılır). */
  holdMinutes?: number;
}

/** Planın üretildiği istek: "Odayı ayır" bunu kullanır; form değişirse plan eskir. */
interface PlanRequest {
  cities: string[];
  days: number;
  guests: number;
  startDate: string;
}

interface HoldResponse {
  booking: { id: string; holdExpiresAt?: string | null };
}

interface HoldError {
  text: string;
  /** Teklif süresi dolduysa ya da oda kalmadıysa "Fiyatları yenile" gösterilir. */
  canRefresh: boolean;
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
  /** Planın üretildiği istek (eski kayıtlarda yok). */
  request?: PlanRequest | null;
  /** Durak sırası → ayırmanın bitiş zamanı (ISO). */
  heldUntil?: Record<number, string>;
}

type FieldName = "cities" | "days" | "guests" | "startDate";
type FieldErrors = Partial<Record<FieldName, string>>;

/** Plan sekme oturumunda saklanır: ödeme sayfasından dönünce kaybolmaz. */
const STORAGE_KEY = "trip-planner-state";
const MAX_CITIES = 6;
const MAX_NIGHTS = 30;
const FIELD_IDS: Record<FieldName, string> = {
  cities: "trip-cities",
  days: "trip-days",
  guests: "trip-guests",
  startDate: "trip-start",
};
const FIELD_ORDER: FieldName[] = ["cities", "days", "guests", "startDate"];
const RESULT_HEADING_ID = "trip-result-title";
const STALE_ID = "trip-result-stale";
const ERROR_ICON = "\u26A0\uFE0E";
const CHIP_CLASS = `inline-flex min-h-[44px] items-center rounded-full border px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-[32px] ${focusRing}`;
const CHIP_ON = "border-[#003580] bg-blue-50 font-semibold text-[#003580]";
const CHIP_OFF = "border-gray-500 bg-white text-gray-900";

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

/** `YYYY-AA-GG` + n gün (UTC takvim günü). */
function addIsoDays(iso: string, n: number): string {
  return isoDay(n, new Date(`${iso}T00:00:00Z`));
}

const normCity = (c: string) => c.trim().toLocaleLowerCase("tr-TR");

function toRequest(v: Pick<SavedState, "cities" | "days" | "guests" | "startDate">): PlanRequest {
  return {
    cities: splitCities(v.cities),
    days: Number(v.days),
    guests: Number(v.guests),
    startDate: v.startDate,
  };
}

/** Eski kayıtlarda istek yoksa plan, saklanan form değerleriyle üretilmiş sayılır. */
function initialRequest(saved: SavedState | null): PlanRequest | null {
  return saved?.request ?? (saved?.plan ? toRequest(saved) : null);
}

function sameRequest(a: PlanRequest, b: PlanRequest): boolean {
  return (
    a.cities.map(normCity).join("|") === b.cities.map(normCity).join("|") &&
    a.days === b.days &&
    a.guests === b.guests &&
    a.startDate === b.startDate
  );
}

/** Para birimi başına konaklama toplamı (farklı para birimleri birbirine eklenmez). */
function stayTotals(stops: TripStop[]): { currency: string; total: number }[] {
  const sums = new Map<string, number>();
  for (const s of stops) {
    if (s.stay) sums.set(s.stay.currency, (sums.get(s.stay.currency) ?? 0) + s.stay.total);
  }
  return Array.from(sums, ([currency, total]) => ({ currency, total }));
}

export default function TripPlanner() {
  const t = useTranslations("plan");
  const tc = useTranslations("common");
  const locale = useLocale();
  const errorText = useErrorText();
  const f = useFormat();
  const [initial] = useState(loadState);
  const [cities, setCities] = useState(initial?.cities ?? "");
  const [days, setDays] = useState(initial?.days ?? "6");
  const [guests, setGuests] = useState(initial?.guests ?? "2");
  const [startDate, setStartDate] = useState(initial?.startDate ?? isoDay(14));
  const [plan, setPlan] = useState<TripPlan | null>(initial?.plan ?? null);
  const [request, setRequest] = useState(() => initialRequest(initial));
  const [keys, setKeys] = useState<string[]>(initial?.keys ?? []);
  const [held, setHeld] = useState<Record<number, string>>(initial?.held ?? {});
  const [heldUntil, setHeldUntil] = useState<Record<number, string>>(initial?.heldUntil ?? {});
  const [busy, setBusy] = useState(false);
  const [holding, setHolding] = useState<number | null>(null);
  const [holdErrors, setHoldErrors] = useState<Record<number, HoldError>>({});
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [cityOptions, setCityOptions] = useState<string[]>([]);
  /** Plan geldikten sonra odaklanacak öğe (sonuç başlığı ya da yenilenen durağın düğmesi). */
  const focusAfterPlan = useRef<string | null>(null);

  useEffect(() => {
    try {
      const state: SavedState = {
        cities,
        days,
        guests,
        startDate,
        plan,
        keys,
        held,
        request,
        heldUntil,
      };
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* depolama kapalıysa plan yalnızca bu görünümde kalır */
    }
  }, [cities, days, guests, startDate, plan, keys, held, request, heldUntil]);

  // Desteklenen şehirler (Location) öneri olarak; yüklenemezse şehirler yine yazılabilir.
  useEffect(() => {
    let active = true;
    apiFetch<{ city: string }[]>("/api/locations")
      .then((rows) => {
        if (active && Array.isArray(rows)) {
          setCityOptions(Array.from(new Set(rows.map((r) => r.city.trim()).filter(Boolean))));
        }
      })
      .catch(() => {
        /* öneriler isteğe bağlı */
      });
    return () => {
      active = false;
    };
  }, []);

  // Plan gelince odak sonuca taşınır (tarayıcı onu görünür alana kaydırır).
  useEffect(() => {
    const target = focusAfterPlan.current;
    if (!plan || !target) return;
    focusAfterPlan.current = null;
    const el = document.getElementById(target) ?? document.getElementById(RESULT_HEADING_ID);
    if (!el) return;
    if (el.id === RESULT_HEADING_ID) el.tabIndex = -1;
    el.focus();
  }, [plan]);

  const cityList = splitCities(cities);
  const minNights = Math.max(1, Math.min(cityList.length, MAX_NIGHTS));
  const nights = Number(days);
  const planStart = startDate || isoDay(14);
  const lastCheckOut =
    Number.isInteger(nights) &&
    nights >= minNights &&
    nights <= MAX_NIGHTS &&
    /^\d{4}-\d{2}-\d{2}$/.test(planStart)
      ? addIsoDays(planStart, nights)
      : null;
  const daysHint = lastCheckOut
    ? t("form.daysHintCheckout", { min: minNights, date: f.date(lastCheckOut) })
    : t("form.daysHint", { min: minNights });
  const stale =
    plan !== null &&
    request !== null &&
    !sameRequest(request, toRequest({ cities, days, guests, startDate }));

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

  function toggleCity(city: string) {
    const key = normCity(city);
    const next = cityList.some((c) => normCity(c) === key)
      ? cityList.filter((c) => normCity(c) !== key)
      : [...cityList, city];
    setCities(next.join(", "));
  }

  function totalsText(stops: TripStop[]): string {
    return stayTotals(stops)
      .map((x) => f.money(x.total, x.currency))
      .join(" + ");
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setMessage(null);
    const list = splitCities(cities);
    const clientErrors = validate(list);
    if (Object.keys(clientErrors).length > 0) {
      showFieldErrors(clientErrors);
      return;
    }
    setFieldErrors({});
    await requestPlan({ cities: list, days: Number(days), guests: Number(guests), startDate });
  }

  /** `refreshIndex` verilirse fiyatlar saklanan istekle yenilenir; ayrılmış duraklar korunur. */
  async function requestPlan(req: PlanRequest, refreshIndex?: number) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await apiFetch<TripPlan>("/api/ai/trip-plan", {
        method: "POST",
        body: JSON.stringify({
          cities: req.cities,
          days: req.days,
          guests: req.guests,
          startDate: req.startDate || undefined,
          locale,
        }),
      });
      // Aynı istek aynı rota ve tarihleri üretir: ayrılmış durak eski konaklamasıyla kalır.
      const keptHeld: Record<number, string> = {};
      const stops = res.stops.map((s, i) => {
        const old = plan?.stops[i];
        if (refreshIndex === undefined || !held[i] || !old) return s;
        if (old.city !== s.city || old.checkIn !== s.checkIn || old.checkOut !== s.checkOut)
          return s;
        keptHeld[i] = held[i];
        return old;
      });
      // Durak başına tek idempotency anahtarı: yeniden deneme çift rezervasyon üretmez.
      setKeys(stops.map((_, i) => (keptHeld[i] ? keys[i] : newIdempotencyKey())));
      setHeld(keptHeld);
      setHeldUntil(
        Object.fromEntries(Object.entries(heldUntil).filter(([i]) => keptHeld[Number(i)]))
      );
      setHoldErrors({});
      setRequest(req);
      focusAfterPlan.current =
        refreshIndex === undefined ? RESULT_HEADING_ID : `trip-hold-${refreshIndex}`;
      setPlan({ ...res, stops });
      const amount = totalsText(stops);
      setMessage(
        refreshIndex !== undefined
          ? t("result.refreshed")
          : amount
            ? t("result.ready", { count: stops.length, amount })
            : t("result.readyNoStay", { count: stops.length })
      );
    } catch (err) {
      if (refreshIndex !== undefined) {
        setHoldErrors((prev) => ({
          ...prev,
          [refreshIndex]: { text: errorText(err), canRefresh: true },
        }));
        return;
      }
      const fieldErrorsFromServer = serverFieldErrors(err);
      if (fieldErrorsFromServer) showFieldErrors(fieldErrorsFromServer);
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  function refresh(index: number) {
    if (busy || !request) return;
    void requestPlan(request, index);
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
    if (!stop?.stay || holding !== null || busy || stale || held[index]) return;
    setHolding(index);
    setHoldErrors((prev) => {
      const next = { ...prev };
      delete next[index];
      return next;
    });
    try {
      const res = await apiFetch<HoldResponse>("/api/bookings", {
        method: "POST",
        headers: { "Idempotency-Key": keys[index] },
        body: JSON.stringify({
          propertyId: stop.stay.propertyId,
          roomId: stop.stay.roomId,
          checkIn: stop.checkIn,
          checkOut: stop.checkOut,
          // Teklif plan anındaki misafir sayısına bağlı; formdaki güncel değer değil.
          guestCount: request?.guests ?? Number(guests),
          quoteId: stop.stay.quoteId,
        }),
      });
      setHeld((prev) => ({ ...prev, [index]: res.booking.id }));
      const until = res.booking.holdExpiresAt;
      if (until) setHeldUntil((prev) => ({ ...prev, [index]: until }));
    } catch (err) {
      const canRefresh =
        err instanceof ApiError && (err.code === "QUOTE_EXPIRED" || err.status === 409);
      setHoldErrors((prev) => ({ ...prev, [index]: { text: errorText(err), canRefresh } }));
    } finally {
      setHolding(null);
    }
  }

  const holdable = plan ? plan.stops.filter((s) => s.stay).length : 0;
  const heldCount = Object.keys(held).length;
  const missing = plan ? plan.stops.filter((s) => !s.stay).map((s) => s.city) : [];
  const amount = plan ? totalsText(plan.stops) : "";

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
            {cityOptions.length > 0 && (
              <div role="group" aria-labelledby="trip-city-options-label" className="mt-2">
                <p id="trip-city-options-label" className="text-xs text-gray-600">
                  {t("form.cityOptions")}
                </p>
                <div className="mt-1 flex flex-wrap gap-2">
                  {cityOptions.map((city) => {
                    const selected = cityList.some((c) => normCity(c) === normCity(city));
                    return (
                      <button
                        key={city}
                        type="button"
                        aria-pressed={selected}
                        disabled={!selected && cityList.length >= MAX_CITIES}
                        onClick={() => toggleCity(city)}
                        className={`${CHIP_CLASS} ${selected ? CHIP_ON : CHIP_OFF}`}
                      >
                        {selected && <span aria-hidden="true">{"\u2713"}&nbsp;</span>}
                        {city}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <Field label={t("form.days")} id="trip-days" hint={daysHint} error={fieldErrors.days}>
            <input
              id="trip-days"
              type="number"
              inputMode="numeric"
              min={minNights}
              max={MAX_NIGHTS}
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
          <Field
            label={t("form.startDate")}
            id="trip-start"
            hint={t("form.startDateHint", { date: f.date(isoDay(14)) })}
            error={fieldErrors.startDate}
          >
            <input
              id="trip-start"
              type="date"
              min={isoDay(0)}
              className={inputClass}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </Field>
          <div className="flex items-end">
            <Button type="submit" busy={busy} className="w-full">
              {busy ? t("form.submitting") : t("form.submit")}
            </Button>
          </div>
        </form>
      </Card>

      <Status error={error} message={message} />

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
          {plan.narrative && (
            <details className="mt-3 text-sm">
              <summary className={`cursor-pointer font-medium text-gray-900 ${focusRing}`}>
                {t("result.narrativeSummary")}
              </summary>
              <p
                lang={plan.narrativeLocale ?? "tr"}
                className="mt-2 whitespace-pre-line text-gray-900"
              >
                {plan.narrative}
              </p>
            </details>
          )}
          <p className="mt-3 text-xs text-gray-600">
            {plan.holdMinutes
              ? t("result.noteTimed", { minutes: plan.holdMinutes })
              : t("result.note")}
          </p>
          {stale && (
            <p
              id={STALE_ID}
              className="mt-3 rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-gray-900"
            >
              {t("result.stale")}
            </p>
          )}
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
                        <span className="text-gray-900">
                          {heldUntil[i]
                            ? t("result.heldUntil", { time: f.time(heldUntil[i]) })
                            : t("result.held")}
                        </span>
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
                        id={`trip-hold-${i}`}
                        onClick={() => hold(i)}
                        busy={holding === i}
                        aria-disabled={(holding !== null && holding !== i) || stale || undefined}
                        aria-describedby={stale ? STALE_ID : undefined}
                        aria-label={
                          holding === i
                            ? t("result.holdingLabel", { city: s.city })
                            : t("result.holdLabel", { city: s.city })
                        }
                      >
                        {holding === i ? t("result.holding") : t("result.hold")}
                      </Button>
                    )}
                  </div>
                ) : (
                  <p className="mt-1 text-gray-700">{t("result.noStay")}</p>
                )}
                {holdErrors[i] && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <p role="alert" className="text-red-700">
                      <span aria-hidden="true">{ERROR_ICON} </span>
                      <span className="sr-only">{tc("errorPrefix")} </span>
                      {holdErrors[i].text}
                    </p>
                    {holdErrors[i].canRefresh && (
                      <Button variant="secondary" busy={busy} onClick={() => refresh(i)}>
                        {busy ? t("result.refreshing") : t("result.refresh")}
                      </Button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ol>
          {holdable > 0 && (
            <p className="mt-4 text-sm text-gray-900">
              {t("result.heldSummary", { held: heldCount, total: holdable })}
            </p>
          )}
          {amount && (
            <p className="mt-2 text-sm text-gray-900">
              {missing.length > 0
                ? t.rich("result.totalPartial", {
                    amount,
                    priced: holdable,
                    count: plan.stops.length,
                    b: (chunks) => <strong>{chunks}</strong>,
                  })
                : t.rich("result.total", { amount, b: (chunks) => <strong>{chunks}</strong> })}
            </p>
          )}
          {missing.length > 0 && (
            <p className="mt-1 text-sm text-gray-900">
              {t("result.missingStays", { cities: missing.join(", ") })}
            </p>
          )}
          {plan.quoteExpiresAt && (
            <p className="mt-1 text-xs text-gray-600">
              {t("result.quoteValidUntil", { time: f.time(plan.quoteExpiresAt) })}
            </p>
          )}
        </Card>
      )}
    </div>
  );
}
