"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api-client";
import { useFormat } from "@/i18n/use-format";
import { Button, ErrorText, focusRing } from "@/components/ui/ui";

export interface WalletData {
  tier: number;
  completedStays: number;
  cashbackBps: number;
  staysToNextTier: number | null;
  nextTierBps: number | null;
  balances: Array<{
    currency: string;
    availableMinor: number;
    nextExpiryAt: string | null;
    /** En yakın son kullanma tarihinde düşecek tutar (yoksa lot'lardan hesaplanır). */
    nextExpiryMinor?: number;
  }>;
  lots: Array<{
    id: string;
    source: "CASHBACK" | "REFUND";
    currency: string;
    amountMinor: number;
    remainingMinor: number;
    expiresAt: string;
    expired: boolean;
    createdAt: string;
    /** Süre dolumuyla düşülen tutar (süpürme kalanı 0'a çeker). */
    expiredMinor?: number;
    bookingId?: string | null;
    propertyTitle?: string | null;
  }>;
  pendingCashback: Array<{
    bookingId: string;
    currency: string;
    bps: number;
    dueAt: string;
    estimatedMinor?: number | null;
    propertyTitle?: string | null;
  }>;
  /** Ödemede kullanılan kredi (harcama satırları). */
  spends?: Array<{
    id: string;
    bookingId: string;
    currency: string;
    amountMinor: number;
    status: "RESERVED" | "SPENT" | "RELEASED";
    createdAt: string;
    propertyTitle?: string | null;
  }>;
}

type WalletLot = WalletData["lots"][number];
type WalletSpend = NonNullable<WalletData["spends"]>[number];
type HistoryRow =
  { kind: "lot"; at: string; lot: WalletLot } | { kind: "spend"; at: string; spend: WalletSpend };

const TIER_STYLE = [
  "bg-gray-100 text-gray-800",
  "bg-gray-200 text-gray-900",
  "bg-amber-100 text-amber-900",
  "bg-indigo-100 text-indigo-900",
];

/** Sadakat seviyesi rozeti (hesap sayfası başlığı ve cüzdan kartı ortak). */
export function TierBadge({ tier }: { tier: number }) {
  const t = useTranslations("wallet");
  const name = t(`tier.${Math.min(3, Math.max(0, tier))}`);
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${TIER_STYLE[tier] ?? TIER_STYLE[0]}`}
    >
      <span className="sr-only">{`${t("tierPrefix")} `}</span>
      {t("tierBadge", { tier: name })}
    </span>
  );
}

/** Kredinin geldiği / harcandığı rezervasyona bağlantı. */
function BookingLink({ bookingId, title }: { bookingId: string; title?: string | null }) {
  const t = useTranslations("wallet");
  return (
    <Link
      href={`/booking/${bookingId}`}
      className={`inline-flex min-h-[24px] items-center font-semibold text-[#003580] underline ${focusRing}`}
    >
      {title ? t("bookingLink", { title }) : t("viewBooking")}
    </Link>
  );
}

/**
 * Hesap ▸ Cüzdan (P1-7): seviye rozeti, para birimi başına kullanılabilir kredi, tarih sıralı
 * kredi hareketleri (kazanım / harcama) ve iptal/şikâyet süresi bekleyen cashback'ler.
 */
