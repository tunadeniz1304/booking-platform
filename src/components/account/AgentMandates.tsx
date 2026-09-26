"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api-client";
import { useFormat } from "@/i18n/use-format";
import { toMinor } from "@/lib/money/money";
import {
  Button,
  Card,
  Field,
  Status,
  errorMessage,
  inputClass,
  useLoader,
} from "@/components/ui/ui";
import { ReauthCancelledError, useReauth } from "./ReauthDialog";

/**
 * P2-1a / P1-11: yapay zekâ ajanına ödeme yetkisi (AP2 intent mandate) — tutar limiti, süre,
 * isteğe bağlı ilan kısıtı. Verme recent-auth ister (`useReauth`); imzalı belirteç yalnız bir
 * kez gösterilir. Liste denetim kaydından gelir; iptal edilen mandate checkout'ta reddedilir.
 */

interface MandateSummary {
  nonce: string;
  maxAmountMinor: number;
  currency: string;
  expiresAt: string;
  propertyId: string[] | null;
  issuedAt: string;
  status: "active" | "expired" | "revoked";
  used: boolean | null;
}

const CURRENCIES = ["TRY", "EUR", "USD", "GBP"] as const;
const DURATIONS = [
  { minutes: 60, key: "1h" },
  { minutes: 24 * 60, key: "1d" },
  { minutes: 7 * 24 * 60, key: "7d" },
] as const;

export default function AgentMandates() {
  const t = useTranslations("account.mandates");
  const f = useFormat();
  const reauth = useReauth();
  const list = useLoader(() =>
    apiFetch<{ mandates: MandateSummary[] }>("/api/account/agent-mandates").then((r) => r.mandates)
  );
  const [status, setStatus] = useState<{ error?: string; message?: string }>({});
  const [amountError, setAmountError] = useState<string | null>(null);
  const [issued, setIssued] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const currency = String(form.get("currency") ?? "TRY");
    const amount = Number(String(form.get("amount") ?? "").replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) {
      setAmountError(t("amountInvalid"));
      return;
    }
    setAmountError(null);
    const propertyIds = String(form.get("propertyIds") ?? "")
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    setStatus({});
    setBusy(true);
    try {
      const out = await reauth.run(() =>
        apiFetch<{ mandate: string }>("/api/account/agent-mandates", {
          method: "POST",
          body: JSON.stringify({
            maxAmountMinor: toMinor(amount, currency),
            currency,
            expiresInMinutes: Number(form.get("duration")),
            ...(propertyIds.length > 0 ? { propertyIds } : {}),
          }),
        })
      );
      setIssued(out.mandate);
      setStatus({ message: t("created") });
      list.reload();
    } catch (err) {
      if (!(err instanceof ReauthCancelledError)) setStatus({ error: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  async function revoke(m: MandateSummary) {
    setStatus({});
    try {
      await apiFetch(`/api/account/agent-mandates/${encodeURIComponent(m.nonce)}`, {
        method: "DELETE",
      });
      setStatus({ message: t("revoked") });
      list.reload();
    } catch (err) {
      setStatus({ error: errorMessage(err) });
    }
  }

  const statusClass = {
    active: "bg-green-100 text-green-900",
    expired: "bg-gray-200 text-gray-900",
    revoked: "bg-red-100 text-red-900",
  } as const;

  return (
    <div className="mt-6">
      <Card title={t("title")} id="agent-mandates">
        <p className="mb-3 text-sm text-gray-700">{t("intro")}</p>
        <form onSubmit={create} className="grid gap-3 sm:grid-cols-3" noValidate>
          <Field id="mandate-amount" label={t("amount")} error={amountError}>
            <input
              id="mandate-amount"
              name="amount"
              type="number"
              inputMode="decimal"
              min="1"
              step="0.01"
              required
              className={inputClass}
            />
          </Field>
          <Field id="mandate-currency" label={t("currency")}>
            <select id="mandate-currency" name="currency" defaultValue="TRY" className={inputClass}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
          <Field id="mandate-duration" label={t("duration")}>
            <select
              id="mandate-duration"
              name="duration"
              defaultValue={String(DURATIONS[0].minutes)}
              className={inputClass}
            >
              {DURATIONS.map((d) => (
                <option key={d.key} value={d.minutes}>
                  {t(`durations.${d.key}`)}
                </option>
              ))}
            </select>
          </Field>
          <div className="sm:col-span-3">
            <Field id="mandate-properties" label={t("properties")} hint={t("propertiesHint")}>
              <input id="mandate-properties" name="propertyIds" className={inputClass} />
            </Field>
          </div>
          <div className="sm:col-span-3">
            <Button type="submit" disabled={busy}>
              {busy ? t("creating") : t("create")}
            </Button>
          </div>
        </form>
        {issued && (
          <div className="mt-4 rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-gray-900">
            <p className="font-semibold">{t("tokenOnce")}</p>
            <label htmlFor="mandate-token" className="sr-only">
              {t("tokenLabel")}
            </label>
            <textarea
              id="mandate-token"
              readOnly
              value={issued}
              rows={3}
              className={`${inputClass} font-mono text-xs`}
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button
              variant="secondary"
              className="mt-2"
              onClick={() => void navigator.clipboard?.writeText(issued)}
            >
              {t("copy")}
            </Button>
          </div>
        )}
        <Status error={status.error ?? list.error} message={status.message} />

        <h3 className="mt-4 text-base font-semibold text-gray-900">{t("listTitle")}</h3>
        {list.data?.length === 0 && <p className="text-sm text-gray-700">{t("empty")}</p>}
        <ul className="mt-2 divide-y divide-gray-200">
          {list.data?.map((m) => (
            <li key={m.nonce} className="flex flex-wrap items-center gap-3 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-gray-900">
                  {t("limit", { amount: f.money(m.maxAmountMinor, m.currency) })}
                  <span
                    className={`ml-2 inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${statusClass[m.status]}`}
                  >
                    {t(`status.${m.status}`)}
                  </span>
                  {m.used && (
                    <span className="ml-2 inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-900">
                      {t("used")}
                    </span>
                  )}
                </p>
                <p className="text-gray-700">
                  {t("validUntil", { date: f.dateTime(m.expiresAt) })}
                  {m.propertyId && ` · ${t("scoped", { count: m.propertyId.length })}`}
                </p>
              </div>
              {m.status === "active" && (
                <Button
                  variant="danger"
                  onClick={() => void revoke(m)}
                  aria-label={t("revokeLabel", {
                    amount: f.money(m.maxAmountMinor, m.currency),
                  })}
                >
                  {t("revoke")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Card>
      {reauth.dialog}
    </div>
  );
}
