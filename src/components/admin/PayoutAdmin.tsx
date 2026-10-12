"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api-client";
import { useFormat } from "@/i18n/use-format";
import { Button, Card, Field, Status, inputClass, useLoader } from "@/components/ui/ui";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { shortRef } from "@/lib/ui/short-ref";
import { isStaleRecord, useAdminErrorText } from "@/components/admin/admin-error-text";

type BlockReason = "PAUSED" | "PROVIDER_DISABLED" | "IDENTITY_UNVERIFIED";

interface AccountRow {
  userId: string;
  displayName: string;
  provider: string;
  kycStatus: "NOT_STARTED" | "PENDING" | "VERIFIED" | "REJECTED";
  payoutsEnabled: boolean;
  payoutsPaused: boolean;
  pausedReason: string | null;
  pausedAt: string | null;
  pendingPayouts: number;
  /** Sunucu `payoutBlockReason` sonucunu dönerse o kullanılır (kimlik koşulu dahil). */
  blockReason?: BlockReason | null;
}

type AccountFilter = "all" | "paused" | "pending";
const FILTERS: AccountFilter[] = ["all", "paused", "pending"];

const SEARCH_ID = "payout-admin-search";
const FILTER_ID = "payout-admin-filter";
const WARN_ICON = "⚠︎";
const OK_ICON = "✓";

/** Ödeme engeli, sunucudaki `payoutBlockReason` sırasıyla: durdurma > sağlayıcı izni. */
function blockReasonOf(row: AccountRow): BlockReason | null {
  if (row.blockReason !== undefined) return row.blockReason;
  if (row.payoutsPaused) return "PAUSED";
  if (!row.payoutsEnabled) return "PROVIDER_DISABLED";
  return null;
}

interface RowFeedback {
  userId: string;
  message: string | null;
  error: string | null;
}

