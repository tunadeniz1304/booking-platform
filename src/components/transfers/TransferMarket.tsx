"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api-client";
import { parseAmountToMinor } from "@/lib/ui/amount-input";
import { useFormat } from "@/i18n/use-format";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { VerifyEmailNotice, isEmailNotVerified } from "@/components/transfers/ClaimForm";
import {
  Button,
  Card,
  Field,
  Status,
  focusRing,
  inputClass,
  loginHref,
  useErrorText,
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

interface MyTransfer {
  id: string;
  bookingId: string;
  status: string;
  askPriceMinor: number;
  currency: string;
  expiresAt: string;
  sellerId: string;
  booking: { checkIn: string; checkOut: string };
}

const KNOWN_STATUSES = ["LISTED", "CLAIMED", "CAPTURE_PENDING", "COMPLETED", "CANCELLED", "FAILED"];

function fractionDigits(currency: string): number {
  try {
    return (
      new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
        .maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
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
        <SellPanel userId={session.user.id} />
      ) : session.status === "ready" ? (
        <p className="text-sm text-gray-800">
          {t.rich("loginToSell", {
            link: (chunks) => (
              <Link
                href={loginHref("/transfers")}
                className={`font-semibold text-[#003580] underline ${focusRing}`}
              >
                {chunks}
              </Link>
            ),
          })}
        </p>
      ) : null}
    </div>
  );
}

