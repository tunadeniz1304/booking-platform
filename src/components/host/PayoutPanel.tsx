"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api-client";
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
} from "@/components/ui/ui";

type Schedule = "DAILY" | "WEEKLY" | "MONTHLY";

interface Overview {
  account: {
    provider: string;
    connected: boolean;
    kycStatus: "NOT_STARTED" | "PENDING" | "VERIFIED" | "REJECTED";
    payoutsEnabled: boolean;
    payoutsPaused: boolean;
    pausedReason: string | null;
    payoutSchedule: Schedule;
    reservePercentBps: number;
    blockedReason: string | null;
  } | null;
  policy: {
    releaseHours: number;
    commissionBps: number;
    reserveReleaseDays: number;
    identityRequired: boolean;
    /** Hesap yokken uygulanacak varsayılan rezerv oranı (sunucu eklediğinde). */
    reserveBps?: number;
  };
  balances: Array<{
    currency: string;
    escrowMinor: number;
    availableMinor: number;
    pendingMinor: number;
    reserveMinor: number;
    paidMinor: number;
  }>;
  history: Array<{
    id: string;
    kind: "host" | "transfer";
    amountMinor: number;
    currency: string;
    status: "PENDING" | "PAID" | "FAILED";
    reference: string | null;
    failureCode: string | null;
    createdAt: string;
    paidAt: string | null;
  }>;
}

const BALANCE_KEYS = ["escrowMinor", "availableMinor", "reserveMinor", "paidMinor"] as const;

