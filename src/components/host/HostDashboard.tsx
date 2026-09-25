"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-client";
import { formatDate, formatDecimal, isoDay } from "@/lib/ui/format";
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

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Beklemede",
  HELD: "Tutuldu",
  CONFIRMED: "Onaylandı",
  CANCELLED: "İptal",
  EXPIRED: "Süresi doldu",
  COMPLETED: "Tamamlandı",
};

/** P1-10: kayıt doğrulaması yapılmamış ilan yayına alınamaz ve aramada görünmez. */
const LICENSE_LABEL: Record<HostProperty["licenseStatus"], string> = {
  PENDING: "Doğrulama bekliyor",
  VERIFIED: "Doğrulandı",
  REJECTED: "Kayıtta bulunamadı",
};

export default function HostDashboard() {
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
          Gelir paneli: doluluk, ADR, RevPAR ve fiyat önerileri →
        </Link>
      </p>
      <Status error={error} />
      {properties === null && !error && (
        <p aria-live="polite" className="text-sm text-gray-600">
          Mülkler yükleniyor…
        </p>
      )}
      {properties?.length === 0 && <p className="text-sm text-gray-700">Henüz bir mülkünüz yok.</p>}
      {properties?.map((p) => (
        <PropertyPanel key={p.id} property={p} onChanged={load} />
      ))}

      <Card title="Rezervasyonlar" id="host-bookings">
        {bookings === null ? (
          <p className="text-sm text-gray-600">Yükleniyor…</p>
        ) : bookings.length === 0 ? (
          <p className="text-sm text-gray-700">Rezervasyon yok.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <caption className="sr-only">Mülklerinize ait rezervasyonlar</caption>
              <thead className="border-b text-gray-700">
                <tr>
                  <th scope="col" className="py-2 pr-4">
                    Mülk
                  </th>
                  <th scope="col" className="py-2 pr-4">
                    Giriş
                  </th>
                  <th scope="col" className="py-2 pr-4">
                    Çıkış
                  </th>
                  <th scope="col" className="py-2 pr-4">
                    Misafir
                  </th>
                  <th scope="col" className="py-2 pr-4">
                    Tutar
                  </th>
                  <th scope="col" className="py-2 pr-4">
                    Durum
                  </th>
                  <th scope="col" className="py-2">
                    <span className="sr-only">Mesajlar</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {bookings.map((b) => (
                  <tr key={b.id} className="border-b last:border-0">
                    <td className="py-2 pr-4">{titleOf(b.propertyId)}</td>
                    <td className="py-2 pr-4">{formatDate(b.checkIn)}</td>
                    <td className="py-2 pr-4">{formatDate(b.checkOut)}</td>
                    <td className="py-2 pr-4">{b.guestCount}</td>
                    <td className="py-2 pr-4">{formatDecimal(b.totalPrice, b.currency)}</td>
                    <td className="py-2 pr-4">{STATUS_LABEL[b.status] ?? b.status}</td>
                    <td className="py-2">
                      {(b.status === "CONFIRMED" || b.status === "COMPLETED") && (
                        <Link
                          href={"/host/messages/" + b.id}
                          className="font-semibold text-[#003580] hover:underline"
                        >
                          Mesajlar
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
      setStatus({ message: "Kaydedildi." });
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
        Taban fiyat: {formatDecimal(p.basePrice, p.currency)} · Puan {p.ratingAvg.toFixed(1)} ·{" "}
        {p.isActive ? "Yayında" : "Yayında değil"} · Belge:{" "}
        <span data-testid="license-status">{LICENSE_LABEL[p.licenseStatus]}</span>
      </p>
      <form onSubmit={save} className="grid gap-4 md:grid-cols-2">
        <Field label="Başlık" id={`${pid}-title`}>
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
        <Field label={`Taban gecelik fiyat (${p.currency})`} id={`${pid}-price`}>
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
          <Field label="Açıklama" id={`${pid}-desc`}>
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
          label="İzin belgesi no"
          id={`${pid}-license`}
          hint="İl plaka kodu + sıra no, ör. 34-12345. Belgesiz ilan yayınlanamaz."
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
            İlan yayında
          </label>
        </div>
        <div className="flex items-center gap-3 md:col-span-2">
          <Button type="submit" disabled={busy}>
            {busy ? "Kaydediliyor…" : "Kaydet"}
          </Button>
          <Status error={status.error} message={status.message} />
        </div>
      </form>

      <div className="mt-6 border-t pt-4">
        <h3 className="text-base font-semibold text-gray-900">Odalar</h3>
        <ul className="mt-2 space-y-1 text-sm text-gray-800">
          {p.rooms.map((r) => (
            <li key={r.id}>
              {r.name} · {r.capacity} kişi {r.available ? "" : "(kapalı)"}
            </li>
          ))}
        </ul>
        <AddRoomForm propertyId={p.id} onAdded={onChanged} />
      </div>

      {p.rooms.length > 0 && <CalendarForm rooms={p.rooms} propertyId={p.id} />}
      <ListingCopy propertyId={p.id} />
    </Card>
  );
}

function AddRoomForm({ propertyId, onAdded }: { propertyId: string; onAdded: () => void }) {
  const id = `room-${propertyId}`;
  const [form, setForm] = useState({ name: "", capacity: "2", bedType: "Çift kişilik" });
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
      setStatus({ message: "Oda eklendi." });
      setForm({ ...form, name: "" });
      onAdded();
    } catch (err) {
      setStatus({ error: errorMessage(err) });
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 grid gap-3 md:grid-cols-5" aria-label="Oda ekle">
      <Field label="Oda adı" id={`${id}-name`}>
        <input
          id={`${id}-name`}
          className={inputClass}
          value={form.name}
          required
          maxLength={80}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </Field>
      <Field label="Kapasite" id={`${id}-cap`}>
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
      <Field label="Yatak tipi" id={`${id}-bed`}>
        <input
          id={`${id}-bed`}
          className={inputClass}
          value={form.bedType}
          required
          onChange={(e) => setForm({ ...form, bedType: e.target.value })}
        />
      </Field>
      <Field label="Fiyat farkı" id={`${id}-mod`}>
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
          Oda ekle
        </Button>
      </div>
      <div className="md:col-span-5">
        <Status error={status.error} message={status.message} />
      </div>
    </form>
  );
}

function CalendarForm({ rooms, propertyId }: { rooms: HostRoom[]; propertyId: string }) {
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
      setStatus({ error: "Fiyat veya müsaitlik değişikliği girin." });
      return;
    }
    try {
      const res = await apiFetch<{ updated: number; created: number; skippedLocked: number }>(
        `/api/rooms/${roomId}/availability`,
        { method: "PUT", body: JSON.stringify(body) }
      );
      setStatus({
        message: `Güncellenen gece: ${res.updated}, eklenen: ${res.created}, rezervasyonlu olduğu için atlanan: ${res.skippedLocked}.`,
      });
    } catch (err) {
      setStatus({ error: errorMessage(err) });
    }
  }

  return (
    <form onSubmit={submit} className="mt-6 border-t pt-4" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="text-base font-semibold text-gray-900">
        Toplu takvim güncellemesi
      </h3>
      <div className="mt-2 grid gap-3 md:grid-cols-5">
        <Field label="Oda" id={`${id}-room`}>
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
        <Field label="Başlangıç" id={`${id}-from`}>
          <input
            id={`${id}-from`}
            type="date"
            className={inputClass}
            value={from}
            required
            onChange={(e) => setFrom(e.target.value)}
          />
        </Field>
        <Field label="Bitiş (dahil)" id={`${id}-to`}>
          <input
            id={`${id}-to`}
            type="date"
            className={inputClass}
            value={to}
            required
            onChange={(e) => setTo(e.target.value)}
          />
        </Field>
        <Field label="Gecelik fiyat (boş = değişmez)" id={`${id}-price`}>
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
        <Field label="Müsaitlik" id={`${id}-avail`}>
          <select
            id={`${id}-avail`}
            className={inputClass}
            value={availability}
            onChange={(e) => setAvailability(e.target.value as typeof availability)}
          >
            <option value="keep">Değiştirme</option>
            <option value="open">Satışa aç</option>
            <option value="close">Satışa kapat</option>
          </select>
        </Field>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button type="submit" variant="secondary">
          Takvimi güncelle
        </Button>
        <Status error={status.error} message={status.message} />
      </div>
    </form>
  );
}

function ListingCopy({ propertyId }: { propertyId: string }) {
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
        {busy ? "Öneri hazırlanıyor…" : "İlan metni önerisi"}
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
              Taslak (otomatik yayınlanmaz, düzenleyip onaylayın) <LlmBadge mode={mode} />
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
