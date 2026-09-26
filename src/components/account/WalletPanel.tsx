"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api-client";
import { useFormat } from "@/i18n/use-format";

export interface WalletData {
  tier: number;
  completedStays: number;
  cashbackBps: number;
  staysToNextTier: number | null;
  nextTierBps: number | null;
  balances: Array<{ currency: string; availableMinor: number; nextExpiryAt: string | null }>;
  lots: Array<{
    id: string;
    source: "CASHBACK" | "REFUND";
    currency: string;
    amountMinor: number;
    remainingMinor: number;
    expiresAt: string;
    expired: boolean;
    createdAt: string;
  }>;
  pendingCashback: Array<{ bookingId: string; currency: string; bps: number; dueAt: string }>;
}

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
      aria-label={t("tierAria", { tier: name })}
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${TIER_STYLE[tier] ?? TIER_STYLE[0]}`}
    >
      {t("tierBadge", { tier: name })}
    </span>
  );
}

/**
 * Hesap ▸ Cüzdan (P1-7): seviye rozeti, para birimi başına kullanılabilir kredi, lot'lar
 * (kalan / son kullanma) ve iade penceresi bekleyen cashback'ler.
 */
export default function WalletPanel() {
  const t = useTranslations("wallet");
  const fmt = useFormat();
  const [data, setData] = useState<WalletData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    apiFetch<WalletData>("/api/account/wallet")
      .then((d) => active && setData(d))
      .catch(() => active && setError(true));
    return () => {
      active = false;
    };
  }, []);

  const rate = (bps: number) => fmt.number(bps / 100, { maximumFractionDigits: 2 });

  return (
    <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm" aria-labelledby="wallet-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="wallet-title" className="text-xl font-semibold text-gray-900">
          {t("title")}
        </h2>
        {data && <TierBadge tier={data.tier} />}
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {t("loadFailed")}
        </p>
      )}
      {!data && !error && <p className="mt-3 text-sm text-gray-500">{t("loading")}</p>}
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
              <ul className="mt-1 space-y-1">
                {data.balances.map((b) => (
                  <li key={b.currency} className="flex flex-wrap items-baseline gap-2">
                    <span className="text-2xl font-bold text-gray-900">
                      {fmt.money(b.availableMinor, b.currency)}
                    </span>
                    {b.nextExpiryAt && (
                      <span className="text-xs text-amber-800">
                        {t("nextExpiry", { date: fmt.date(b.nextExpiryAt, "long") })}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {data.pendingCashback.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-900">{t("pending.title")}</h3>
              <ul className="mt-1 space-y-1 text-sm text-gray-600">
                {data.pendingCashback.map((p) => (
                  <li key={p.bookingId}>
                    {t("pending.item", { date: fmt.date(p.dueAt, "long"), rate: rate(p.bps) })}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.lots.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-900">{t("lots.title")}</h3>
              <ul className="mt-2 divide-y divide-gray-100 text-sm">
                {data.lots.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className="font-medium text-gray-800">
                      {t(`lots.source.${l.source}`)}
                    </span>
                    <span className="text-gray-700">
                      {t("lots.remaining", {
                        remaining: fmt.money(l.remainingMinor, l.currency),
                        amount: fmt.money(l.amountMinor, l.currency),
                      })}
                    </span>
                    <span className={l.expired ? "text-red-700" : "text-gray-500"}>
                      {l.expired
                        ? t("lots.expired")
                        : l.remainingMinor === 0
                          ? t("lots.used")
                          : t("lots.expires", { date: fmt.date(l.expiresAt, "long") })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
