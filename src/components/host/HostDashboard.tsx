"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api-client";
import { isoDay } from "@/lib/ui/format";
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
import PromotionsPanel from "./PromotionsPanel";

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
  basePrice: string;
  currency: string;
  ratingAvg: number;
  rooms: HostRoom[];
}

interface HostBooking {
  id: string;
  status: string;
  checkIn: string;
  checkOut: string;
  totalPrice: string;
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

export default function HostDashboard() {
  const t = useTranslations("host");
  const tp = useTranslations("payouts");
  const f = useFormat();
  const statusLabel = (s: string) =>
    (BOOKING_STATUSES as readonly string[]).includes(s)
      ? t(`bookingStatus.${s as (typeof BOOKING_STATUSES)[number]}`)
      : s;
  const { data, error, reload } = useLoader(() =>
    Promise.all([
      apiFetch<HostProperty[]>("/api/host/properties"),
      apiFetch<HostBooking[]>("/api/host/bookings"),
    ])
  );
  const properties = data?.[0] ?? null;
  const bookings = data?.[1] ?? null;
  const load = reload;

  const titleOf = (id: string) => properties?.find((p) => p.id === id)?.title ?? id;

  return (
    <div className="space-y-6">
      <p>
        <Link
          href="/host/revenue"
          className={`text-sm font-semibold text-[#003580] hover:underline ${focusRing}`}
        >
          {t("dashboard.revenueLink")}
        </Link>
        {" · "}
        <Link
          href="/host/payouts"
          className={`text-sm font-semibold text-[#003580] hover:underline ${focusRing}`}
        >
          {tp("link")}
        </Link>
      </p>
      <Status error={error} />
      {properties === null && !error && (
        <p aria-live="polite" className="text-sm text-gray-600">
          {t("dashboard.loadingProperties")}
        </p>
      )}
      {properties?.length === 0 && (
        <p className="text-sm text-gray-700">{t("dashboard.noProperties")}</p>
      )}
      {properties?.map((p) => (
        <PropertyPanel key={p.id} property={p} onChanged={load} />
      ))}
      {properties && properties.length > 0 && <PromotionsPanel properties={properties} />}

      <Card title={t("bookings.title")} id="host-bookings">
        {bookings === null ? (
          <p className="text-sm text-gray-600">{t("bookings.loading")}</p>
        ) : bookings.length === 0 ? (
          <p className="text-sm text-gray-700">{t("bookings.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
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
                    <td className="py-2 pr-4">{f.decimal(b.totalPrice, b.currency)}</td>
                    <td className="py-2 pr-4">{statusLabel(b.status)}</td>
                    <td className="py-2">
                      {(b.status === "CONFIRMED" || b.status === "COMPLETED") && (
                        <Link
                          href={"/host/messages/" + b.id}
                          className="font-semibold text-[#003580] hover:underline"
                        >
                          {t("bookings.messagesLink")}
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function PropertyPanel({ property, onChanged }: { property: HostProperty; onChanged: () => void }) {
  const t = useTranslations("host");
  const f = useFormat();
  const p = property;
  const pid = `prop-${p.id}`;
  const [form, setForm] = useState({
    title: p.title,
    description: p.description,
    basePrice: String(Number(p.basePrice)),
    licenseNumber: p.licenseNumber ?? "",
    isActive: p.isActive,
  });
  const [status, setStatus] = useState<{ error?: string; message?: string }>({});
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setStatus({});
    try {
      const body: Record<string, unknown> = {
        title: form.title,
        description: form.description,
        basePrice: Number(form.basePrice),
        isActive: form.isActive,
      };
      if (form.licenseNumber.trim()) body.licenseNumber = form.licenseNumber.trim();
      await apiFetch(`/api/properties/${p.id}`, { method: "PATCH", body: JSON.stringify(body) });
      setStatus({ message: t("property.saved") });
      onChanged();
    } catch (err) {
      setStatus({ error: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={p.title} id={pid}>
      <p className="mb-4 text-sm text-gray-700">
        {t("property.basePrice", { price: f.decimal(p.basePrice, p.currency) })} ·{" "}
        {t("property.rating", { rating: p.ratingAvg.toFixed(1) })} ·{" "}
        {p.isActive ? t("property.published") : t("property.unpublished")} · {t("property.license")}{" "}
        {/* P1-10: kayıt doğrulaması yapılmamış ilan yayına alınamaz ve aramada görünmez. */}
        <span data-testid="license-status">{t(`licenseStatus.${p.licenseStatus}`)}</span>
      </p>
      <form onSubmit={save} className="grid gap-4 md:grid-cols-2">
        <Field label={t("property.fields.title")} id={`${pid}-title`}>
          <input
            id={`${pid}-title`}
            className={inputClass}
            value={form.title}
            minLength={2}
            maxLength={120}
            required
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </Field>
        <Field label={t("property.fields.basePrice", { currency: p.currency })} id={`${pid}-price`}>
          <input
            id={`${pid}-price`}
            type="number"
            min={1}
            step="0.01"
            className={inputClass}
            value={form.basePrice}
            required
            onChange={(e) => setForm({ ...form, basePrice: e.target.value })}
          />
        </Field>
        <div className="md:col-span-2">
          <Field label={t("property.fields.description")} id={`${pid}-desc`}>
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
        >
          <input
            id={`${pid}-license`}
            className={inputClass}
            value={form.licenseNumber}
            pattern="(0[1-9]|[1-7]\d|8[01])-\d{3,6}(-\d{4})?"
            onChange={(e) => setForm({ ...form, licenseNumber: e.target.value })}
          />
        </Field>
        <div className="flex items-center gap-2 self-center">
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
          <Button type="submit" disabled={busy}>
            {busy ? t("property.saving") : t("property.save")}
          </Button>
          <Status error={status.error} message={status.message} />
        </div>
      </form>

      <div className="mt-6 border-t pt-4">
        <h3 className="text-base font-semibold text-gray-900">{t("rooms.title")}</h3>
        <ul className="mt-2 space-y-1 text-sm text-gray-800">
          {p.rooms.map((r) => (
            <li key={r.id}>
              {r.name} · {t("rooms.capacity", { count: r.capacity })}{" "}
              {r.available ? "" : t("rooms.closed")}
            </li>
          ))}
        </ul>
        <AddRoomForm propertyId={p.id} onAdded={onChanged} />
      </div>

      {p.rooms.length > 0 && <CalendarForm rooms={p.rooms} propertyId={p.id} />}
      <PhotoUpload propertyId={p.id} onChanged={onChanged} />
      <ListingCopy propertyId={p.id} />
    </Card>
  );
}

function AddRoomForm({ propertyId, onAdded }: { propertyId: string; onAdded: () => void }) {
  const t = useTranslations("host");
  const id = `room-${propertyId}`;
  const [form, setForm] = useState(() => ({
    name: "",
    capacity: "2",
    bedType: t("rooms.add.defaultBedType"),
  }));
  const [priceModifier, setPriceModifier] = useState("0");
  const [status, setStatus] = useState<{ error?: string; message?: string }>({});

  async function submit(e: FormEvent) {
    e.preventDefault();
    setStatus({});
    try {
      await apiFetch(`/api/properties/${propertyId}/rooms`, {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          capacity: Number(form.capacity),
          bedType: form.bedType,
          priceModifier: Number(priceModifier),
        }),
      });
      setStatus({ message: t("rooms.add.added") });
      setForm({ ...form, name: "" });
      onAdded();
    } catch (err) {
      setStatus({ error: errorMessage(err) });
    }
  }

  return (
    <form
      onSubmit={submit}
      className="mt-4 grid gap-3 md:grid-cols-5"
      aria-label={t("rooms.add.ariaLabel")}
    >
      <Field label={t("rooms.add.name")} id={`${id}-name`}>
        <input
          id={`${id}-name`}
          className={inputClass}
          value={form.name}
          required
          maxLength={80}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </Field>
      <Field label={t("rooms.add.capacity")} id={`${id}-cap`}>
        <input
          id={`${id}-cap`}
          type="number"
          min={1}
          max={20}
          className={inputClass}
          value={form.capacity}
          required
          onChange={(e) => setForm({ ...form, capacity: e.target.value })}
        />
      </Field>
      <Field label={t("rooms.add.bedType")} id={`${id}-bed`}>
        <input
          id={`${id}-bed`}
          className={inputClass}
          value={form.bedType}
          required
          onChange={(e) => setForm({ ...form, bedType: e.target.value })}
        />
      </Field>
      <Field label={t("rooms.add.priceModifier")} id={`${id}-mod`}>
        <input
          id={`${id}-mod`}
          type="number"
          min={0}
          step="0.01"
          className={inputClass}
          value={priceModifier}
          onChange={(e) => setPriceModifier(e.target.value)}
        />
      </Field>
      <div className="flex items-end">
        <Button type="submit" variant="secondary" className="w-full">
          {t("rooms.add.submit")}
        </Button>
      </div>
      <div className="md:col-span-5">
        <Status error={status.error} message={status.message} />
      </div>
    </form>
  );
}

function CalendarForm({ rooms, propertyId }: { rooms: HostRoom[]; propertyId: string }) {
  const t = useTranslations("host");
  const id = `cal-${propertyId}`;
  const [roomId, setRoomId] = useState(rooms[0]?.id ?? "");
  const [from, setFrom] = useState(isoDay(1));
  const [to, setTo] = useState(isoDay(7));
  const [price, setPrice] = useState("");
  const [availability, setAvailability] = useState<"keep" | "open" | "close">("keep");
  const [status, setStatus] = useState<{ error?: string; message?: string }>({});

  async function submit(e: FormEvent) {
    e.preventDefault();
    setStatus({});
    const body: Record<string, unknown> = { from, to };
    if (price) body.price = Number(price);
    if (availability !== "keep") body.isAvailable = availability === "open";
    if (body.price === undefined && body.isAvailable === undefined) {
      setStatus({ error: t("calendar.noChange") });
      return;
    }
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
    }
  }

  return (
    <form onSubmit={submit} className="mt-6 border-t pt-4" aria-labelledby={`${id}-title`}>
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
        <Field label={t("calendar.price")} id={`${id}-price`}>
          <input
            id={`${id}-price`}
            type="number"
            min={1}
            step="0.01"
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
        <Button type="submit" variant="secondary">
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
      <Button variant="secondary" onClick={suggest} disabled={busy}>
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
              <span className="font-semibold">TR:</span> {draft.tr}
            </p>
            <p lang="en">
              <span className="font-semibold">EN:</span> {draft.en}
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

/** P1-10: fotoğraf yükleme — kalite skoru, duplikat ve düşük kalite uyarısı (engellemez). */
function PhotoUpload({ propertyId, onChanged }: { propertyId: string; onChanged: () => void }) {
  const t = useTranslations("host");
  const [result, setResult] = useState<PhotoUploadResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = `photo-${propertyId}`;

  async function upload(file: File) {
    setBusy(true);
    setError(null);
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
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(photoId: string) {
    setBusy(true);
    try {
      await apiFetch(`/api/host/properties/${propertyId}/photos/${photoId}`, { method: "DELETE" });
      setResult(null);
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 border-t pt-4">
      <label htmlFor={inputId} className="text-base font-semibold text-gray-900">
        {t("photos.title")}
      </label>
      <input
        id={inputId}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif"
        disabled={busy}
        className="mt-2 block text-sm text-gray-800"
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
                  className="font-medium underline"
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
    </div>
  );
}
