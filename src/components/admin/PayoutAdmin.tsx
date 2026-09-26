"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api-client";
import { useFormat } from "@/i18n/use-format";
import { Button, Card, Status, errorMessage, inputClass, useLoader } from "@/components/ui/ui";

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

  const toggle = async (row: AccountRow) => {
    setBusy(row.userId);
    setActionError(null);
    setMessage(null);
    try {
      const reason = reasons[row.userId]?.trim();
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
                  <label className="text-xs text-gray-700">
                    {t("admin.reason")}
                    <input
                      className={inputClass}
                      maxLength={500}
                      value={reasons[row.userId] ?? ""}
                      onChange={(e) => setReasons({ ...reasons, [row.userId]: e.target.value })}
                    />
                  </label>
                )}
                <Button
                  variant={row.payoutsPaused ? "primary" : "danger"}
                  disabled={busy === row.userId}
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
    </Card>
  );
}
