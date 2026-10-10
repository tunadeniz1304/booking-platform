"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ApiError, apiFetch } from "@/lib/api-client";
import { useFormat } from "@/i18n/use-format";
import { parseAmountToMinor } from "@/lib/ui/amount-input";
import { useErrorText } from "@/components/ui/ui";
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

/** Sunucu hata kodları → `cart.split.errors.*` (sunucunun Türkçe iletisi gösterilmez). */
const ERROR_CODES = new Set([
  "SPLIT_DUPLICATE_EMAIL",
  "SPLIT_AMOUNT_INVALID",
  "SPLIT_SHARE_COUNT",
  "SPLIT_EXISTS",
  "SPLIT_CLOSED",
  "SPLIT_DEADLINE_PASSED",
  "SHARE_EMAIL_REQUIRED",
  "SHARE_NOT_INVITABLE",
  "CART_NOT_HELD",
  "CART_PAYMENT_IN_PROGRESS",
  "VALIDATION_ERROR",
]);

/** Para biriminin ondalık hane sayısı (TRY/USD/EUR → 2). */
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
  const errText = useErrorText();
  const baseId = useId();
  const statusHeadingRef = useRef<HTMLHeadingElement>(null);
  const justCreated = useRef(false);
  const [attempted, setAttempted] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [now, setNow] = useState(() => Date.now());
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

  /** Bilinen kodu çevirir; genel kodlar `common.errors`, gerisi verilen yerel metin. */
  const apiText = useCallback(
    (err: unknown, fallback: string): string => {
      if (err instanceof ApiError) {
        if (err.code && ERROR_CODES.has(err.code)) return t(`errors.${err.code}`);
        const generic = errText(err);
        return generic !== err.message ? generic : fallback;
      }
      return err instanceof Error ? errText(err) : fallback;
    },
    [t, errText]
  );

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

  // Plan oluşunca odak durum bölümünün başlığına taşınır (form DOM'dan kalkar).
  useEffect(() => {
    if (plan && justCreated.current) {
      justCreated.current = false;
      statusHeadingRef.current?.focus();
    }
  }, [plan]);

  // Son ödeme saatine kalan süre yarım dakikada bir güncellenir.
  const planOpen = plan?.status === "COLLECTING" || plan?.status === "FALLBACK";
  useEffect(() => {
    if (!planOpen) return;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [planOpen]);

  const digits = fractionDigits(currency);
  const equalShare = Math.floor(totalMinor / (rows.length + 1));
  const amounts = rows.map((r) =>
    mode === "custom" ? parseAmountToMinor(r.amount, digits) : null
  );
  const normalizedEmails = rows.map((r) => r.email.trim().toLowerCase());
  const rowErrors = rows.map((r, i) => {
    const email =
      normalizedEmails[i] !== "" && normalizedEmails.indexOf(normalizedEmails[i]) !== i
        ? t("errors.emailDuplicate")
        : null;
    let amount: string | null = null;
    if (mode === "custom") {
      const v = amounts[i];
      if (r.amount.trim() === "") amount = t("errors.amountRequired");
      else if (v === null || v <= 0) amount = t("errors.amountInvalid");
    }
    return { email, amount };
  });
  const customValid = mode === "custom" && rowErrors.every((e) => !e.amount);
  const customSum = amounts.reduce<number>((acc, v) => acc + (v ?? 0), 0);
  const organizerMinor =
    mode === "equal" ? totalMinor - equalShare * rows.length : totalMinor - customSum;
  const overTotal = customValid && organizerMinor < 0;
  const organizerKnown = mode === "equal" || (customValid && !overTotal);
  const hasRowError = rowErrors.some((e) => e.email || e.amount);
  const showError = (key: string) => attempted || !!touched[key];
  const fieldId = (kind: "email" | "amount", i: number) => `${baseId}-${kind}-${i}`;
  const touch = (key: string) =>
    setTouched((prev) => (prev[key] ? prev : { ...prev, [key]: true }));

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setMessage(null);
    if (hasRowError || overTotal) {
      // Gönderim engellenir; nedeni alan altında yazar ve odak ilk hatalı alana gider.
      setAttempted(true);
      const first = rowErrors.findIndex((r) => r.email || r.amount);
      const target =
        first >= 0
          ? fieldId(rowErrors[first].email ? "email" : "amount", first)
          : fieldId("amount", 0);
      document.getElementById(target)?.focus();
      return;
    }
    setBusy(true);
    try {
      const participants = rows.map((r, i) => ({
        email: r.email.trim() || null,
        ...(mode === "custom" ? { amountMinor: amounts[i] ?? 0 } : {}),
      }));
      const res = await apiFetch<{ plan: SplitPlanDTO }>(`/api/cart/${cartId}/split`, {
        method: "POST",
        body: JSON.stringify({ mode, participants }),
      });
      justCreated.current = true;
      apply(res.plan);
    } catch (err) {
      setMessage(apiText(err, t("createFailed")));
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
      setMessage(apiText(err, t("sendFailed")));
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
      {notice && (
        <p role="status" className="mt-3 text-sm text-green-700">
          {notice}
        </p>
      )}
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
          <legend className="mb-2 w-full text-sm font-medium text-gray-700">
            {t("modeLegend")}
          </legend>
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
          {rows.map((row, i) => {
            const emailId = fieldId("email", i);
            const amountId = fieldId("amount", i);
            const emailErr = showError(`email-${i}`) ? rowErrors[i].email : null;
            const amountErr = showError(`amount-${i}`) ? rowErrors[i].amount : null;
            return (
              <li key={i} className="flex flex-wrap items-start gap-3">
                <div className="min-w-[12rem] flex-1">
                  <label htmlFor={emailId} className="text-sm font-medium text-gray-700">
                    {t("participant", { n: i + 1 })} · {t("emailLabel")}
                  </label>
                  <input
                    id={emailId}
                    type="email"
                    className={field}
                    value={row.email}
                    autoComplete="off"
                    aria-invalid={emailErr ? true : undefined}
                    aria-describedby={emailErr ? `${emailId}-err` : undefined}
                    onBlur={() => touch(`email-${i}`)}
                    onChange={(e) =>
                      setRows(rows.map((r, j) => (j === i ? { ...r, email: e.target.value } : r)))
                    }
                  />
                  {emailErr && (
                    <p id={`${emailId}-err`} className="mt-1 text-xs text-red-700">
                      {emailErr}
                    </p>
                  )}
                </div>
                {mode === "custom" ? (
                  <div className="w-40">
                    <label htmlFor={amountId} className="text-sm font-medium text-gray-700">
                      <span className="sr-only">{t("participant", { n: i + 1 })} · </span>
                      {t("amountLabel")} ({currency})
                    </label>
                    <input
                      id={amountId}
                      type="text"
                      inputMode="decimal"
                      className={field}
                      value={row.amount}
                      aria-invalid={amountErr ? true : undefined}
                      aria-describedby={
                        amountErr ? `${amountId}-err ${amountId}-hint` : `${amountId}-hint`
                      }
                      onBlur={() => touch(`amount-${i}`)}
                      onChange={(e) =>
                        setRows(
                          rows.map((r, j) => (j === i ? { ...r, amount: e.target.value } : r))
                        )
                      }
                      required
                    />
                    {amountErr && (
                      <p id={`${amountId}-err`} className="mt-1 text-xs text-red-700">
                        {amountErr}
                      </p>
                    )}
                    <p id={`${amountId}-hint`} className="mt-1 text-xs text-gray-500">
                      {t("amountHint")}
                    </p>
                  </div>
                ) : (
                  <span className="pt-7 text-sm text-gray-700">
                    {t("equalShare", { amount: f.money(equalShare, currency) })}
                  </span>
                )}
                {rows.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setRows(rows.filter((_, j) => j !== i))}
                    className="mt-5 min-h-[44px] min-w-[44px] text-sm font-semibold text-red-700 hover:underline"
                    aria-label={t("removeParticipantN", { n: i + 1 })}
                  >
                    ×
                  </button>
                )}
              </li>
            );
          })}
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
            {organizerKnown ? f.money(organizerMinor, currency) : "—"}
          </span>
        </div>
        <div aria-live="polite">
          {overTotal ? (
            <p className="text-sm text-red-700">
              {t("overTotal", {
                total: f.money(totalMinor, currency),
                excess: f.money(-organizerMinor, currency),
              })}
            </p>
          ) : (
            !organizerKnown && <p className="text-xs text-gray-500">{t("organizerPending")}</p>
          )}
        </div>
        <p className="text-xs text-gray-500">{t("remainderHint")}</p>
        <p id={`${baseId}-terms`} className="text-sm text-gray-700">
          {t("beforeCreate")}
        </p>
        {alerts}
        <button
          type="submit"
          disabled={busy}
          aria-busy={busy}
          aria-describedby={`${baseId}-terms`}
          className="w-full rounded-lg border border-[#003580] px-4 py-3 text-sm font-semibold text-[#003580] hover:bg-blue-50 disabled:border-gray-300 disabled:text-gray-500"
        >
          {busy ? t("creating") : t("create")}
        </button>
      </form>
    );
  }

  const open = planOpen;
  const minutesLeft = Math.max(0, Math.ceil((Date.parse(plan.deadlineAt) - now) / 60000));
  const shareName = (s: ShareDTO) =>
    s.isFallback
      ? t("fallbackLabel")
      : s.isOrganizer
        ? t("you")
        : (s.participantEmail ?? t("anonymous", { n: s.position }));
  return (
    <section
      className="mt-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"
      aria-label={t("sharesTitle")}
      data-testid="split-status"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2
          ref={statusHeadingRef}
          tabIndex={-1}
          className="text-lg font-semibold text-gray-900 focus:outline-none"
        >
          {t("title")}
        </h2>
        <span className="text-sm font-medium text-gray-700">{t(`planStatus.${plan.status}`)}</span>
      </div>
      {open && (
        <>
          <p className="mt-1 text-sm text-amber-700">
            {t("deadline", { time: f.dateTime(plan.deadlineAt) })}{" "}
            <span className="font-semibold">{t("deadlineLeft", { minutes: minutesLeft })}</span>
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
              <span className="text-gray-800">{shareName(s)}</span>
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
                      aria-label={t("copyLinkFor", { name: shareName(s) })}
                      className="rounded-md border border-gray-300 px-3 py-1 font-semibold text-gray-800"
                    >
                      {t("copyLink")}
                    </button>
                    {!s.participantEmail && (
                      <label className="flex flex-col text-xs font-medium text-gray-700">
                        <span>
                          {t("inviteEmailLabel")}
                          <span className="sr-only"> · {shareName(s)}</span>
                        </span>
                        <input
                          type="email"
                          autoComplete="off"
                          className="w-48 rounded-md border border-gray-300 px-2 py-1 text-sm"
                          value={emails[s.id] ?? ""}
                          onChange={(e) => setEmails({ ...emails, [s.id]: e.target.value })}
                        />
                      </label>
                    )}
                    <button
                      type="button"
                      disabled={busy || (!s.participantEmail && !emails[s.id]?.trim())}
                      onClick={() => void sendInvite(s)}
                      aria-label={t("sendEmailFor", { name: shareName(s) })}
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