/** Ev sahibi ödemeleri (P1-4): hesap durumu, bakiyeler ve payout geçmişi. */
export default function PayoutPanel() {
  const t = useTranslations("payouts");
  const f = useFormat();
  const { data, error, reload } = useLoader(() => apiFetch<Overview>("/api/host/payouts"), []);
  const [schedule, setSchedule] = useState<Schedule | "">("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  if (error) return <Status error={error} />;
  if (!data)
    return (
      <div role="status" aria-live="polite" aria-busy="true">
        <p className="text-sm text-gray-600">{t("loading")}</p>
      </div>
    );
  const acc = data.account;
  const pct = (bps: number) => f.number(bps / 100, { maximumFractionDigits: 2 });
  // Hesap yokken %0 göstermeyelim: sunucu varsayılanı yoksa oransız metin kullanılır.
  const reserveBps = acc?.reservePercentBps ?? data.policy.reserveBps ?? null;
  const identityBlocked =
    acc?.blockedReason === "IDENTITY_UNVERIFIED" ||
    (acc !== null && (acc.kycStatus === "NOT_STARTED" || acc.kycStatus === "REJECTED"));
  const linkClass = `inline-flex min-h-[44px] items-center font-semibold text-[#003580] underline sm:min-h-[24px] ${focusRing}`;
  const resolution = acc
    ? identityBlocked
      ? {
          text:
            acc.kycStatus === "REJECTED" ? t("resolve.identityRejected") : t("resolve.identity"),
          href: "/account#kyc-title",
          link: t("resolve.identityLink"),
        }
      : acc.blockedReason === "PAUSED"
        ? { text: t("resolve.paused"), href: "/support", link: t("resolve.supportLink") }
        : acc.blockedReason === "PROVIDER_DISABLED"
          ? { text: t("resolve.providerDisabled"), href: null, link: null }
          : null
    : null;

  const onboard = async () => {
    setBusy(true);
    setActionError(null);
    setMessage(null);
    try {
      await apiFetch("/api/host/payouts", {
        method: "POST",
        body: JSON.stringify(schedule ? { schedule } : {}),
      });
      setMessage(t("account.saved"));
      reload();
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card title={t("account.title")} id="payout-account">
        {resolution && (
          <div role="status" className="mb-4 rounded-lg border border-gray-200 p-3 text-sm">
            <p className="text-gray-900">{resolution.text}</p>
            {resolution.href && (
              <Link href={resolution.href} className={linkClass}>
                {resolution.link}
              </Link>
            )}
          </div>
        )}
        {acc ? (
          <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-gray-600">{t("account.provider")}</dt>
              <dd className="font-medium">
                {t(`provider.${acc.provider === "stripe" ? "stripe" : "mock"}`)}
              </dd>
            </div>
            <div>
              <dt className="text-gray-600">{t("account.kyc")}</dt>
              <dd className="font-medium">{t(`kyc.${acc.kycStatus}`)}</dd>
            </div>
            <div>
              <dt className="text-gray-600">{t("account.schedule")}</dt>
              <dd className="font-medium">{t(`schedule.${acc.payoutSchedule}`)}</dd>
            </div>
            <div>
              <dt className="text-gray-600">{t("account.status")}</dt>
              <dd className="font-medium">
                {acc.blockedReason ? t(`blocked.${acc.blockedReason}`) : t("account.active")}
                {acc.payoutsPaused && acc.pausedReason ? ` — ${acc.pausedReason}` : ""}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-gray-700">{t("account.none")}</p>
        )}
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <Field label={t("account.scheduleLabel")} id="payout-schedule">
            <select
              id="payout-schedule"
              className={inputClass}
              value={schedule}
              onChange={(e) => setSchedule(e.target.value as Schedule | "")}
            >
              <option value="">{t("account.keepSchedule")}</option>
              {(["DAILY", "WEEKLY", "MONTHLY"] as const).map((s) => (
                <option key={s} value={s}>
                  {t(`schedule.${s}`)}
                </option>
              ))}
            </select>
          </Field>
          <Button className="min-h-[44px]" onClick={onboard} busy={busy}>
            {acc?.connected ? t("account.refresh") : t("account.connect")}
          </Button>
        </div>
        <Status error={actionError} message={message} />
        <p className="mt-3 text-xs text-gray-600">
          {reserveBps !== null
            ? t("policy", {
                hours: data.policy.releaseHours,
                commission: pct(data.policy.commissionBps),
                reserve: pct(reserveBps),
                days: data.policy.reserveReleaseDays,
              })
            : t("policyNoReserve", {
                hours: data.policy.releaseHours,
                commission: pct(data.policy.commissionBps),
                days: data.policy.reserveReleaseDays,
              })}
          {data.policy.identityRequired && !resolution ? ` ${t("identityRequired")}` : ""}
        </p>
      </Card>

      <Card title={t("balances.title")} id="payout-balances">
        {data.balances.length === 0 ? (
          <p className="text-sm text-gray-700">{t("balances.empty")}</p>
        ) : (
          <div
            className="overflow-x-auto"
            role="region"
            tabIndex={0}
            aria-label={t("balances.caption")}
          >
            <table className="w-full text-left text-sm">
              <caption className="sr-only">{t("balances.caption")}</caption>
              <thead>
                <tr className="border-b border-gray-200">
                  <th scope="col" className="py-2">
                    {t("balances.currency")}
                  </th>
                  {BALANCE_KEYS.map((k) => (
                    <th key={k} scope="col" className="py-2">
                      {t(`balances.${k}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.balances.map((b) => (
                  <tr key={b.currency} className="border-b border-gray-100">
                    <th scope="row" className="py-2 font-medium">
                      {b.currency}
                    </th>
                    {BALANCE_KEYS.map((k) => (
                      <td key={k} className="py-2">
                        {f.money(b[k], b.currency)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-gray-600">{t("balances.hint")}</p>
      </Card>

      <Card title={t("history.title")} id="payout-history">
        {data.history.length === 0 ? (
          <p className="text-sm text-gray-700">{t("history.empty")}</p>
        ) : (
          <div
            className="overflow-x-auto"
            role="region"
            tabIndex={0}
            aria-label={t("history.caption")}
          >
            <table className="w-full text-left text-sm">
              <caption className="sr-only">{t("history.caption")}</caption>
              <thead>
                <tr className="border-b border-gray-200">
                  <th scope="col" className="py-2">
                    {t("history.date")}
                  </th>
                  <th scope="col" className="py-2">
                    {t("history.kind")}
                  </th>
                  <th scope="col" className="py-2">
                    {t("history.amount")}
                  </th>
                  <th scope="col" className="py-2">
                    {t("history.status")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.history.map((p) => (
                  <tr key={p.id} className="border-b border-gray-100">
                    <td className="py-2">{f.date(p.paidAt ?? p.createdAt, "short")}</td>
                    <td className="py-2">{t(`history.kinds.${p.kind}`)}</td>
                    <td className="py-2">{f.money(p.amountMinor, p.currency)}</td>
                    <td className="py-2">
                      {t(`history.statuses.${p.status}`)}
                      {p.failureCode ? ` (${p.failureCode})` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="text-xs text-gray-600">{t("disclaimer")}</p>
    </div>
  );
}
