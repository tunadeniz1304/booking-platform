"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ApiError, apiFetch } from "@/lib/api-client";
import { useFormat } from "@/i18n/use-format";
import { parseMoney } from "@/lib/money/money";
import type { ShareDTO, SplitPlanDTO } from "@/lib/cart/split-payment";

interface Row {
  email: string;
  amount: string;
}

const field =
  "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[#003580]";

const STATUS_TONE: Record<string, string> = {
  INVITED: "bg-gray-100 text-gray-700",
  REQUIRES_ACTION: "bg-amber-100 text-amber-800",
  AUTHORIZED: "bg-blue-100 text-blue-800",
  CAPTURED: "bg-green-100 text-green-800",
  FAILED: "bg-red-100 text-red-700",
  VOIDED: "bg-gray-100 text-gray-500",
  REFUNDED: "bg-gray-100 text-gray-500",
  EXPIRED: "bg-gray-100 text-gray-500",
};

/** Davet linkinden uygulama içi yol (/pay/share/<token>). */
function localPath(url: string): string {
  const i = url.indexOf("/pay/share/");
  return i >= 0 ? url.slice(i) : url;
}

/**
 * Bölünmüş ödeme (P1-2) paneli: plan yoksa organizatör payları tanımlar (eşit / özel tutar);
 * plan varsa pay durum listesi, davet linkini kopyala / e-postayla gönder ve organizatörün
 * kendi payını ödeme bağlantısı. `allowCreate=false` → yalnız durum listesi (sepet sayfası).
 */