export default function WalletPanel() {
  const t = useTranslations("wallet");
  const tc = useTranslations("common");
  const fmt = useFormat();
  const [data, setData] = useState<WalletData | null>(null);
  /** Art arda başarısız yükleme sayısı (0: hata yok); her hatada uyarı yeniden duyurulur. */
  const [failures, setFailures] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let active = true;
    apiFetch<WalletData>("/api/account/wallet")
      .then((d) => {
        if (!active) return;
        setData(d);
        setFailures(0);
        // Yeniden deneme düğmesi kaybolur; odak kartın başlığına taşınır.
        if (attempt > 0) headingRef.current?.focus();
      })
      .catch(() => active && setFailures((n) => n + 1))
      .finally(() => active && setRetrying(false));
    return () => {
      active = false;
    };
  }, [attempt]);

  const retry = () => {
    setRetrying(true);
    setAttempt((a) => a + 1);
  };

  const rate = (bps: number) => fmt.number(bps / 100, { maximumFractionDigits: 2 });

  const expiringMinor = (b: WalletData["balances"][number]): number => {
    if (b.nextExpiryMinor !== undefined) return b.nextExpiryMinor;
    return (data?.lots ?? [])
      .filter(
        (l) =>
          l.currency === b.currency &&
          !l.expired &&
          l.remainingMinor > 0 &&
          l.expiresAt === b.nextExpiryAt
      )
      .reduce((sum, l) => sum + l.remainingMinor, 0);
  };

  const lotStatus = (l: WalletLot): { text: string; lost: boolean } => {
    const lostMinor = (l.expiredMinor ?? 0) + (l.expired ? l.remainingMinor : 0);
    if (lostMinor > 0) {
      return {
        text: t("lots.expiredUnused", { amount: fmt.money(lostMinor, l.currency) }),
        lost: true,
      };
    }
    if (l.remainingMinor === 0) {
      // expiredMinor gelmediyse süresi geçmiş ₺0 lot belirsiz (harcandı ya da süpürüldü).
      return l.expired && l.expiredMinor === undefined
        ? { text: t("lots.expiryDate", { date: fmt.date(l.expiresAt, "long") }), lost: false }
        : { text: t("lots.used"), lost: false };
    }
    return { text: t("lots.expires", { date: fmt.date(l.expiresAt, "long") }), lost: false };
  };

  // Kazanım ve harcamalar tek listede, en yeni önce.
  const history: HistoryRow[] = [
    ...(data?.lots ?? []).map((lot): HistoryRow => ({ kind: "lot", at: lot.createdAt, lot })),
    ...(data?.spends ?? [])
      .filter((s) => s.status !== "RELEASED")
      .map((spend): HistoryRow => ({ kind: "spend", at: spend.createdAt, spend })),
  ];
  history.sort((a, b) => b.at.localeCompare(a.at));

  return (
    <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm" aria-labelledby="wallet-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2
          id="wallet-title"
          ref={headingRef}
          tabIndex={-1}
          className="text-xl font-semibold text-gray-900 focus:outline-none"
        >
          {t("title")}
        </h2>
        {data && <TierBadge tier={data.tier} />}
      </div>
      {failures > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {/* F2-44: ortak ErrorText; düğme `busy` tuttuğu için Status yerine ayrı. */}
          <ErrorText key={failures}>{t("loadFailed")}</ErrorText>
          <Button variant="secondary" busy={retrying} onClick={retry}>
            {tc("errorPage.retry")}
          </Button>
        </div>
      )}
      {!data && failures === 0 && <p className="mt-3 text-sm text-gray-500">{t("loading")}</p>}
      {data && (
        <div className="mt-4 space-y-5">
          <div className="text-sm text-gray-700">
            <p>{t("completedStays", { count: data.completedStays })}</p>
            <p>{t("cashbackRate", { rate: rate(data.cashbackBps) })}</p>
            <p className="text-gray-500">
              {data.staysToNextTier !== null && data.nextTierBps !== null
                ? t("nextTier", {
                    count: data.staysToNextTier,
                    tier: t(`tier.${data.tier + 1}`),
                    rate: rate(data.nextTierBps),
                  })
                : t("topTier")}
            </p>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-gray-900">{t("balance")}</h3>
            {data.balances.length === 0 ? (
              <p className="mt-1 text-sm text-gray-500">{t("noBalance")}</p>
            ) : (
              <>
                <ul className="mt-1 space-y-1">
                  {data.balances.map((b) => {
                    const expiring = expiringMinor(b);
                    return (
                      <li key={b.currency} className="flex flex-wrap items-baseline gap-2">
                        <span className="text-2xl font-bold text-gray-900">
                          {fmt.money(b.availableMinor, b.currency)}
                        </span>
                        {b.nextExpiryAt && (
                          <span className="text-xs text-amber-800">
                            {expiring > 0
                              ? t("nextExpiryAmount", {
                                  amount: fmt.money(expiring, b.currency),
                                  date: fmt.date(b.nextExpiryAt, "long"),
                                })
                              : t("nextExpiry", { date: fmt.date(b.nextExpiryAt, "long") })}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-1 text-sm text-gray-600">
                  {t("balanceHelp", { action: t("checkout.use") })}
                </p>
              </>
            )}
          </div>

          {data.pendingCashback.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-900">{t("pending.title")}</h3>
              <ul className="mt-1 divide-y divide-gray-100 text-sm text-gray-600">
                {data.pendingCashback.map((p) => (
                  <li key={p.bookingId} className="py-2">
                    {p.estimatedMinor != null && (
                      <p className="font-semibold text-gray-900">
                        {t("pending.estimate", { amount: fmt.money(p.estimatedMinor, p.currency) })}
                      </p>
                    )}
                    <p>
                      {t("pending.item", { date: fmt.date(p.dueAt, "long"), rate: rate(p.bps) })}
                    </p>
                    <BookingLink bookingId={p.bookingId} title={p.propertyTitle} />
                  </li>
                ))}
              </ul>
            </div>
          )}

          {history.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-900">{t("lots.title")}</h3>
              <ul className="mt-2 divide-y divide-gray-100 text-sm">
                {history.map((row) => {
                  if (row.kind === "spend") {
                    const s = row.spend;
                    return (
                      <li
                        key={`spend-${s.id}`}
                        className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 py-2"
                      >
                        <span className="font-medium text-gray-800">
                          {t(`lots.spend.${s.status}`)}
                        </span>
                        <span className="text-right font-semibold tabular-nums text-gray-900">
                          {t("lots.debit", { amount: fmt.money(s.amountMinor, s.currency) })}
                        </span>
                        <span className="col-span-2 text-gray-500">
                          {t("lots.spentOn", { date: fmt.date(s.createdAt, "medium") })}
                        </span>
                        <span className="col-span-2">
                          <BookingLink bookingId={s.bookingId} title={s.propertyTitle} />
                        </span>
                      </li>
                    );
                  }
                  const l = row.lot;
                  const status = lotStatus(l);
                  return (
                    <li
                      key={`lot-${l.id}`}
                      className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 py-2"
                    >
                      <span className="font-medium text-gray-800">
                        {t(`lots.source.${l.source}`)}
                      </span>
                      <span className="text-right font-semibold tabular-nums text-gray-900">
                        {t("lots.credit", { amount: fmt.money(l.amountMinor, l.currency) })}
                      </span>
                      <span className="col-span-2 text-gray-500">
                        {t(`lots.earnedOn.${l.source}`, { date: fmt.date(l.createdAt, "medium") })}
                      </span>
                      {l.bookingId && (
                        <span className="col-span-2">
                          <BookingLink bookingId={l.bookingId} title={l.propertyTitle} />
                        </span>
                      )}
                      <span className="col-span-2 flex flex-wrap gap-x-3">
                        <span className="text-gray-700">
                          {t("lots.remaining", {
                            remaining: fmt.money(l.remainingMinor, l.currency),
                            amount: fmt.money(l.amountMinor, l.currency),
                          })}
                        </span>
                        <span className={status.lost ? "text-red-700" : "text-gray-500"}>
                          {status.text}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
