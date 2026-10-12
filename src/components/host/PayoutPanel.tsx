"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ApiError, apiFetch } from "@/lib/api-client";
import { useFormat } from "@/i18n/use-format";
import {
  Button,
  ButtonLink,
  Card,
  Field,
  LoadError,
  Status,
  focusRing,
  inputClass,
  loginHref,
  useErrorText,
  useLoader,
} from "@/components/ui/ui";

type Schedule = "DAILY" | "WEEKLY" | "MONTHLY";

const SCHEDULES = ["DAILY", "WEEKLY", "MONTHLY"] as const;
/** Yeni hesapta sunucunun varsayılanı (`HostAccount.payoutSchedule @default(DAILY)`). */
const DEFAULT_SCHEDULE: Schedule = "DAILY";

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
    /** Paranın gideceği hesap, maskeli (sunucu eklediğinde). */
    destination?: { bankName: string | null; last4: string } | null;
    /** Sağlayıcıda hesap/banka bilgisini tamamlama bağlantısı (Stripe Connect; sunucu eklediğinde). */
    onboardingUrl?: string | null;
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

/** Paranın akış sırası: emanet → rezerv → serbest → gönderimde → ödenen. */
const BALANCE_KEYS = [
  "escrowMinor",
  "reserveMinor",
  "availableMinor",
  "pendingMinor",
  "paidMinor",
] as const;

/** Payout hata kodu → `history.failureReasons.<anahtar>`; listede olmayanlar "other" olur. */
const FAILURE_REASONS = new Map<string, string>([
  ["INSUFFICIENT_BALANCE", "INSUFFICIENT_BALANCE"],
  ["no_destination", "no_destination"],
  ["invalid_amount", "invalid_amount"],
  ["account_closed", "account_closed"],
  ["account_frozen", "account_restricted"],
  ["bank_account_restricted", "account_restricted"],
  ["invalid_account_number", "invalid_account"],
  ["no_account", "invalid_account"],
  ["account_invalid", "invalid_account"],
]);
const failureReasonKey = (code: string | null) => (code && FAILURE_REASONS.get(code)) || "other";
/** Banka/hesap bilgisi düzeltilerek çözülen nedenler; diğerlerinde destek bağlantısı gösterilir. */
const ACCOUNT_FIX_REASONS = new Set([
  "no_destination",
  "account_closed",
  "account_restricted",
  "invalid_account",
]);

/** Ekrandaki geçmiş sınırı (overview.ts `HISTORY_LIMIT`); geçmişin tamamı CSV ile indirilir. */
const HISTORY_LIMIT = 50;
const HISTORY_EXPORT_URL = "/api/host/payouts/export";

type Action = "connect" | "schedule" | "refresh";

