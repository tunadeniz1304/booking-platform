"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api-client";
import { useFormat } from "@/i18n/use-format";
import { Button, Card, Status, errorMessage, inputClass, useLoader } from "@/components/ui/ui";
import { useConfirm } from "@/components/ui/ConfirmDialog";

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
}

/** Yönetici payout kontrolü (P1-4): ev sahibi başına durdur / devam et (denetim kayıtlı). */
export default function PayoutAdmin() {
  const t = useTranslations("payouts");
  const f = useFormat();
  const { data, error, reload } = useLoader(
    () => apiFetch<{ accounts: AccountRow[] }>("/api/admin/payouts"),
    []
  );
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reasonMissing, setReasonMissing] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirm();

  const toggle = async (row: AccountRow) => {
    if (busy) return;
    const reason = reasons[row.userId]?.trim();
    setActionError(null);
    setMessage(null);
    setReasonMissing(null);
    if (!row.payoutsPaused) {
      // Durdurma denetim kaydına gerekçesiyle yazılsın: gerekçe zorunlu ve onay adımında gösterilir.
      if (!reason) {
        setReasonMissing(row.userId);
        document.getElementById(`payout-reason-${row.userId}`)?.focus();
        return;
      }
      const ok = await confirm({
        title: t("admin.confirmPause.title", { name: row.displayName }),
        body: t("admin.confirmPause.body", { count: row.pendingPayouts, reason }),
        confirmLabel: t("admin.confirmPause.confirm"),
        tone: "danger",
      });
      if (!ok) return;
    }
    setBusy(row.userId);
    try {
      await apiFetch(`/api/admin/payouts/${encodeURIComponent(row.userId)}`, {
        method: "POST",
        body: JSON.stringify({ paused: !row.payoutsPaused, ...(reason ? { reason } : {}) }),
      });
      setMessage(row.payoutsPaused ? t("admin.resumed") : t("admin.paused"));
      reload();
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  if (error) return <Status error={error} />;
  if (!data) return <p className="text-sm text-gray-600">{t("loading")}</p>;
  return (
    <Card title={t("admin.title")} id="payout-admin">
      {data.accounts.length === 0 ? (
        <p className="text-sm text-gray-700">{t("admin.empty")}</p>
      ) : (
        <ul className="space-y-3">
          {data.accounts.map((row) => (
            <li key={row.userId} className="rounded-md border border-gray-200 p-3 text-sm">
              <p className="font-medium">
                {row.displayName} · {t(`kyc.${row.kycStatus}`)} ·{" "}
                {row.payoutsPaused ? t("blocked.PAUSED") : t("account.active")}
              </p>
              <p className="text-gray-600">
                {t("admin.pending", { count: row.pendingPayouts })}
                {row.pausedAt ? ` · ${f.dateTime(row.pausedAt)}` : ""}
                {row.pausedReason ? ` · ${row.pausedReason}` : ""}
              </p>
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
                  onClick={() => toggle(row)}
                >
                  {row.payoutsPaused ? t("admin.resume") : t("admin.pause")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Status error={actionError} message={message} />
      {confirmDialog}
    </Card>
  );
}