function SellPanel({ userId }: { userId: string }) {
  const t = useTranslations("transfers");
  const f = useFormat();
  const errorText = useErrorText();
  const { confirm, confirmDialog } = useConfirm();
  const { data, error } = useLoader(() => apiFetch<MyBooking[]>("/api/bookings"));
  const transfers = useLoader(() => apiFetch<MyTransfer[]>("/api/transfers"));
  const confirmed = (data ?? []).filter((b) => b.status === "CONFIRMED");
  const [bookingId, setBookingId] = useState("");
  const [ask, setAsk] = useState("");
  const [askError, setAskError] = useState<string | null>(null);
  const [claimUrl, setClaimUrl] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ error?: string; message?: string }>({});
  const [needsVerify, setNeedsVerify] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [withdrawing, setWithdrawing] = useState<string | null>(null);
  const [now] = useState(() => Date.now());

  const mine = (transfers.data ?? []).filter((x) => x.sellerId === userId);
  const isActive = (x: MyTransfer) =>
    x.status === "LISTED" && new Date(x.expiresAt).getTime() > now;
  const activeByBooking = new Map(mine.filter(isActive).map((x) => [x.bookingId, x]));
  const titleOf = (id: string) => (data ?? []).find((b) => b.id === id)?.property.title;

  const selected = confirmed.find((b) => b.id === (bookingId || confirmed[0]?.id));
  const selectedListing = selected ? activeByBooking.get(selected.id) : undefined;

  // Tek seferlik bağlantı kopyalanmadan sayfadan ayrılırken tarayıcı uyarısı.
  useEffect(() => {
    if (!claimUrl || copied) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [claimUrl, copied]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!selected || busy) return;
    setFeedback({});
    setNeedsVerify(false);
    const askPriceMinor = parseAmountToMinor(ask, fractionDigits(selected.currency));
    if (askPriceMinor === null || askPriceMinor <= 0) {
      setAskError(t("sell.askInvalid"));
      document.getElementById("sell-ask")?.focus();
      return;
    }
    setAskError(null);
    if (
      selectedListing &&
      !(await confirm({
        title: t("sell.replaceTitle"),
        body: t("sell.replaceBody"),
        confirmLabel: t("sell.replaceConfirm"),
        tone: "danger",
      }))
    ) {
      return;
    }
    setBusy(true);
    setCopied(false);
    try {
      const res = await apiFetch<{ claimUrl: string; askPriceMinor: number; currency: string }>(
        "/api/transfers",
        { method: "POST", body: JSON.stringify({ bookingId: selected.id, askPriceMinor }) }
      );
      setClaimUrl(res.claimUrl);
      setFeedback({
        message: t("sell.created", { amount: f.money(res.askPriceMinor, res.currency) }),
      });
      transfers.reload();
    } catch (err) {
      if (isEmailNotVerified(err)) setNeedsVerify(true);
      setFeedback({ error: errorText(err) });
    } finally {
      setBusy(false);
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

  async function closeLink() {
    if (
      !copied &&
      !(await confirm({
        title: t("sell.closeTitle"),
        body: t("sell.closeBody"),
        confirmLabel: t("sell.closeConfirm"),
        tone: "danger",
      }))
    ) {
      return;
    }
    setClaimUrl(null);
  }

  async function withdraw(item: MyTransfer) {
    if (withdrawing) return;
    if (
      !(await confirm({
        title: t("mine.withdrawTitle"),
        body: t("mine.withdrawBody"),
        confirmLabel: t("mine.withdrawConfirm"),
        tone: "danger",
      }))
    ) {
      return;
    }
    setWithdrawing(item.id);
    setFeedback({});
    try {
      await apiFetch(`/api/transfers/${encodeURIComponent(item.id)}`, { method: "DELETE" });
      setFeedback({ message: t("mine.withdrawn") });
      if (selected?.id === item.bookingId) setClaimUrl(null);
      transfers.reload();
    } catch (err) {
      setFeedback({ error: errorText(err) });
    } finally {
      setWithdrawing(null);
    }
  }

  return (
    <>
      <Card title={t("sell.title")} id="sell">
        <Status error={error} />
        {data && confirmed.length === 0 && (
          <p className="text-sm text-gray-700">{t("sell.none")}</p>
        )}
        {confirmed.length > 0 && (
          <form onSubmit={submit} aria-busy={busy} className="grid gap-3 md:grid-cols-3">
            <Field label={t("sell.booking")} id="sell-booking">
              <select
                id="sell-booking"
                className={inputClass}
                value={selected?.id ?? ""}
                onChange={(e) => setBookingId(e.target.value)}
              >
                {confirmed.map((b) => {
                  const listing = activeByBooking.get(b.id);
                  const suffix = listing
                    ? ` ${t("sell.listedSuffix", { date: f.date(listing.expiresAt) })}`
                    : "";
                  return (
                    <option key={b.id} value={b.id}>
                      {`${b.property.title} · ${f.date(b.checkIn)} · ${f.money(b.totalPriceMinor, b.currency)}${suffix}`}
                    </option>
                  );
                })}
              </select>
            </Field>
            <Field
              label={t("sell.askPrice", { currency: selected?.currency ?? "TRY" })}
              id="sell-ask"
              hint={t("sell.askHint")}
              error={askError}
            >
              <input
                id="sell-ask"
                inputMode="decimal"
                autoComplete="off"
                className={inputClass}
                value={ask}
                required
                onChange={(e) => setAsk(e.target.value)}
              />
            </Field>
            <div className="flex items-end">
              <Button type="submit" disabled={busy} className="w-full">
                {busy
                  ? t("sell.submitting")
                  : selectedListing
                    ? t("sell.submitNewLink")
                    : t("sell.submit")}
              </Button>
            </div>
          </form>
        )}
        <div className="mt-3">
          <Status error={feedback.error} message={feedback.message} />
        </div>
        {needsVerify && <VerifyEmailNotice />}
        {claimUrl && (
          <div className="mt-3 rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-gray-900">
            <p className="font-semibold">{t("sell.linkOnce")}</p>
            <p className="mt-1">{t("sell.linkLost")}</p>
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
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <Button variant="secondary" onClick={copy}>
                {t("sell.copy")}
              </Button>
              <Button variant="secondary" onClick={closeLink}>
                {t("sell.hide")}
              </Button>
              <span aria-live="polite" className="text-green-800">
                {copied ? t("sell.copied") : ""}
              </span>
            </div>
          </div>
        )}
      </Card>

      <Card title={t("mine.title")} id="my-transfers">
        <Status error={transfers.error} />
        {transfers.data === null && !transfers.error && (
          <p className="text-sm text-gray-600">{t("discover.loading")}</p>
        )}
        {transfers.data && mine.length === 0 && (
          <p className="text-sm text-gray-700">{t("mine.empty")}</p>
        )}
        {mine.length > 0 && (
          <ul className="space-y-2">
            {mine.map((item) => {
              const active = isActive(item);
              const statusKey =
                item.status === "LISTED" && !active
                  ? "EXPIRED"
                  : KNOWN_STATUSES.includes(item.status)
                    ? item.status
                    : "OTHER";
              const title = titleOf(item.bookingId) ?? t("mine.booking");
              return (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm text-gray-900"
                >
                  <span>
                    <strong>{title}</strong> · {f.date(item.booking.checkIn)} –{" "}
                    {f.date(item.booking.checkOut)} · {f.money(item.askPriceMinor, item.currency)}
                    <span className="block text-gray-700">
                      {t(`mine.status.${statusKey}`)}
                      {active ? ` · ${t("mine.validUntil", { date: f.date(item.expiresAt) })}` : ""}
                    </span>
                  </span>
                  {active && (
                    <Button
                      variant="danger"
                      onClick={() => withdraw(item)}
                      disabled={withdrawing !== null}
                      aria-busy={withdrawing === item.id}
                      aria-label={t("mine.withdrawLabel", { title })}
                    >
                      {withdrawing === item.id ? t("mine.withdrawing") : t("mine.withdraw")}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      {confirmDialog}
    </>
  );
}
