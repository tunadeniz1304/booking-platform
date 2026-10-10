"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ApiError, apiFetch } from "@/lib/api-client";
import { isoDay } from "@/lib/ui/format";
import { parseAmountToMinor } from "@/lib/ui/amount-input";
import { useFormat } from "@/i18n/use-format";
import {
  Button,
  Card,
  Field,
  LlmBadge,
  Status,
  errorMessage,
  focusRing,
  inputClass,
  useLoader,
} from "@/components/ui/ui";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import DepositSettings from "./DepositSettings";
import PromotionsPanel from "./PromotionsPanel";
import AccessibilityPanel from "./AccessibilityPanel";
import { CURRENCIES, toMajorNumber } from "@/lib/money/money";

interface HostRoom {
  id: string;
  name: string;
  capacity: number;
  available: boolean;
}

interface HostProperty {
  id: string;
  title: string;
  description: string;
  isActive: boolean;
  licenseNumber: string | null;
  licenseStatus: "PENDING" | "VERIFIED" | "REJECTED";
  basePriceMinor: number;
  currency: string;
  ratingAvg: number;
  rooms: HostRoom[];
}

interface HostBooking {
  id: string;
  status: string;
  checkIn: string;
  checkOut: string;
  totalPriceMinor: number;
  currency: string;
  propertyId: string;
  roomId: string;
  guestCount: number;
}

const BOOKING_STATUSES = [
  "PENDING",
  "HELD",
  "CONFIRMED",
  "CANCELLED",
  "EXPIRED",
  "COMPLETED",
] as const;

const PROPERTY_TYPES = ["HOTEL", "APARTMENT", "VILLA", "HOSTEL", "BED_AND_BREAKFAST"] as const;

/** Bu sayıdan fazla ilan varsa başlığa göre süzme alanı gösterilir. */
const FILTER_THRESHOLD = 5;

const linkClass = `text-sm font-semibold text-[#003580] hover:underline ${focusRing}`;
/** Mobilde ≥44px dokunma hedefi; masaüstünde mevcut yoğunluk korunur. */
const navLinkClass = `inline-flex min-h-[44px] items-center sm:min-h-[24px] ${linkClass}`;

type FieldErrors = Record<string, string>;

