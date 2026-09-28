"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api-client";
import { toMinor } from "@/lib/money/money";
import { useFormat } from "@/i18n/use-format";
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
  askPriceMinor: number;
  originalPriceMinor: number;
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
  totalPriceMinor: number;
  currency: string;
  property: { title: string };
}

export default function TransferMarket() {
  const t = useTranslations("transfers");
  const f = useFormat();
  const session = useSession();
  const { data, error } = useLoader(() => apiFetch<DiscoverItem[]>("/api/transfers/discover"));

  return (
    <div className="space-y-6">
      <Card title={t("discover.title")} id="discover">
        <p className="mb-3 text-sm text-gray-700">{t("discover.intro")}</p>
        <Status error={error} />
        {data === null && !error && (
          <p className="text-sm text-gray-600">{t("discover.loading")}</p>
        )}
        {data?.length === 0 && <p className="text-sm text-gray-700">{t("discover.empty")}</p>}
        {data && data.length > 0 && (
          <ul className="space-y-2">
            {data.map((item) => (
              <li key={item.id} className="rounded-md border p-3 text-sm text-gray-900">
                <Link
                  href={`/property/${item.property.id}`}
                  className={`font-semibold text-[#003580] underline ${focusRing}`}
                >
                  {item.property.title}
                </Link>{" "}
                · {item.property.city} · {f.date(item.checkIn)} – {f.date(item.checkOut)} ·{" "}
                {t("discover.guests", { count: item.guestCount })}
                <span className="block">
                  {t.rich("discover.terms", {
                    ask: f.money(item.askPriceMinor, item.currency),
                    original: f.money(item.originalPriceMinor, item.currency),
                    seller: item.seller,
                    expires: f.date(item.expiresAt),
                    b: (chunks) => <strong>{chunks}</strong>,
                  })}
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
          {t.rich("loginToSell", {
            link: (chunks) => (
              <Link href="/login" className={`font-semibold text-[#003580] underline ${focusRing}`}>
                {chunks}
              </Link>
            ),
          })}
        </p>
      ) : null}
    </div>
  );
}

function SellPanel() {
  const t = useTranslations("transfers");
  const f = useFormat();
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
      const res = await apiFetch<{ claimUrl: string; askPriceMinor: number; currency: string }>(
        "/api/transfers",
        { method: "POST", body: JSON.stringify({ bookingId: selected.id, askPriceMinor }) }
      );
      setClaimUrl(res.claimUrl);
      setFeedback({
        message: t("sell.created", { amount: f.money(res.askPriceMinor, res.currency) }),
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
      setFeedback({ error: t("sell.copyFailed") });
    }
  }

  return (
    <Card title={t("sell.title")} id="sell">
      <Status error={error} />
      {data && confirmed.length === 0 && <p className="text-sm text-gray-700">{t("sell.none")}</p>}
      {confirmed.length > 0 && (
        <form onSubmit={submit} className="grid gap-3 md:grid-cols-3">
          <Field label={t("sell.booking")} id="sell-booking">
            <select
              id="sell-booking"
              className={inputClass}
              value={selected?.id ?? ""}
              onChange={(e) => setBookingId(e.target.value)}
            >
              {confirmed.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.property.title} · {f.date(b.checkIn)} ·{" "}
                  {f.money(b.totalPriceMinor, b.currency)}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label={t("sell.askPrice", { currency: selected?.currency ?? "TRY" })}
            id="sell-ask"
            hint={t("sell.askHint")}
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
              {t("sell.submit")}
            </Button>
          </div>
        </form>
      )}
      <div className="mt-3">
        <Status error={feedback.error} message={feedback.message} />
      </div>
      {claimUrl && (
        <div className="mt-3 rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-gray-900">
          <p className="font-semibold">{t("sell.linkOnce")}</p>
          <label htmlFor="claim-url" className="sr-only">
            {t("sell.linkLabel")}
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
              {t("sell.copy")}
            </Button>
            <Button variant="secondary" onClick={() => setClaimUrl(null)}>
              {t("sell.hide")}
            </Button>
            <span aria-live="polite" className="text-green-800">
              {copied ? t("sell.copied") : ""}
            </span>
          </div>
        </div>
      )}
    </Card>
  );
}
