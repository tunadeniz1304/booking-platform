"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-client";
import { toMinor } from "@/lib/money/money";
import { formatDate, formatDecimal, formatMinor } from "@/lib/ui/format";
import {
  Button,
  Card,
  Field,
  Status,
  errorMessage,
  focusRing,
  inputClass,
  useLoader,
  useSession,
} from "@/components/ui/ui";

interface DiscoverItem {
  id: string;
  askPrice: number;
  originalPrice: number;
  currency: string;
  expiresAt: string;
  seller: string;
  checkIn: string;
  checkOut: string;
  guestCount: number;
  property: { id: string; title: string; city: string };
}

interface MyBooking {
  id: string;
  status: string;
  checkIn: string;
  checkOut: string;
  totalPrice: string;
  currency: string;
  property: { title: string };
}

export default function TransferMarket() {
  const session = useSession();
  const { data, error } = useLoader(() => apiFetch<DiscoverItem[]>("/api/transfers/discover"));

  return (
    <div className="space-y-6">
      <Card title="Devredilen rezervasyonlar" id="discover">
        <p className="mb-3 text-sm text-gray-700">
          Satıcı adları maskelidir. Devralmak için satıcının size ilettiği özel bağlantıyı açın.
        </p>
        <Status error={error} />
        {data === null && !error && <p className="text-sm text-gray-600">Yükleniyor…</p>}
        {data?.length === 0 && <p className="text-sm text-gray-700">Şu an ilan yok.</p>}
        {data && data.length > 0 && (
          <ul className="space-y-2">
            {data.map((t) => (
              <li key={t.id} className="rounded-md border p-3 text-sm text-gray-900">
                <Link
                  href={`/property/${t.property.id}`}
                  className={`font-semibold text-[#003580] underline ${focusRing}`}
                >
                  {t.property.title}
                </Link>{" "}
                · {t.property.city} · {formatDate(t.checkIn)} – {formatDate(t.checkOut)} ·{" "}
                {t.guestCount} misafir
                <span className="block">
                  İstenen: <strong>{formatDecimal(t.askPrice, t.currency)}</strong> (orijinal{" "}
                  {formatDecimal(t.originalPrice, t.currency)}) · satıcı {t.seller} · son{" "}
                  {formatDate(t.expiresAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {session.status === "ready" && session.user ? (
        <SellPanel />
      ) : session.status === "ready" ? (
        <p className="text-sm text-gray-800">
          Kendi rezervasyonunuzu devretmek için{" "}
          <Link href="/login" className={`font-semibold text-[#003580] underline ${focusRing}`}>
            giriş yapın
          </Link>
          .
        </p>
      ) : null}
    </div>
  );
}

function SellPanel() {
  const { data, error } = useLoader(() => apiFetch<MyBooking[]>("/api/bookings"));
  const confirmed = (data ?? []).filter((b) => b.status === "CONFIRMED");
  const [bookingId, setBookingId] = useState("");
  const [ask, setAsk] = useState("");
  const [claimUrl, setClaimUrl] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ error?: string; message?: string }>({});
  const [copied, setCopied] = useState(false);

  const selected = confirmed.find((b) => b.id === (bookingId || confirmed[0]?.id));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setFeedback({});
    setCopied(false);
    try {
      const askPriceMinor = toMinor(ask.replace(",", "."), selected.currency);
      const res = await apiFetch<{ claimUrl: string; askPrice: number; currency: string }>(
        "/api/transfers",
        { method: "POST", body: JSON.stringify({ bookingId: selected.id, askPriceMinor }) }
      );
      setClaimUrl(res.claimUrl);
      setFeedback({
        message: `Devir ilanı açıldı (${formatMinor(res.askPrice, res.currency)}).`,
      });
    } catch (err) {
      setFeedback({ error: errorMessage(err) });
    }
  }

  async function copy() {
    if (!claimUrl) return;
    try {
      await navigator.clipboard.writeText(claimUrl);
      setCopied(true);
    } catch {
      setFeedback({ error: "Kopyalanamadı; bağlantıyı elle seçip kopyalayın." });
    }
  }

  return (
    <Card title="Rezervasyonumu devret" id="sell">
      <Status error={error} />
      {data && confirmed.length === 0 && (
        <p className="text-sm text-gray-700">Devredilebilir (onaylı) rezervasyonunuz yok.</p>
      )}
      {confirmed.length > 0 && (
        <form onSubmit={submit} className="grid gap-3 md:grid-cols-3">
          <Field label="Rezervasyon" id="sell-booking">
            <select
              id="sell-booking"
              className={inputClass}
              value={selected?.id ?? ""}
              onChange={(e) => setBookingId(e.target.value)}
            >
              {confirmed.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.property.title} · {formatDate(b.checkIn)} ·{" "}
                  {formatDecimal(b.totalPrice, b.currency)}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label={`İstek fiyatı (${selected?.currency ?? "TRY"})`}
            id="sell-ask"
            hint="Ödediğiniz tutarın üst sınırını aşamaz."
          >
            <input
              id="sell-ask"
              inputMode="decimal"
              className={inputClass}
              value={ask}
              required
              pattern="\d+([.,]\d{1,2})?"
              onChange={(e) => setAsk(e.target.value)}
            />
          </Field>
          <div className="flex items-end">
            <Button type="submit" className="w-full">
              Devret
            </Button>
          </div>
        </form>
      )}
      <div className="mt-3">
        <Status error={feedback.error} message={feedback.message} />
      </div>
      {claimUrl && (
        <div className="mt-3 rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-gray-900">
          <p className="font-semibold">
            Devir bağlantısı yalnızca şimdi gösterilir — kopyalayıp alıcıyla paylaşın.
          </p>
          <label htmlFor="claim-url" className="sr-only">
            Devir bağlantısı
          </label>
          <input
            id="claim-url"
            readOnly
            className={`${inputClass} font-mono text-xs`}
            value={claimUrl}
            onFocus={(e) => e.currentTarget.select()}
          />
          <div className="mt-2 flex items-center gap-3">
            <Button variant="secondary" onClick={copy}>
              Kopyala
            </Button>
            <Button variant="secondary" onClick={() => setClaimUrl(null)}>
              Gizle
            </Button>
            <span aria-live="polite" className="text-green-800">
              {copied ? "Kopyalandı." : ""}
            </span>
          </div>
        </div>
      )}
    </Card>
  );
}