export function SplitPayPanel({
  cartId,
  totalMinor,
  currency,
  allowCreate,
  onPlan,
}: {
  cartId: string;
  totalMinor: number;
  currency: string;
  allowCreate: boolean;
  onPlan?: (plan: SplitPlanDTO | null) => void;
}) {
  const t = useTranslations("cart.split");
  const f = useFormat();
  const [plan, setPlan] = useState<SplitPlanDTO | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [mode, setMode] = useState<"equal" | "custom">("equal");
  const [rows, setRows] = useState<Row[]>([
    { email: "", amount: "" },
    { email: "", amount: "" },
  ]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [emails, setEmails] = useState<Record<string, string>>({});

  const apply = useCallback(
    (next: SplitPlanDTO | null) => {
      setPlan(next);
      onPlan?.(next);
    },
    [onPlan]
  );

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<{ plan: SplitPlanDTO | null }>(`/api/cart/${cartId}/split`, {
        cache: "no-store",
      });
      apply(res.plan);
    } catch {
      apply(null);
    } finally {
      setLoaded(true);
    }
  }, [cartId, apply]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  const equalShare = Math.floor(totalMinor / (rows.length + 1));
  let customSum = 0;
  let customValid = mode === "custom";
  if (mode === "custom") {
    for (const r of rows) {
      try {
        const m = parseMoney(r.amount || "x", currency);
        if (m.amount <= 0) customValid = false;
        customSum += m.amount;
      } catch {
        customValid = false;
      }
    }
  }
  const organizerMinor =
    mode === "equal" ? totalMinor - equalShare * rows.length : totalMinor - customSum;

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setBusy(true);
    try {
      const participants = rows.map((r) => ({
        email: r.email.trim() || null,
        ...(mode === "custom" ? { amountMinor: parseMoney(r.amount, currency).amount } : {}),
      }));
      const res = await apiFetch<{ plan: SplitPlanDTO }>(`/api/cart/${cartId}/split`, {
        method: "POST",
        body: JSON.stringify({ mode, participants }),
      });
      apply(res.plan);
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : t("createFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function copy(share: ShareDTO) {
    if (!share.inviteUrl) return;
    try {
      await navigator.clipboard.writeText(share.inviteUrl);
      setNotice(t("copied"));
    } catch {
      window.prompt(t("copyLink"), share.inviteUrl);
    }
  }

  async function sendInvite(share: ShareDTO) {
    setMessage(null);
    setBusy(true);
    try {
      const email = emails[share.id]?.trim() || share.participantEmail || null;
      const res = await apiFetch<{ plan: SplitPlanDTO }>(
        `/api/cart/${cartId}/split/shares/${share.id}/invite`,
        { method: "POST", body: JSON.stringify({ email }) }
      );
      apply(res.plan);
      setNotice(t("sent"));
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : t("sendFailed"));
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return null;
  if (!plan && !allowCreate) return null;

  const alerts = (
    <div aria-live="polite">
      {message && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {message}
        </p>
      )}
      {notice && <p className="mt-3 text-sm text-green-700">{notice}</p>}
    </div>
  );

  if (!plan) {
    return (
      <form
        onSubmit={create}
        className="mt-6 space-y-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"
        aria-label={t("title")}
        data-testid="split-create"
      >
        <div>
          <h2 className="text-lg font-semibold text-gray-900">{t("title")}</h2>
          <p className="mt-1 text-sm text-gray-600">{t("intro")}</p>
        </div>
        <fieldset className="flex flex-wrap gap-4 text-sm text-gray-800">
          {(["equal", "custom"] as const).map((m) => (
            <label key={m} className="flex items-center gap-2">
              <input
                type="radio"
                name="split-mode"
                checked={mode === m}
                onChange={() => setMode(m)}
              />
              {m === "equal" ? t("modeEqual") : t("modeCustom")}
            </label>
          ))}
        </fieldset>
        <ul className="space-y-3">
          {rows.map((row, i) => (
            <li key={i} className="flex flex-wrap items-end gap-3">
              <label className="min-w-[12rem] flex-1 text-sm font-medium text-gray-700">
                {t("participant", { n: i + 1 })} · {t("emailLabel")}
                <input
                  type="email"
                  className={field}
                  value={row.email}
                  autoComplete="off"
                  onChange={(e) =>
                    setRows(rows.map((r, j) => (j === i ? { ...r, email: e.target.value } : r)))
                  }
                />
              </label>
              {mode === "custom" ? (
                <label className="w-32 text-sm font-medium text-gray-700">
                  {t("amountLabel")} ({currency})
                  <input
                    inputMode="decimal"
                    className={field}
                    value={row.amount}
                    onChange={(e) =>
                      setRows(rows.map((r, j) => (j === i ? { ...r, amount: e.target.value } : r)))
                    }
                    required
                  />
                </label>
              ) : (
                <span className="pb-2 text-sm text-gray-700">{f.money(equalShare, currency)}</span>
              )}
              {rows.length > 1 && (
                <button
                  type="button"
                  onClick={() => setRows(rows.filter((_, j) => j !== i))}
                  className="pb-2 text-sm font-semibold text-red-700 hover:underline"
                  aria-label={t("removeParticipant")}
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
        {rows.length < 9 && (
          <button
            type="button"
            onClick={() => setRows([...rows, { email: "", amount: "" }])}
            className="text-sm font-semibold text-primary-600 hover:underline"
          >
            + {t("addParticipant")}
          </button>
        )}
        <div className="flex justify-between border-t border-gray-100 pt-3 text-sm">
          <span className="text-gray-700">{t("organizerShare")}</span>
          <span className="font-semibold text-gray-900" data-testid="split-organizer-share">
            {f.money(Math.max(0, organizerMinor), currency)}
          </span>
        </div>
        <p className="text-xs text-gray-500">{t("remainderHint")}</p>
        {alerts}
        <button
          type="submit"
          disabled={busy || (mode === "custom" && (!customValid || organizerMinor < 0))}
          className="w-full rounded-lg border border-[#003580] px-4 py-3 text-sm font-semibold text-[#003580] hover:bg-blue-50 disabled:border-gray-300 disabled:text-gray-500"
        >
          {busy ? t("creating") : t("create")}
        </button>
      </form>
    );
  }

  const open = plan.status === "COLLECTING" || plan.status === "FALLBACK";
  return (
    <section
      className="mt-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"
      aria-label={t("sharesTitle")}
      data-testid="split-status"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-gray-900">{t("title")}</h2>
        <span className="text-sm font-medium text-gray-700">{t(`planStatus.${plan.status}`)}</span>
      </div>
      {open && (
        <>
          <p className="mt-1 text-sm text-amber-700">
            {t("deadline", { time: f.dateTime(plan.deadlineAt) })}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            {plan.fallbackMode === "ORGANIZER_PAYS" ? t("fallbackOrganizer") : t("fallbackRefund")}
          </p>
        </>
      )}
      <p className="mt-2 text-sm text-gray-800">
        {t("progress", {
          funded: f.money(plan.fundedMinor, plan.currency),
          total: f.money(plan.totalMinor, plan.currency),
        })}
      </p>
      <ul className="mt-4 divide-y divide-gray-100">
        {plan.shares.map((s) => (
          <li key={s.id} className="py-3" data-testid="split-share">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="text-gray-800">
                {s.isFallback
                  ? t("fallbackLabel")
                  : s.isOrganizer
                    ? t("you")
                    : (s.participantEmail ?? t("anonymous", { n: s.position }))}
              </span>
              <span className="flex items-center gap-2">
                <span className="font-semibold text-gray-900">
                  {f.money(s.amountMinor, s.currency)}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONE[s.status] ?? ""}`}
                >
                  {t(`status.${s.status}`)}
                </span>
              </span>
            </div>
            {s.inviteUrl && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                {s.isOrganizer ? (
                  <Link
                    href={localPath(s.inviteUrl)}
                    className="rounded-md bg-[#003580] px-3 py-1 font-semibold text-white"
                  >
                    {s.isFallback ? t("payRemaining") : t("payMine")}
                  </Link>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => void copy(s)}
                      className="rounded-md border border-gray-300 px-3 py-1 font-semibold text-gray-800"
                    >
                      {t("copyLink")}
                    </button>
                    {!s.participantEmail && (
                      <input
                        type="email"
                        aria-label={t("emailLabel")}
                        placeholder={t("emailLabel")}
                        className="w-48 rounded-md border border-gray-300 px-2 py-1"
                        value={emails[s.id] ?? ""}
                        onChange={(e) => setEmails({ ...emails, [s.id]: e.target.value })}
                      />
                    )}
                    <button
                      type="button"
                      disabled={busy || (!s.participantEmail && !emails[s.id]?.trim())}
                      onClick={() => void sendInvite(s)}
                      className="rounded-md border border-gray-300 px-3 py-1 font-semibold text-gray-800 disabled:text-gray-400"
                    >
                      {t("sendEmail")}
                    </button>
                  </>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      {alerts}
    </section>
  );
}
