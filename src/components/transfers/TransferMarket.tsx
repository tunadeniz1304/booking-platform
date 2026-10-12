"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { apiFetch, type SessionUser } from "@/lib/api-client";
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
  /** API dönerse sunucu kuralı esas alınır; yoksa istemci varsayılanları kullanılır. */
  transferable?: boolean;
  maxAskMinor?: number;
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

interface CreatedTransfer {
  claimUrl: string;
  askPriceMinor: number;
  currency: string;
  expiresAt: string;
}

const KNOWN_STATUSES = ["LISTED", "CLAIMED", "CAPTURE_PENDING", "COMPLETED", "CANCELLED", "FAILED"];

/** Sunucu varsayılanı (TRANSFER_MIN_HOURS_BEFORE_CHECKIN); girişe daha az kala devir reddedilir. */
const MIN_HOURS_BEFORE_CHECKIN = 48;

const linkClass = `font-semibold text-[#003580] underline ${focusRing}`;

/** Sunucu varsayılanı TRANSFER_MAX_ASK_RATIO=1: satış fiyatı ödenen tutarı aşamaz. */
function maxAskOf(b: MyBooking): number {
  return b.maxAskMinor ?? b.totalPriceMinor;
}

/** `/api/user/me` doğrulama bilgisini dönmüyorsa `undefined` (sunucu hatasıyla anlaşılır). */
function emailVerifiedOf(user: SessionUser & { emailVerified?: boolean }): boolean | undefined {
  return user.emailVerified;
}

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
      {session.status === "ready" && (
        <nav aria-label={t("jump.label")}>
          <ul className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
            <li>
              <a href="#sell" className={linkClass}>
                {t("sell.title")}
              </a>
            </li>
            <li>
              <a href="#discover" className={linkClass}>
                {t("jump.discover")}
              </a>
            </li>
            {session.user && (
              <li>
                <a href="#my-transfers" className={linkClass}>
                  {t("mine.title")}
                </a>
              </li>
            )}
          </ul>
        </nav>
      )}

      <Card title={t("discover.title")} id="discover">
        <p className="mb-3 text-sm text-gray-700">{t("discover.intro")}</p>
        <details className="mb-3 text-sm text-gray-800">
          <summary className={`cursor-pointer font-semibold text-gray-900 ${focusRing}`}>
            {t("discover.how.title")}
          </summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>{t("discover.how.step1")}</li>
            <li>{t("discover.how.step2")}</li>
            <li>{t("discover.how.step3")}</li>
            <li>{t("discover.how.step4")}</li>
          </ol>
        </details>
        <Status error={error} />
        {data === null && !error && (
          <p className="text-sm text-gray-600">{t("discover.loading")}</p>
        )}
        {data?.length === 0 && <p className="text-sm text-gray-700">{t("discover.empty")}</p>}
        {data && data.length > 0 && (
          <ul className="space-y-2">
            {data.map((item) => (
              <li key={item.id} className="rounded-md border p-3 text-sm text-gray-900">
                <strong>{item.property.title}</strong> · {item.property.city} ·{" "}
                {f.date(item.checkIn)} – {f.date(item.checkOut)} ·{" "}
                {t("discover.guests", { count: item.guestCount })}
                <span className="block">
                  {t.rich("discover.terms", {
                    ask: f.money(item.askPriceMinor, item.currency),
                    original: f.money(item.originalPriceMinor, item.currency),
                    seller: item.seller,
                    expires: f.dateTime(item.expiresAt),
                    b: (chunks) => <strong>{chunks}</strong>,
                  })}
                </span>
                <span className="mt-1 block text-xs text-gray-600">{t("discover.itemNote")}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {session.status === "ready" && session.user ? (
        <SellPanel userId={session.user.id} emailVerified={emailVerifiedOf(session.user)} />
      ) : session.status === "ready" ? (
        <p id="sell" className="text-sm text-gray-800">
          {t.rich("loginToSell", {
            link: (chunks) => (
              <Link href={loginHref("/transfers")} className={linkClass}>
                {chunks}
              </Link>
            ),
          })}
        </p>
      ) : null}
    </div>
  );
}

function SellPanel({ userId, emailVerified }: { userId: string; emailVerified?: boolean }) {
  const t = useTranslations("transfers");
  const f = useFormat();
  const errorText = useErrorText();
  const { confirm, confirmDialog } = useConfirm();
  const { data, error } = useLoader(() => apiFetch<MyBooking[]>("/api/bookings"));
  const transfers = useLoader(() => apiFetch<MyTransfer[]>("/api/transfers"));
  const [bookingId, setBookingId] = useState("");
  const [ask, setAsk] = useState("");
  const [askError, setAskError] = useState<string | null>(null);
  const [claimUrl, setClaimUrl] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ error?: string; message?: string }>({});
  const [needsVerify, setNeedsVerify] = useState(emailVerified === false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [withdrawing, setWithdrawing] = useState<string | null>(null);
  const [now] = useState(() => Date.now());

  // Geçmiş girişler listelenmez; girişe 48 saatten az kalanlar seçilemez (sunucu TOO_LATE).
  const upcoming = (data ?? []).filter(
    (b) => b.status === "CONFIRMED" && new Date(b.checkIn).getTime() > now
  );
  const canTransfer = (b: MyBooking) =>
    b.transferable ?? new Date(b.checkIn).getTime() - now > MIN_HOURS_BEFORE_CHECKIN * 3_600_000;
  const transferable = upcoming.filter(canTransfer);

  const mine = (transfers.data ?? []).filter((x) => x.sellerId === userId);
  const isActive = (x: MyTransfer) =>
    x.status === "LISTED" && new Date(x.expiresAt).getTime() > now;
  const activeByBooking = new Map(mine.filter(isActive).map((x) => [x.bookingId, x]));
  const titleOf = (id: string) => (data ?? []).find((b) => b.id === id)?.property.title;

  const selected = transferable.find((b) => b.id === bookingId) ?? transferable[0];
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
    const maxAsk = maxAskOf(selected);
    if (askPriceMinor > maxAsk) {
      setAskError(t("sell.askTooHigh", { max: f.money(maxAsk, selected.currency) }));
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
      const res = await apiFetch<CreatedTransfer>("/api/transfers", {
        method: "POST",
        body: JSON.stringify({ bookingId: selected.id, askPriceMinor }),
      });
      setClaimUrl(res.claimUrl);
      setFeedback({
        message: t("sell.created", {
          amount: f.money(res.askPriceMinor, res.currency),
          expires: f.dateTime(res.expiresAt),
        }),
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
        {data === null && !error && (
          <p className="text-sm text-gray-600">{t("discover.loading")}</p>
        )}
        {data && transferable.length === 0 && (
          <p className="text-sm text-gray-700">
            {t("sell.none", { hours: MIN_HOURS_BEFORE_CHECKIN })}
          </p>
        )}
        {selected && (
          <form onSubmit={submit} aria-busy={busy} className="grid gap-3 md:grid-cols-3">
            <Field label={t("sell.booking")} id="sell-booking">
              <select
                id="sell-booking"
                className={inputClass}
                value={selected.id}
                onChange={(e) => setBookingId(e.target.value)}
              >
                {upcoming.map((b) => {
                  const allowed = canTransfer(b);
                  const listing = activeByBooking.get(b.id);
                  const suffix = !allowed
                    ? ` ${t("sell.tooLateSuffix", { hours: MIN_HOURS_BEFORE_CHECKIN })}`
                    : listing
                      ? ` ${t("sell.listedSuffix", { date: f.date(listing.expiresAt) })}`
                      : "";
                  return (
                    <option key={b.id} value={b.id} disabled={!allowed}>
                      {`${b.property.title} · ${f.date(b.checkIn)} · ${f.money(b.totalPriceMinor, b.currency)}${suffix}`}
                    </option>
                  );
                })}
              </select>
            </Field>
            <Field
              label={t("sell.askPrice", { currency: selected.currency })}
              id="sell-ask"
              hint={t("sell.askHint", { max: f.money(maxAskOf(selected), selected.currency) })}
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
              <Button
                type="submit"
                disabled={busy}
                className="w-full"
                aria-describedby="sell-submit-note"
              >
                {busy
                  ? t("sell.submitting")
                  : selectedListing
                    ? t("sell.submitNewLink")
                    : t("sell.submit")}
              </Button>
            </div>
            <p id="sell-submit-note" className="text-xs text-gray-600 md:col-span-3">
              {t("sell.keepNote")}
            </p>
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