/** Ev sahibi ödemeleri (P1-4): hesap durumu, bakiyeler ve payout geçmişi. */
export default function PayoutPanel() {
  const t = useTranslations("payouts");
  const tc = useTranslations("common");
  const f = useFormat();
  const errorText = useErrorText();
  // 401'de (oturum düştü) hata görünümü dönüş adresli giriş bağlantısı da gösterir.
  const [authLost, setAuthLost] = useState(false);
  const { data, error, loading, reload } = useLoader(
    () =>
      apiFetch<Overview>("/api/host/payouts").then(
        (d) => {
          setAuthLost(false);
          return d;
        },
        (e: unknown) => {
          setAuthLost(e instanceof ApiError && e.status === 401);
          throw e;
        }
      ),
    []
  );
  const [schedule, setSchedule] = useState<Schedule | "">("");
  const [busy, setBusy] = useState<Action | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  if (error)
    return (
      <Card title={t("account.title")} id="payout-account">
        <LoadError error={error} onRetry={reload} busy={loading} />
        {authLost && (
          <ButtonLink href={loginHref()} variant="secondary" className="mt-2 min-h-[44px]">
            {tc("sessionExpired.login")}
          </ButtonLink>
        )}
      </Card>
    );
  if (!data)
    return (
      <div role="status" aria-live="polite" aria-busy="true">
        <p className="text-sm text-gray-600">{t("loading")}</p>
      </div>
    );
  const acc = data.account;
  const selected: Schedule = schedule || acc?.payoutSchedule || DEFAULT_SCHEDULE;
  const connected = acc?.connected ?? false;
  const scheduleChanged = connected && selected !== acc?.payoutSchedule;
  const pct = (bps: number) => f.number(bps / 100, { maximumFractionDigits: 2 });
  // Hesap yokken %0 göstermeyelim: sunucu varsayılanı yoksa oransız metin kullanılır.
  const reserveBps = acc?.reservePercentBps ?? data.policy.reserveBps ?? null;
  const identityBlocked =
    acc?.blockedReason === "IDENTITY_UNVERIFIED" ||
    (acc !== null && (acc.kycStatus === "NOT_STARTED" || acc.kycStatus === "REJECTED"));
  const linkClass = `inline-flex min-h-[44px] items-center font-semibold text-[#003580] underline sm:min-h-[24px] ${focusRing}`;
  const resolution = acc
    ? identityBlocked
      ? acc.kycStatus === "PENDING"
        ? {
            text: t("resolve.identityPending"),
            href: "/account#kyc-title",
            link: t("resolve.identityStatusLink"),
          }
        : {
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
  const dest = acc?.destination ?? null;
  const destination = !connected
    ? t("blocked.NO_ACCOUNT")
    : dest
      ? [dest.bankName, t("account.endingIn", { last4: dest.last4 })].filter(Boolean).join(" · ")
      : acc?.provider === "stripe"
        ? t("account.destinationProvider")
        : t("account.destinationDemo");
  const providerUrl = acc?.onboardingUrl ?? null;
  const onboardingUrl = providerUrl?.startsWith("https://") ? providerUrl : null;
  const termValues = { hours: data.policy.releaseHours, days: data.policy.reserveReleaseDays };

  const run = async (action: Action) => {
    if (busy || (action === "schedule" && !scheduleChanged)) return;
    setBusy(action);
    setActionError(null);
    setMessage(null);
    try {
      await apiFetch("/api/host/payouts", {
        method: "POST",
        body: JSON.stringify(action === "refresh" ? {} : { schedule: selected }),
      });
      setMessage(
        action === "connect"
          ? t("account.connected")
          : action === "schedule"
            ? t("account.scheduleSaved")
            : t("account.saved")
      );
      reload();
    } catch (e) {
      setActionError(errorText(e));
    } finally {
      setBusy(null);
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
              <dt className="text-gray-600">{t("account.destination")}</dt>
              <dd className="font-medium">{destination}</dd>
              {onboardingUrl && (
                <dd>
                  <a href={onboardingUrl} className={linkClass}>
                    {t("account.manageAtProvider")}
                  </a>
                </dd>
              )}
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
        {connected && (
          <div className="mt-3">
            <Button
              variant="secondary"
              className="min-h-[44px]"
              onClick={() => run("refresh")}
              busy={busy === "refresh"}
            >
              {t("account.refresh")}
            </Button>
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <Field label={t("account.scheduleLabel")} id="payout-schedule">
            <select
              id="payout-schedule"
              className={inputClass}
              value={selected}
              aria-describedby="payout-schedule-hint"
              onChange={(e) => setSchedule(e.target.value as Schedule)}
            >
              {SCHEDULES.map((s) => (
                <option key={s} value={s}>
                  {t(`schedule.${s}`)}
                </option>
              ))}
            </select>
          </Field>
          {/* Aynı konumda kalan düğme bağlantıdan sonra odağı korur. */}
          {connected ? (
            <Button
              className="min-h-[44px]"
              onClick={() => run("schedule")}
              busy={busy === "schedule"}
              aria-disabled={!scheduleChanged || undefined}
            >
              {busy === "schedule" ? t("account.savingSchedule") : t("account.saveSchedule")}
            </Button>
          ) : (
            <Button
              className="min-h-[44px]"
              onClick={() => run("connect")}
              busy={busy === "connect"}
            >
              {t("account.connect")}
            </Button>
          )}
        </div>
        <p id="payout-schedule-hint" className="mt-1 text-xs text-gray-600">
          {acc && connected
            ? t("account.scheduleCurrent", { schedule: t(`schedule.${acc.payoutSchedule}`) })
            : t("account.scheduleNew")}
        </p>
        <Status error={actionError} message={message} />
        <ul className="mt-3 list-disc space-y-1 ps-5 text-xs text-gray-600">
          <li>{t("policyList.release", { hours: data.policy.releaseHours })}</li>
          <li>{t("policyList.commission", { commission: pct(data.policy.commissionBps) })}</li>
          <li>
            {reserveBps !== null
              ? t("policyList.reserve", {
                  reserve: pct(reserveBps),
                  days: data.policy.reserveReleaseDays,
                })
              : t("policyList.reserveUnknown", { days: data.policy.reserveReleaseDays })}
          </li>
          {data.policy.identityRequired && !resolution && (
            <li>
              {t("identityRequired")}
              {!acc && (
                <>
                  {" "}
                  <Link href="/account#kyc-title" className={linkClass}>
                    {t("resolve.identityLink")}
                  </Link>
                </>
              )}
            </li>
          )}
        </ul>
      </Card>

      <Card title={t("balances.title")} id="payout-balances">
        {data.balances.length === 0 ? (
          <p className="text-sm text-gray-700">{t("balances.empty")}</p>
        ) : (
          <div
            className={`overflow-x-auto ${focusRing}`}
            role="region"
            tabIndex={0}
            aria-label={t("balances.caption")}
          >
            <table className="w-full text-left text-sm">
              <caption className="sr-only">{t("balances.caption")}</caption>
              <thead>
                <tr className="border-b border-gray-200">
                  <th scope="col" className="py-2 pe-4">
                    {t("balances.currency")}
                  </th>
                  {BALANCE_KEYS.map((k) => (
                    <th key={k} scope="col" className="whitespace-nowrap py-2 pe-4 text-end">
                      {t(`balances.${k}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.balances.map((b) => (
                  <tr key={b.currency} className="border-b border-gray-100">
                    <th scope="row" className="py-2 pe-4 font-medium">
                      {b.currency}
                    </th>
                    {BALANCE_KEYS.map((k) => (
                      <td key={k} className="whitespace-nowrap py-2 pe-4 text-end tabular-nums">
                        {f.money(b[k], b.currency)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data.balances.length > 0 && (
          <>
            <p className="mt-3 text-xs text-gray-600">{t("balances.hint")}</p>
            <dl className="mt-1 space-y-1 text-xs">
              {BALANCE_KEYS.map((k) => (
                <div key={k} className="sm:flex sm:gap-2">
                  <dt className="font-medium text-gray-900 sm:w-24 sm:shrink-0">
                    {t(`balances.${k}`)}
                  </dt>
                  <dd className="text-gray-600">{t(`balances.terms.${k}`, termValues)}</dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </Card>

      <Card title={t("history.title")} id="payout-history">
        {data.history.length === 0 ? (
          <p className="text-sm text-gray-700">{t("history.empty")}</p>
        ) : (
          <div
            className={`overflow-x-auto ${focusRing}`}
            role="region"
            tabIndex={0}
            aria-label={t("history.caption")}
          >
            <table className="w-full text-left text-sm">
              <caption className="sr-only">{t("history.caption")}</caption>
              <thead>
                <tr className="border-b border-gray-200">
                  <th scope="col" className="whitespace-nowrap py-2 pe-4">
                    {t("history.createdAt")}
                  </th>
                  <th scope="col" className="whitespace-nowrap py-2 pe-4">
                    {t("history.paidAt")}
                  </th>
                  <th scope="col" className="py-2 pe-4">
                    {t("history.kind")}
                  </th>
                  <th scope="col" className="py-2 pe-4 text-end">
                    {t("history.amount")}
                  </th>
                  <th scope="col" className="py-2 pe-4">
                    {t("history.status")}
                  </th>
                  <th scope="col" className="py-2">
                    {t("history.reference")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.history.map((p) => (
                  <tr key={p.id} className="border-b border-gray-100">
                    <td className="whitespace-nowrap py-2 pe-4">{f.date(p.createdAt, "short")}</td>
                    <td className="whitespace-nowrap py-2 pe-4">
                      {p.paidAt ? (
                        f.date(p.paidAt, "short")
                      ) : (
                        <EmptyCell label={t("history.notPaid")} />
                      )}
                    </td>
                    <td className="py-2 pe-4">{t(`history.kinds.${p.kind}`)}</td>
                    <td className="whitespace-nowrap py-2 pe-4 text-end tabular-nums">
                      {f.money(p.amountMinor, p.currency)}
                    </td>
                    <td className="py-2 pe-4">
                      {t(`history.statuses.${p.status}`)}
                      {p.status === "FAILED" && (
                        <PayoutFailure
                          code={p.failureCode}
                          accountUrl={onboardingUrl}
                          linkClass={linkClass}
                        />
                      )}
                    </td>
                    <td className="break-all py-2 font-mono text-xs">
                      {p.reference ?? <EmptyCell label={t("history.noReference")} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data.history.length > 0 && (
          <div className="mt-3 space-y-1 text-xs text-gray-600">
            {data.history.length >= HISTORY_LIMIT && (
              <p>{t("history.limitNote", { limit: HISTORY_LIMIT })}</p>
            )}
            <a href={HISTORY_EXPORT_URL} download className={linkClass}>
              {t("history.downloadCsv")}
            </a>
          </div>
        )}
      </Card>
      <p className="text-xs text-gray-600">{t("disclaimer")}</p>
    </div>
  );
}

/** Boş hücre: görselde "—", ekran okuyucuda açıklaması okunur. */
function EmptyCell({ label }: { label: string }) {
  return (
    <>
      <span aria-hidden="true">—</span>
      <span className="sr-only">{label}</span>
    </>
  );
}

/** Başarısız ödeme: nedeni, tutara ne olacağı ve çözüm bağlantısı (ham kod yalnız destek notu). */
function PayoutFailure({
  code,
  accountUrl,
  linkClass,
}: {
  code: string | null;
  accountUrl: string | null;
  linkClass: string;
}) {
  const t = useTranslations("payouts");
  const reason = failureReasonKey(code);
  return (
    <div className="mt-1 space-y-1 text-xs text-gray-600">
      <p>
        {t(`history.failureReasons.${reason}`)} {t("history.failedRetry")}
      </p>
      {ACCOUNT_FIX_REASONS.has(reason) ? (
        <a href={accountUrl ?? "#payout-account"} className={linkClass}>
          {accountUrl ? t("account.manageAtProvider") : t("history.fixAccountLink")}
        </a>
      ) : (
        <Link href="/support" className={linkClass}>
          {t("resolve.supportLink")}
        </Link>
      )}
      {code && <p>{t("history.failureCode", { code })}</p>}
    </div>
  );
}