/** Para birimi için ondalık basamak sayısı (JPY=0, TRY=2 …). */
function fractionDigitsOf(currency: string): number {
  try {
    return (
      new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
        .maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}

/** Kullanıcı girişini ("1.500", "1.500,50", "1500.5") minor birime çevirir; geçersizse null. */
function parseMinor(input: string, currency: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  return parseAmountToMinor(trimmed, fractionDigitsOf(currency));
}

/** İstek sözleşmesi ana birim bekler (ör. 1500.5). */
function minorToMajor(minor: number, currency: string): number {
  return minor / 10 ** fractionDigitsOf(currency);
}

/** Zod `flatten()` ayrıntısındaki alan hatalarının adları (sunucu metni değil, alan bağı için). */
function serverFieldKeys(err: unknown): string[] {
  if (!(err instanceof ApiError)) return [];
  const details = err.details as
    { fieldErrors?: Record<string, unknown[] | undefined> } | undefined;
  return Object.entries(details?.fieldErrors ?? {})
    .filter(([, v]) => Array.isArray(v) && v.length > 0)
    .map(([k]) => k);
}

/** Hatalı alanlardan ilkine odak taşır (alan sırası `order` ile verilir). */
function focusFirstInvalid(errors: FieldErrors, order: ReadonlyArray<[string, string]>) {
  const first = order.find(([key]) => errors[key]);
  if (!first) return;
  requestAnimationFrame(() => document.getElementById(first[1])?.focus());
}

export default function HostDashboard() {
  const t = useTranslations("host");
  const tp = useTranslations("payouts");
  const tr = useTranslations("resolution");
  const f = useFormat();
  const statusLabel = (s: string) =>
    (BOOKING_STATUSES as readonly string[]).includes(s)
      ? t(`bookingStatus.${s as (typeof BOOKING_STATUSES)[number]}`)
      : s;
  // Uçlar ayrı yüklenir: biri düşerse diğeri çalışmaya devam eder (F279).
  const propertiesLoader = useLoader(() => apiFetch<HostProperty[]>("/api/host/properties"));
  const bookingsLoader = useLoader(() => apiFetch<HostBooking[]>("/api/host/bookings"));
  const properties = propertiesLoader.data;
  const bookings = bookingsLoader.data;
  const load = propertiesLoader.reload;
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState("");

  const titleOf = (id: string) => properties?.find((p) => p.id === id)?.title ?? id;
  const query = filter.trim().toLocaleLowerCase();
  const visibleProperties =
    properties?.filter((p) => !query || p.title.toLocaleLowerCase().includes(query)) ?? [];
  const hasProperties = !!properties && properties.length > 0;

  return (
    <div className="space-y-6">
      <p className="flex flex-wrap gap-x-2">
        <Link href="/host/revenue" className={navLinkClass}>
          {t("dashboard.revenueLink")}
        </Link>
        <span aria-hidden="true">·</span>
        <Link href="/host/payouts" className={navLinkClass}>
          {tp("link")}
        </Link>
        <span aria-hidden="true">·</span>
        <Link href="/resolution" className={navLinkClass}>
          {tr("hostLink")}
        </Link>
      </p>

      {/* Sayfa içi atlama bağlantıları (F128/F278, WCAG 2.4.1). */}
      <nav aria-label={t("dashboard.sectionsNav")}>
        <ul className="flex flex-wrap gap-x-4">
          <li>
            <a href="#host-bookings" className={navLinkClass}>
              {t("dashboard.navBookings")}
            </a>
          </li>
          <li>
            <a href="#host-properties" className={navLinkClass}>
              {t("dashboard.navProperties")}
            </a>
          </li>
          {hasProperties && (
            <>
              <li>
                <a href="#host-promotions" className={navLinkClass}>
                  {t("dashboard.navPromotions")}
                </a>
              </li>
              <li>
                <a href="#host-accessibility" className={navLinkClass}>
                  {t("dashboard.navAccessibility")}
                </a>
              </li>
            </>
          )}
        </ul>
      </nav>

      {/* Sık kullanılan rezervasyonlar ve mesajlar en üstte (F278/F280). */}
      <Card title={t("bookings.title")} id="host-bookings">
        {bookingsLoader.error ? (
          <div className="flex flex-wrap items-center gap-3">
            <Status error={t("bookings.error")} />
            <Button variant="secondary" onClick={bookingsLoader.reload}>
              {t("dashboard.retry")}
            </Button>
          </div>
        ) : bookings === null ? (
          <p aria-live="polite" className="text-sm text-gray-600">
            {t("bookings.loading")}
          </p>
        ) : bookings.length === 0 ? (
          <p className="text-sm text-gray-700">{t("bookings.empty")}</p>
        ) : (
          <>
            {/* Mobil: kart listesi, tam genişlik "Mesajlar" bağlantısı. */}
            <ul className="space-y-3 md:hidden">
              {bookings.map((b) => (
                <li key={b.id} className="rounded-md border border-gray-200 p-3 text-sm">
                  <p className="font-semibold text-gray-900">{titleOf(b.propertyId)}</p>
                  <p className="text-gray-800">
                    {f.date(b.checkIn, "short")} – {f.date(b.checkOut, "short")} ·{" "}
                    {t("bookings.columns.guests")}: {b.guestCount}
                  </p>
                  <p className="text-gray-800">
                    {f.money(b.totalPriceMinor, b.currency)} · {statusLabel(b.status)}
                  </p>
                  {(b.status === "CONFIRMED" || b.status === "COMPLETED") && (
                    <Link
                      href={"/host/messages/" + b.id}
                      className={`mt-2 flex min-h-[44px] w-full items-center justify-center rounded-md border border-gray-200 ${linkClass}`}
                    >
                      {t("bookings.messagesLink")}
                      <span className="sr-only">: {titleOf(b.propertyId)}</span>
                    </Link>
                  )}
                </li>
              ))}
            </ul>
            <div
              className="relative hidden overflow-x-auto md:block"
              role="region"
              aria-label={t("bookings.caption")}
              tabIndex={0}
            >
              <table className="min-w-full text-left text-sm">
                <caption className="sr-only">{t("bookings.caption")}</caption>
                <thead className="border-b text-gray-700">
                  <tr>
                    <th scope="col" className="py-2 pr-4">
                      {t("bookings.columns.property")}
                    </th>
                    <th scope="col" className="py-2 pr-4">
                      {t("bookings.columns.checkIn")}
                    </th>
                    <th scope="col" className="py-2 pr-4">
                      {t("bookings.columns.checkOut")}
                    </th>
                    <th scope="col" className="py-2 pr-4">
                      {t("bookings.columns.guests")}
                    </th>
                    <th scope="col" className="py-2 pr-4">
                      {t("bookings.columns.amount")}
                    </th>
                    <th scope="col" className="py-2 pr-4">
                      {t("bookings.columns.status")}
                    </th>
                    <th scope="col" className="py-2">
                      <span className="sr-only">{t("bookings.columns.messages")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {bookings.map((b) => (
                    <tr key={b.id} className="border-b last:border-0">
                      <td className="py-2 pr-4">{titleOf(b.propertyId)}</td>
                      <td className="py-2 pr-4">{f.date(b.checkIn, "short")}</td>
                      <td className="py-2 pr-4">{f.date(b.checkOut, "short")}</td>
                      <td className="py-2 pr-4">{b.guestCount}</td>
                      <td className="py-2 pr-4">{f.money(b.totalPriceMinor, b.currency)}</td>
                      <td className="py-2 pr-4">{statusLabel(b.status)}</td>
                      <td className="py-2">
                        {(b.status === "CONFIRMED" || b.status === "COMPLETED") && (
                          <Link href={"/host/messages/" + b.id} className={linkClass}>
                            {t("bookings.messagesLink")}
                            <span className="sr-only">: {titleOf(b.propertyId)}</span>
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      <section id="host-properties" className="space-y-6" aria-labelledby="host-properties-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="host-properties-title" className="text-lg font-semibold text-gray-900">
            {t("dashboard.propertiesTitle")}
          </h2>
          {hasProperties && !creating && (
            <Button variant="secondary" onClick={() => setCreating(true)}>
              {t("dashboard.createNew")}
            </Button>
          )}
        </div>
        {propertiesLoader.error && (
          <div className="flex flex-wrap items-center gap-3">
            <Status error={propertiesLoader.error} />
            <Button variant="secondary" onClick={propertiesLoader.reload}>
              {t("dashboard.retry")}
            </Button>
          </div>
        )}
        {properties === null && !propertiesLoader.error && (
          <p aria-live="polite" className="text-sm text-gray-600">
            {t("dashboard.loadingProperties")}
          </p>
        )}
        {properties?.length === 0 && !creating && (
          <div className="space-y-3">
            <p className="text-sm text-gray-700">{t("dashboard.noProperties")}</p>
            <Button onClick={() => setCreating(true)}>{t("dashboard.createFirst")}</Button>
          </div>
        )}
        {creating && (
          <CreatePropertyForm
            onCancel={() => setCreating(false)}
            onCreated={() => {
              setCreating(false);
              load();
            }}
          />
        )}
        {properties && properties.length > FILTER_THRESHOLD && (
          <div className="max-w-sm">
            <Field
              label={t("dashboard.filterLabel")}
              id="host-property-filter"
              hint={t("dashboard.filterHint")}
            >
              <input
                id="host-property-filter"
                type="search"
                className={inputClass}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </Field>
          </div>
        )}
        {hasProperties && visibleProperties.length === 0 && (
          <p aria-live="polite" className="text-sm text-gray-700">
            {t("dashboard.filterEmpty")}
          </p>
        )}
        {visibleProperties.map((p, i) => (
          <PropertyPanel key={p.id} property={p} onChanged={load} defaultOpen={i === 0} />
        ))}
      </section>
      {properties && properties.length > 0 && <PromotionsPanel properties={properties} />}
      {properties && properties.length > 0 && <AccessibilityPanel properties={properties} />}
    </div>
  );
}

function CreatePropertyForm({
  onCreated,
  onCancel,
}: {
  onCreated: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("host");
  const id = "host-create";
  const [form, setForm] = useState(() => ({
    title: "",
    description: "",
    propertyType: "APARTMENT" as (typeof PROPERTY_TYPES)[number],
    city: "",
    country: t("create.defaultCountry"),
    basePrice: "",
    currency: "TRY" as string,
    licenseNumber: "",
    roomName: "",
    roomCapacity: "2",
    roomBedType: t("rooms.add.defaultBedType"),
  }));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<{ error?: string; message?: string }>({});
  const [kycRequired, setKycRequired] = useState(false);
  const [busy, setBusy] = useState(false);

  const order: ReadonlyArray<[string, string]> = [
    ["title", `${id}-name`],
    ["description", `${id}-desc`],
    ["propertyType", `${id}-type`],
    ["city", `${id}-city`],
    ["country", `${id}-country`],
    ["basePrice", `${id}-price`],
    ["currency", `${id}-currency`],
    ["licenseNumber", `${id}-license`],
    ["rooms", `${id}-room-name`],
  ];

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setStatus({});
    setKycRequired(false);
    const priceMinor = parseMinor(form.basePrice, form.currency);
    if (priceMinor === null || priceMinor <= 0) {
      const next = { basePrice: t("property.invalidAmount") };
      setErrors(next);
      focusFirstInvalid(next, order);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        title: form.title,
        description: form.description,
        propertyType: form.propertyType,
        city: form.city,
        country: form.country,
        basePrice: minorToMajor(priceMinor, form.currency),
        currency: form.currency,
        rooms: [
          {
            name: form.roomName,
            capacity: Number(form.roomCapacity),
            bedType: form.roomBedType,
          },
        ],
      };
      if (form.licenseNumber.trim()) body.licenseNumber = form.licenseNumber.trim();
      await apiFetch("/api/properties", { method: "POST", body: JSON.stringify(body) });
      setStatus({ message: t("create.created") });
      onCreated();
    } catch (err) {
      if (err instanceof ApiError && err.code === "IDENTITY_VERIFICATION_REQUIRED") {
        setKycRequired(true);
        return;
      }
      const keys = serverFieldKeys(err);
      if (keys.length > 0) {
        const next = Object.fromEntries(keys.map((k) => [k, t("form.fieldInvalid")]));
        setErrors(next);
        setStatus({ error: t("form.fieldErrorsSummary", { count: keys.length }) });
        focusFirstInvalid(next, order);
      } else {
        setStatus({ error: errorMessage(err) });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={t("create.title")} id={id}>
      <p className="mb-4 text-sm text-gray-700">{t("create.intro")}</p>
      <form
        onSubmit={submit}
        className="grid gap-4 md:grid-cols-2"
        aria-label={t("create.title")}
        aria-busy={busy}
      >
        <Field label={t("property.fields.title")} id={`${id}-name`} error={errors.title}>
          <input
            id={`${id}-name`}
            className={inputClass}
            value={form.title}
            minLength={2}
            maxLength={120}
            required
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </Field>
        <Field label={t("create.type")} id={`${id}-type`} error={errors.propertyType}>
          <select
            id={`${id}-type`}
            className={inputClass}
            value={form.propertyType}
            onChange={(e) =>
              setForm({ ...form, propertyType: e.target.value as (typeof PROPERTY_TYPES)[number] })
            }
          >
            {PROPERTY_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`create.types.${type}`)}
              </option>
            ))}
          </select>
        </Field>
        <div className="md:col-span-2">
          <Field
            label={t("property.fields.description")}
            id={`${id}-desc`}
            hint={t("create.descriptionHint")}
            error={errors.description}
          >
            <textarea
              id={`${id}-desc`}
              rows={4}
              className={inputClass}
              value={form.description}
              minLength={10}
              maxLength={5000}
              required
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </Field>
        </div>
        <Field label={t("create.city")} id={`${id}-city`} error={errors.city}>
          <input
            id={`${id}-city`}
            className={inputClass}
            value={form.city}
            autoComplete="address-level2"
            maxLength={100}
            required
            onChange={(e) => setForm({ ...form, city: e.target.value })}
          />
        </Field>
        <Field label={t("create.country")} id={`${id}-country`} error={errors.country}>
          <input
            id={`${id}-country`}
            className={inputClass}
            value={form.country}
            autoComplete="country-name"
            maxLength={100}
            required
            onChange={(e) => setForm({ ...form, country: e.target.value })}
          />
        </Field>
        <Field
          label={t("create.basePrice")}
          id={`${id}-price`}
          hint={t("property.fields.basePriceHint")}
          error={errors.basePrice}
        >
          <input
            id={`${id}-price`}
            type="text"
            inputMode="decimal"
            className={inputClass}
            value={form.basePrice}
            required
            onChange={(e) => setForm({ ...form, basePrice: e.target.value })}
          />
        </Field>
        <Field label={t("create.currency")} id={`${id}-currency`} error={errors.currency}>
          <select
            id={`${id}-currency`}
            className={inputClass}
            value={form.currency}
            onChange={(e) => setForm({ ...form, currency: e.target.value })}
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <div className="md:col-span-2">
          <Field
            label={t("property.fields.licenseNumber")}
            id={`${id}-license`}
            hint={t("property.fields.licenseHint")}
            error={errors.licenseNumber}
          >
            <input
              id={`${id}-license`}
              className={inputClass}
              value={form.licenseNumber}
              pattern="(0[1-9]|[1-7]\d|8[01])-\d{3,6}(-\d{4})?"
              onChange={(e) => setForm({ ...form, licenseNumber: e.target.value })}
            />
          </Field>
        </div>
        <fieldset className="grid gap-4 md:col-span-2 md:grid-cols-3">
          <legend className="mb-2 text-base font-semibold text-gray-900">
            {t("create.firstRoom")}
          </legend>
          <Field label={t("rooms.add.name")} id={`${id}-room-name`} error={errors.rooms}>
            <input
              id={`${id}-room-name`}
              className={inputClass}
              value={form.roomName}
              required
              maxLength={80}
              onChange={(e) => setForm({ ...form, roomName: e.target.value })}
            />
          </Field>
          <Field label={t("rooms.add.capacity")} id={`${id}-room-cap`}>
            <input
              id={`${id}-room-cap`}
              type="number"
              inputMode="numeric"
              min={1}
              max={20}
              className={inputClass}
              value={form.roomCapacity}
              required
              onChange={(e) => setForm({ ...form, roomCapacity: e.target.value })}
            />
          </Field>
          <Field label={t("rooms.add.bedType")} id={`${id}-room-bed`}>
            <input
              id={`${id}-room-bed`}
              className={inputClass}
              value={form.roomBedType}
              required
              maxLength={60}
              onChange={(e) => setForm({ ...form, roomBedType: e.target.value })}
            />
          </Field>
        </fieldset>
        <div className="flex flex-wrap items-center gap-3 md:col-span-2">
          <Button type="submit" disabled={busy} aria-busy={busy}>
            {busy ? t("create.submitting") : t("create.submit")}
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
            {t("create.cancel")}
          </Button>
          <Status error={status.error} message={status.message} />
        </div>
        {kycRequired && (
          <div aria-live="polite" className="text-sm text-gray-800 md:col-span-2">
            <p>{t("create.kycRequired")}</p>
            <Link href="/account" className={navLinkClass}>
              {t("create.kycLink")}
            </Link>
          </div>
        )}
      </form>
    </Card>
  );
}

function PropertyPanel({
  property,
  onChanged,
  defaultOpen,
}: {
  property: HostProperty;
  onChanged: () => void;
  defaultOpen: boolean;
}) {
  const t = useTranslations("host");
  const f = useFormat();
  const { confirm, confirmDialog } = useConfirm();
  const p = property;
  const pid = `prop-${p.id}`;
  const [open, setOpen] = useState(defaultOpen);
  const [form, setForm] = useState({
    title: p.title,
    description: p.description,
    // Form girişi ana birimde (istek sözleşmesi `basePrice`); gösterim minor-unit'ten türetilir.
    basePrice: String(toMajorNumber(p.basePriceMinor, p.currency)),
    licenseNumber: p.licenseNumber ?? "",
    isActive: p.isActive,
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<{ error?: string; message?: string }>({});
  const [busy, setBusy] = useState(false);

  // Kart başlığı (h2) `${pid}-title` id'sini kullanır; alan id'leri bununla çakışmamalı (F130/F283).
  const order: ReadonlyArray<[string, string]> = [
    ["title", `${pid}-name`],
    ["basePrice", `${pid}-price`],
    ["description", `${pid}-desc`],
    ["licenseNumber", `${pid}-license`],
  ];
  const priceMinor = parseMinor(form.basePrice, p.currency);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setStatus({});
    if (priceMinor === null || priceMinor <= 0) {
      const next = { basePrice: t("property.invalidAmount") };
      setErrors(next);
      focusFirstInvalid(next, order);
      return;
    }
    setErrors({});
    // Büyük fiyat değişikliğinde (±%50) onay: "1.500" yerine "1,5" gibi yazım hatalarını yakalar.
    const ratio = priceMinor / p.basePriceMinor;
    if (
      p.basePriceMinor > 0 &&
      (ratio < 0.5 || ratio > 1.5) &&
      !(await confirm({
        title: t("property.priceConfirm.title"),
        body: t("property.priceConfirm.body", {
          from: f.money(p.basePriceMinor, p.currency),
          to: f.money(priceMinor, p.currency),
        }),
        confirmLabel: t("property.priceConfirm.confirm"),
        tone: "primary",
      }))
    ) {
      return;
    }
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        title: form.title,
        description: form.description,
        basePrice: minorToMajor(priceMinor, p.currency),
        isActive: form.isActive,
      };
      if (form.licenseNumber.trim()) body.licenseNumber = form.licenseNumber.trim();
      await apiFetch(`/api/properties/${p.id}`, { method: "PATCH", body: JSON.stringify(body) });
      setStatus({ message: t("property.saved") });
      onChanged();
    } catch (err) {
      const keys = serverFieldKeys(err);
      if (keys.length > 0) {
        const next = Object.fromEntries(keys.map((k) => [k, t("form.fieldInvalid")]));
        setErrors(next);
        setStatus({ error: t("form.fieldErrorsSummary", { count: keys.length }) });
        focusFirstInvalid(next, order);
      } else {
        setStatus({ error: errorMessage(err) });
      }
    } finally {
      setBusy(false);
    }
  }

  // Aramada görünürlük = yayında + belge doğrulanmış (src/lib/compliance/listing.ts).
  const visibilityKey = !p.isActive
    ? "off"
    : p.licenseStatus === "VERIFIED"
      ? "live"
      : p.licenseStatus === "REJECTED"
        ? "rejected"
        : "pending";

  return (
    <Card title={p.title} id={pid}>
      <p className="text-sm text-gray-700">
        {t("property.basePrice", { price: f.money(p.basePriceMinor, p.currency) })} ·{" "}
        {t("property.rating", { rating: p.ratingAvg.toFixed(1) })} · {t("property.license")}{" "}
        {/* P1-10: kayıt doğrulaması yapılmamış ilan yayına alınamaz ve aramada görünmez. */}
        <span data-testid="license-status">{t(`licenseStatus.${p.licenseStatus}`)}</span>
      </p>
      <p className="mb-2 text-sm font-medium text-gray-900">
        {t(`property.visibility.${visibilityKey}`)}
      </p>
      <details open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
        <summary className={`inline-flex min-h-[44px] cursor-pointer items-center ${linkClass}`}>
          {t("property.manage")}
          <span className="sr-only">: {p.title}</span>
        </summary>
        {/* Kapalı kartın formları ve istekleri (depozito, fotoğraf) yalnız açılınca oluşturulur. */}
        {open && (
          <div className="mt-2">
            <form onSubmit={save} className="grid gap-4 md:grid-cols-2" aria-busy={busy}>
              <Field label={t("property.fields.title")} id={`${pid}-name`} error={errors.title}>
                <input
                  id={`${pid}-name`}
                  className={inputClass}
                  value={form.title}
                  minLength={2}
                  maxLength={120}
                  required
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                />
              </Field>
              <div>
                <Field
                  label={t("property.fields.basePrice", { currency: p.currency })}
                  id={`${pid}-price`}
                  hint={t("property.fields.basePriceHint")}
                  error={errors.basePrice}
                >
                  <input
                    id={`${pid}-price`}
                    type="text"
                    inputMode="decimal"
                    className={inputClass}
                    value={form.basePrice}
                    required
                    onChange={(e) => setForm({ ...form, basePrice: e.target.value })}
                  />
                </Field>
                <p aria-live="polite" className="mt-1 text-xs text-gray-700">
                  {priceMinor !== null &&
                    priceMinor > 0 &&
                    priceMinor !== p.basePriceMinor &&
                    t("property.pricePreview", {
                      price: f.money(priceMinor, p.currency),
                      previous: f.money(p.basePriceMinor, p.currency),
                    })}
                </p>
              </div>
              <div className="md:col-span-2">
                <Field
                  label={t("property.fields.description")}
                  id={`${pid}-desc`}
                  error={errors.description}
                >
                  <textarea
                    id={`${pid}-desc`}
                    rows={4}
                    className={inputClass}
                    value={form.description}
                    minLength={10}
                    maxLength={5000}
                    required
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                  />
                </Field>
              </div>
              <Field
                label={t("property.fields.licenseNumber")}
                id={`${pid}-license`}
                hint={t("property.fields.licenseHint")}
                error={errors.licenseNumber}
              >
                <input
                  id={`${pid}-license`}
                  className={inputClass}
                  value={form.licenseNumber}
                  pattern="(0[1-9]|[1-7]\d|8[01])-\d{3,6}(-\d{4})?"
                  onChange={(e) => setForm({ ...form, licenseNumber: e.target.value })}
                />
              </Field>
              <div className="flex min-h-[44px] items-center gap-2 self-center">
                <input
                  id={`${pid}-active`}
                  type="checkbox"
                  className={`h-4 w-4 ${focusRing}`}
                  checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                />
                <label htmlFor={`${pid}-active`} className="text-sm text-gray-800">
                  {t("property.fields.isActive")}
                </label>
              </div>
              <div className="flex items-center gap-3 md:col-span-2">
                <Button type="submit" disabled={busy} aria-busy={busy}>
                  {busy ? t("property.saving") : t("property.save")}
                </Button>
                <Status error={status.error} message={status.message} />
              </div>
            </form>

            <div className="mt-6 border-t pt-4">
              <h3 className="text-base font-semibold text-gray-900">{t("rooms.title")}</h3>
              <RoomList propertyId={p.id} rooms={p.rooms} onChanged={onChanged} />
              <AddRoomForm propertyId={p.id} currency={p.currency} onAdded={onChanged} />
            </div>

            {p.rooms.length > 0 && (
              <CalendarForm rooms={p.rooms} propertyId={p.id} currency={p.currency} />
            )}
            <PhotoUpload propertyId={p.id} onChanged={onChanged} />
            <ListingCopy propertyId={p.id} />
            <DepositSettings propertyId={p.id} />
          </div>
        )}
      </details>
      {confirmDialog}
    </Card>
  );
}

/** Odalar: satışa kapatma/açma (PATCH /api/properties/[id]/rooms). */
function RoomList({
  propertyId,
  rooms,
  onChanged,
}: {
  propertyId: string;
  rooms: HostRoom[];
  onChanged: () => void;
}) {
  const t = useTranslations("host");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [status, setStatus] = useState<{ error?: string; message?: string }>({});

  async function toggle(room: HostRoom) {
    if (pendingId) return;
    setPendingId(room.id);
    setStatus({});
    try {
      await apiFetch(`/api/properties/${propertyId}/rooms`, {
        method: "PATCH",
        body: JSON.stringify({ roomId: room.id, available: !room.available }),
      });
      setStatus({ message: t("rooms.updated") });
      onChanged();
    } catch (err) {
      setStatus({ error: errorMessage(err) });
    } finally {
      setPendingId(null);
    }
  }

  return (
    <>
      <ul className="mt-2 space-y-1 text-sm text-gray-800">
        {rooms.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-x-3">
            <span>
              {r.name} · {t("rooms.capacity", { count: r.capacity })}{" "}
              {r.available ? "" : t("rooms.closed")}
            </span>
            <Button
              variant="secondary"
              className="min-h-[44px] sm:min-h-0"
              disabled={pendingId !== null}
              aria-busy={pendingId === r.id}
              onClick={() => void toggle(r)}
            >
              {r.available ? t("rooms.closeSale") : t("rooms.openSale")}
              <span className="sr-only">: {r.name}</span>
            </Button>
          </li>
        ))}
      </ul>
      <Status error={status.error} message={status.message} />
    </>
  );
}

function AddRoomForm({
  propertyId,
  currency,
  onAdded,
}: {
  propertyId: string;
  currency: string;
  onAdded: () => void;
}) {
  const t = useTranslations("host");
  const id = `room-${propertyId}`;
  const [form, setForm] = useState(() => ({
    name: "",
    capacity: "2",
    bedType: t("rooms.add.defaultBedType"),
  }));
  const [priceModifier, setPriceModifier] = useState("0");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<{ error?: string; message?: string }>({});
  const [busy, setBusy] = useState(false);

  const order: ReadonlyArray<[string, string]> = [
    ["name", `${id}-name`],
    ["capacity", `${id}-cap`],
    ["bedType", `${id}-bed`],
    ["priceModifier", `${id}-mod`],
  ];

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setStatus({});
    const modifierMinor = priceModifier.trim() === "" ? 0 : parseMinor(priceModifier, currency);
    if (modifierMinor === null || modifierMinor < 0) {
      const next = { priceModifier: t("property.invalidAmount") };
      setErrors(next);
      focusFirstInvalid(next, order);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await apiFetch(`/api/properties/${propertyId}/rooms`, {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          capacity: Number(form.capacity),
          bedType: form.bedType,
          priceModifier: minorToMajor(modifierMinor, currency),
        }),
      });
      setStatus({ message: t("rooms.add.added") });
      setForm({ ...form, name: "" });
      onAdded();
    } catch (err) {
      const keys = serverFieldKeys(err);
      if (keys.length > 0) {
        const next = Object.fromEntries(keys.map((k) => [k, t("form.fieldInvalid")]));
        setErrors(next);
        setStatus({ error: t("form.fieldErrorsSummary", { count: keys.length }) });
        focusFirstInvalid(next, order);
      } else {
        setStatus({ error: errorMessage(err) });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="mt-4 grid gap-3 md:grid-cols-5"
      aria-label={t("rooms.add.ariaLabel")}
      aria-busy={busy}
    >
      <Field label={t("rooms.add.name")} id={`${id}-name`} error={errors.name}>
        <input
          id={`${id}-name`}
          className={inputClass}
          value={form.name}
          required
          maxLength={80}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </Field>
      <Field label={t("rooms.add.capacity")} id={`${id}-cap`} error={errors.capacity}>
        <input
          id={`${id}-cap`}
          type="number"
          inputMode="numeric"
          min={1}
          max={20}
          className={inputClass}
          value={form.capacity}
          required
          onChange={(e) => setForm({ ...form, capacity: e.target.value })}
        />
      </Field>
      <Field label={t("rooms.add.bedType")} id={`${id}-bed`} error={errors.bedType}>
        <input
          id={`${id}-bed`}
          className={inputClass}
          value={form.bedType}
          required
          onChange={(e) => setForm({ ...form, bedType: e.target.value })}
        />
      </Field>
      <Field
        label={t("rooms.add.priceModifier")}
        id={`${id}-mod`}
        hint={t("rooms.add.priceModifierHint")}
        error={errors.priceModifier}
      >
        <input
          id={`${id}-mod`}
          type="text"
          inputMode="decimal"
          className={inputClass}
          value={priceModifier}
          onChange={(e) => setPriceModifier(e.target.value)}
        />
      </Field>
      <div className="flex items-end">
        <Button
          type="submit"
          variant="secondary"
          className="w-full"
          disabled={busy}
          aria-busy={busy}
        >
          {busy ? t("rooms.add.adding") : t("rooms.add.submit")}
        </Button>
      </div>
      <div className="md:col-span-5">
        <Status error={status.error} message={status.message} />
      </div>
    </form>
  );
}

function CalendarForm({
  rooms,
  propertyId,
  currency,
}: {
  rooms: HostRoom[];
  propertyId: string;
  currency: string;
}) {
  const t = useTranslations("host");
  const id = `cal-${propertyId}`;
  const [roomId, setRoomId] = useState(rooms[0]?.id ?? "");
  const [from, setFrom] = useState(isoDay(1));
  const [to, setTo] = useState(isoDay(7));
  const [price, setPrice] = useState("");
  const [availability, setAvailability] = useState<"keep" | "open" | "close">("keep");
  const [priceError, setPriceError] = useState<string | null>(null);
  const [status, setStatus] = useState<{ error?: string; message?: string }>({});
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setStatus({});
    setPriceError(null);
    const body: Record<string, unknown> = { from, to };
    if (price.trim()) {
      const minor = parseMinor(price, currency);
      if (minor === null || minor <= 0) {
        setPriceError(t("property.invalidAmount"));
        document.getElementById(`${id}-price`)?.focus();
        return;
      }
      body.price = minorToMajor(minor, currency);
    }
    if (availability !== "keep") body.isAvailable = availability === "open";
    if (body.price === undefined && body.isAvailable === undefined) {
      setPriceError(t("calendar.noChange"));
      document.getElementById(`${id}-price`)?.focus();
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch<{ updated: number; created: number; skippedLocked: number }>(
        `/api/rooms/${roomId}/availability`,
        { method: "PUT", body: JSON.stringify(body) }
      );
      setStatus({
        message: t("calendar.result", {
          updated: res.updated,
          created: res.created,
          skipped: res.skippedLocked,
        }),
      });
    } catch (err) {
      setStatus({ error: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="mt-6 border-t pt-4"
      aria-labelledby={`${id}-title`}
      aria-busy={busy}
    >
      <h3 id={`${id}-title`} className="text-base font-semibold text-gray-900">
        {t("calendar.title")}
      </h3>
      <div className="mt-2 grid gap-3 md:grid-cols-5">
        <Field label={t("calendar.room")} id={`${id}-room`}>
          <select
            id={`${id}-room`}
            className={inputClass}
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
          >
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("calendar.from")} id={`${id}-from`}>
          <input
            id={`${id}-from`}
            type="date"
            className={inputClass}
            value={from}
            required
            onChange={(e) => setFrom(e.target.value)}
          />
        </Field>
        <Field label={t("calendar.to")} id={`${id}-to`}>
          <input
            id={`${id}-to`}
            type="date"
            className={inputClass}
            value={to}
            required
            onChange={(e) => setTo(e.target.value)}
          />
        </Field>
        <Field
          label={t("calendar.price")}
          id={`${id}-price`}
          hint={t("calendar.priceHint")}
          error={priceError}
        >
          <input
            id={`${id}-price`}
            type="text"
            inputMode="decimal"
            className={inputClass}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </Field>
        <Field label={t("calendar.availability")} id={`${id}-avail`}>
          <select
            id={`${id}-avail`}
            className={inputClass}
            value={availability}
            onChange={(e) => setAvailability(e.target.value as typeof availability)}
          >
            <option value="keep">{t("calendar.keep")}</option>
            <option value="open">{t("calendar.open")}</option>
            <option value="close">{t("calendar.close")}</option>
          </select>
        </Field>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button type="submit" variant="secondary" disabled={busy} aria-busy={busy}>
          {t("calendar.submit")}
        </Button>
        <Status error={status.error} message={status.message} />
      </div>
    </form>
  );
}

function ListingCopy({ propertyId }: { propertyId: string }) {
  const t = useTranslations("host");
  const [draft, setDraft] = useState<{ tr: string; en: string } | null>(null);
  const [mode, setMode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function suggest() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{ draft: { tr: string; en: string }; llmMode: string }>(
        "/api/ai/listing-copy",
        { method: "POST", body: JSON.stringify({ propertyId }) }
      );
      setDraft(res.draft);
      setMode(res.llmMode);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 border-t pt-4">
      <h3 className="mb-2 text-base font-semibold text-gray-900">{t("listingCopy.title")}</h3>
      <Button variant="secondary" onClick={suggest} disabled={busy} aria-busy={busy}>
        {busy ? t("listingCopy.suggesting") : t("listingCopy.suggest")}
      </Button>
      <div aria-live="polite" className="mt-3 space-y-2">
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        {draft && (
          <div className="space-y-2 rounded-md bg-gray-50 p-3 text-sm text-gray-900">
            <p className="flex items-center gap-2 font-medium">
              {t("listingCopy.draft")} <LlmBadge mode={mode} />
            </p>
            <p>
              <span className="font-semibold">{t("listingCopy.trLabel")}</span>{" "}
              <span lang="tr">{draft.tr}</span>
            </p>
            <p>
              <span className="font-semibold">{t("listingCopy.enLabel")}</span>{" "}
              <span lang="en">{draft.en}</span>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

interface PhotoUploadResult {
  photo: { id: string; url: string; quality: { qualityScore: number } };
  duplicate: { scope: "SAME_PROPERTY" | "OWN_LISTING" | "OTHER_LISTING"; distance: number } | null;
  warnings: Array<"DUPLICATE" | "LOW_QUALITY">;
  visual: { enabled: boolean; reason: string | null };
}

interface HostPhoto {
  id: string;
  url: string;
  qualityScore: number | null;
}

/** P1-10: fotoğraf yükleme — kalite skoru, duplikat ve düşük kalite uyarısı (engellemez). */
function PhotoUpload({ propertyId, onChanged }: { propertyId: string; onChanged: () => void }) {
  const t = useTranslations("host");
  const { confirm, confirmDialog } = useConfirm();
  const [result, setResult] = useState<PhotoUploadResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const inputId = `photo-${propertyId}`;
  const headingId = `${inputId}-heading`;
  const photosLoader = useLoader(
    () => apiFetch<{ photos: HostPhoto[] }>(`/api/host/properties/${propertyId}/photos`),
    [propertyId]
  );
  const photos = photosLoader.data?.photos ?? null;

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    setMessage(null);
    setResult(null);
    try {
      const body = new FormData();
      body.append("file", file);
      setResult(
        await apiFetch<PhotoUploadResult>(`/api/host/properties/${propertyId}/photos`, {
          method: "POST",
          body,
        })
      );
      photosLoader.reload();
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(photoId: string) {
    if (busy) return;
    if (
      !(await confirm({
        title: t("photos.removeConfirm.title"),
        body: t("photos.removeConfirm.body"),
        confirmLabel: t("photos.removeConfirm.confirm"),
        tone: "danger",
      }))
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await apiFetch(`/api/host/properties/${propertyId}/photos/${photoId}`, { method: "DELETE" });
      if (result?.photo.id === photoId) setResult(null);
      setMessage(t("photos.removed"));
      photosLoader.reload();
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 border-t pt-4" aria-labelledby={headingId}>
      <h3 id={headingId} className="text-base font-semibold text-gray-900">
        {t("photos.title")}
      </h3>
      {photosLoader.error ? (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <Status error={photosLoader.error} />
          <Button variant="secondary" onClick={photosLoader.reload}>
            {t("dashboard.retry")}
          </Button>
        </div>
      ) : photos === null ? (
        <p className="mt-2 text-sm text-gray-600">{t("photos.loading")}</p>
      ) : (
        <>
          <p className="mt-2 text-sm text-gray-700">
            {t("photos.count", { count: photos.length })}
          </p>
          {photos.length > 0 && (
            <ul className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {photos.map((photo, i) => {
                const score =
                  photo.qualityScore === null ? null : Math.round(photo.qualityScore * 100);
                return (
                  <li key={photo.id} className="space-y-1 text-xs text-gray-700">
                    {/* eslint-disable-next-line @next/next/no-img-element -- host önizlemesi, optimize edilmez */}
                    <img
                      src={photo.url}
                      alt={t("photos.alt", { index: i + 1 })}
                      className="aspect-[4/3] w-full rounded-md object-cover"
                      loading="lazy"
                    />
                    {score !== null && <p>{t("photos.quality", { score })}</p>}
                    <Button
                      variant="secondary"
                      className="min-h-[44px] w-full sm:min-h-0"
                      disabled={busy}
                      onClick={() => void remove(photo.id)}
                    >
                      {t("photos.remove")}
                      <span className="sr-only">: {t("photos.alt", { index: i + 1 })}</span>
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
      <label htmlFor={inputId} className="mt-3 block text-sm font-medium text-gray-800">
        {t("photos.uploadLabel")}
      </label>
      <input
        id={inputId}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif"
        disabled={busy}
        className={`mt-1 block min-h-[44px] text-sm text-gray-800 ${focusRing}`}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
          e.target.value = "";
        }}
      />
      <div aria-live="polite" className="mt-2 space-y-1 text-sm">
        {busy && <p className="text-gray-700">{t("photos.uploading")}</p>}
        {error && (
          <p role="alert" className="text-red-700">
            {error}
          </p>
        )}
        {message && <p className="text-green-800">{message}</p>}
        {result && (
          <>
            <p className="text-gray-800">
              {t("photos.quality", { score: Math.round(result.photo.quality.qualityScore * 100) })}
            </p>
            {result.duplicate && (
              <p role="alert" className="text-amber-800">
                {t(`photos.duplicate.${result.duplicate.scope}`)}{" "}
                <button
                  type="button"
                  className={`inline-flex min-h-[44px] items-center font-medium underline sm:min-h-0 ${focusRing}`}
                  onClick={() => void remove(result.photo.id)}
                >
                  {t("photos.remove")}
                </button>
              </p>
            )}
            {result.warnings.includes("LOW_QUALITY") && (
              <p className="text-amber-800">{t("photos.lowQuality")}</p>
            )}
            {!result.visual.enabled && <p className="text-gray-600">{t("photos.visualOff")}</p>}
          </>
        )}
      </div>
      {confirmDialog}
    </section>
  );
}