/** Yönetici payout kontrolü (P1-4): ev sahibi başına durdur / devam et (denetim kayıtlı). */
export default function PayoutAdmin() {
  const t = useTranslations("payouts");
  const tc = useTranslations("common");
  const ta = useTranslations("admin");
  const locale = useLocale();
  const f = useFormat();
  const errorText = useAdminErrorText();
  const [retrying, setRetrying] = useState(false);
  const { data, error, reload } = useLoader(
    () =>
      apiFetch<{ accounts: AccountRow[] }>("/api/admin/payouts").finally(() => setRetrying(false)),
    []
  );
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<RowFeedback | null>(null);
  const [reasonMissing, setReasonMissing] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<AccountFilter>("all");
  const refocusAfterRetry = useRef(false);
  const { confirm, confirmDialog } = useConfirm();

  // Başarılı yeniden denemede "Tekrar dene" düğmesi kalkar; odak <body>'ye düştüyse ilk denetime.
  useEffect(() => {
    if (!data || error || !refocusAfterRetry.current) return;
    refocusAfterRetry.current = false;
    if (document.activeElement === document.body) document.getElementById(SEARCH_ID)?.focus();
  }, [data, error]);

  const retry = () => {
    refocusAfterRetry.current = true;
    setRetrying(true);
    reload();
  };

  const toggle = async (row: AccountRow) => {
    if (busy) return;
    const pausing = !row.payoutsPaused;
    const reason = reasons[row.userId]?.trim();
    setFeedback(null);
    setReasonMissing(null);
    if (pausing) {
      // Durdurma denetim kaydına gerekçesiyle yazılsın: gerekçe zorunlu ve onay adımında gösterilir.
      if (!reason) {
        setReasonMissing(row.userId);
        document.getElementById(`payout-reason-${row.userId}`)?.focus();
        return;
      }
      const ok = await confirm({
        title: t("admin.confirmPause.title", {
          name: `${row.displayName} (${shortRef(row.userId)})`,
        }),
        body: t("admin.confirmPause.body", { count: row.pendingPayouts, reason }),
        confirmLabel: t("admin.confirmPause.confirm"),
        tone: "danger",
      });
      if (!ok) return;
    } else {
      // F2-08: devam ettirme de bekleyen ödemeleri serbest bırakır; yanlış tıklamaya karşı onay.
      const ok = await confirm({
        title: ta("confirmResume.title", {
          name: row.displayName,
          shortId: shortRef(row.userId),
        }),
        body: (
          <>
            <span className="block">{ta("confirmResume.body", { count: row.pendingPayouts })}</span>
            <span className="mt-1 block break-words">
              {row.pausedReason
                ? ta("confirmResume.reason", { reason: row.pausedReason })
                : ta("confirmResume.noReason")}
            </span>
          </>
        ),
        confirmLabel: ta("confirmResume.confirm"),
        tone: "danger",
      });
      if (!ok) return;
    }
    // Sonuç bölgesi istekten önce satırda açılır; içerik değişince ekran okuyucu duyurur.
    setFeedback({ userId: row.userId, message: null, error: null });
    setBusy(row.userId);
    try {
      await apiFetch(`/api/admin/payouts/${encodeURIComponent(row.userId)}`, {
        method: "POST",
        // Gerekçe yalnız durdururken gönderilir; devam ettirme kaydına eski gerekçe yazılmaz.
        body: JSON.stringify({ paused: pausing, ...(pausing ? { reason } : {}) }),
      });
      setFeedback({
        userId: row.userId,
        message: pausing ? t("admin.paused") : t("admin.resumed"),
        error: null,
      });
      setReasons((prev) => {
        const next = { ...prev };
        delete next[row.userId];
        return next;
      });
      reload();
    } catch (e) {
      // Kayıt başka bir yöneticice değiştirilmiş/kaldırılmışsa liste güncel hâliyle yenilenir.
      const stale = isStaleRecord(e);
      setFeedback({
        userId: row.userId,
        message: null,
        error: stale ? ta("staleRecord") : errorText(e),
      });
      if (stale) reload();
    } finally {
      setBusy(null);
    }
  };

  const accounts = data?.accounts ?? [];
  // Yenilemeden sonra satırı kalmayan hesabın sonucu listenin üstünde gösterilir.
  const orphanFeedback =
    feedback && !accounts.some((row) => row.userId === feedback.userId) ? feedback : null;
  const needle = query.trim().toLocaleLowerCase(locale);
  const visible = accounts.filter((row) => {
    // İşlem yapılan satır, sonucu okunana kadar filtreden bağımsız görünür kalır.
    if (row.userId === feedback?.userId) return true;
    if (filter === "paused" && !row.payoutsPaused) return false;
    if (filter === "pending" && row.pendingPayouts === 0) return false;
    return (
      !needle ||
      row.displayName.toLocaleLowerCase(locale).includes(needle) ||
      // Kimlik yerel kuralsız karşılaştırılır (tr'de "I" -> "ı" eşleşmeyi bozar).
      row.userId.toLowerCase().includes(query.trim().toLowerCase())
    );
  });

  return (
    <Card title={t("admin.title")} id="payout-admin">
      {error && (
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <Status error={error} />
          <Button variant="secondary" busy={retrying} onClick={retry}>
            {tc("errorPage.retry")}
          </Button>
        </div>
      )}
      {orphanFeedback && (
        <div className="mb-3">
          <Status error={orphanFeedback.error} message={orphanFeedback.message} />
        </div>
      )}
      {!data ? (
        !error && (
          <p role="status" className="text-sm text-gray-600">
            {t("loading")}
          </p>
        )
      ) : accounts.length === 0 ? (
        <p className="text-sm text-gray-700">{t("admin.empty")}</p>
      ) : (
        <>
          <div className="mb-2 grid gap-3 sm:grid-cols-[1fr_auto]">
            <Field label={t("admin.search.label")} id={SEARCH_ID} hint={t("admin.search.hint")}>
              <input
                id={SEARCH_ID}
                type="search"
                className={inputClass}
                autoComplete="off"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setFeedback(null);
                }}
              />
            </Field>
            <Field label={t("admin.filter.label")} id={FILTER_ID}>
              <select
                id={FILTER_ID}
                className={inputClass}
                value={filter}
                onChange={(e) => {
                  setFilter(e.target.value as AccountFilter);
                  setFeedback(null);
                }}
              >
                {FILTERS.map((key) => (
                  <option key={key} value={key}>
                    {t(`admin.filter.${key}`)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <p role="status" className="mb-3 text-xs text-gray-600">
            {visible.length === 0
              ? t("admin.noMatch")
              : t("admin.resultCount", { shown: visible.length, total: accounts.length })}
          </p>
          <ul className="space-y-3">
            {visible.map((row) => {
              const block = blockReasonOf(row);
              const rowFeedback = feedback?.userId === row.userId ? feedback : null;
              return (
                <li key={row.userId} className="rounded-md border border-gray-200 p-3 text-sm">
                  <p className="font-medium">
                    {row.displayName}{" "}
                    <span className="break-all font-normal text-gray-600">
                      {t("admin.userId", { id: shortRef(row.userId) })}
                    </span>
                  </p>
                  <p>
                    <span aria-hidden="true">{block ? WARN_ICON : OK_ICON} </span>
                    {block ? t(`blocked.${block}`) : t("account.active")} ·{" "}
                    {t(`kyc.${row.kycStatus}`)}
                  </p>
                  <p className="text-gray-600">
                    {t("admin.pending", { count: row.pendingPayouts })}
                  </p>
                  {row.pausedAt && (
                    <p className="text-gray-600">
                      {t("admin.pausedAt", { date: f.dateTime(row.pausedAt) })}
                    </p>
                  )}
                  {row.pausedReason && (
                    <p className="break-words text-gray-600">
                      {t("admin.pausedReason", { reason: row.pausedReason })}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    {!row.payoutsPaused && (
                      <div className="text-xs text-gray-700">
                        <label htmlFor={`payout-reason-${row.userId}`}>{t("admin.reason")}</label>
                        <input
                          id={`payout-reason-${row.userId}`}
                          className={inputClass}
                          maxLength={500}
                          required
                          autoComplete="off"
                          aria-invalid={reasonMissing === row.userId || undefined}
                          aria-describedby={
                            reasonMissing === row.userId
                              ? `payout-reason-${row.userId}-error`
                              : undefined
                          }
                          value={reasons[row.userId] ?? ""}
                          onChange={(e) => {
                            setReasons({ ...reasons, [row.userId]: e.target.value });
                            if (reasonMissing === row.userId) setReasonMissing(null);
                          }}
                        />
                        {reasonMissing === row.userId && (
                          <p id={`payout-reason-${row.userId}-error`} className="mt-1 text-red-700">
                            {t("admin.reasonRequired")}
                          </p>
                        )}
                      </div>
                    )}
                    <Button
                      variant={row.payoutsPaused ? "primary" : "danger"}
                      busy={busy === row.userId}
                      aria-describedby={
                        row.payoutsPaused ? undefined : `payout-pause-hint-${row.userId}`
                      }
                      // F2-52: düğme adı ev sahibini de söyler (admin.rowAction).
                      aria-label={ta("rowAction", {
                        action: row.payoutsPaused ? t("admin.resume") : t("admin.pause"),
                        name: row.displayName,
                      })}
                      onClick={() => toggle(row)}
                    >
                      {row.payoutsPaused ? t("admin.resume") : t("admin.pause")}
                    </Button>
                  </div>
                  {!row.payoutsPaused && (
                    <p
                      id={`payout-pause-hint-${row.userId}`}
                      className="mt-1 text-xs text-gray-600"
                    >
                      {t("admin.pauseHint", { count: row.pendingPayouts })}
                    </p>
                  )}
                  {rowFeedback && (
                    <div className="mt-2">
                      <Status error={rowFeedback.error} message={rowFeedback.message} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
      {confirmDialog}
    </Card>
  );
}
