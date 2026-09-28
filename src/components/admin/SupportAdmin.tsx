"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api-client";
import { useFormat } from "@/i18n/use-format";
import { Button, Card, Status, errorMessage, inputClass, useLoader } from "@/components/ui/ui";

type TicketStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED";

interface TicketRow {
  id: string;
  bookingId: string | null;
  status: TicketStatus;
  reason: "LOW_CONFIDENCE" | "MONEY_REQUEST" | "LEGAL_OR_COMPLAINT" | "USER_REQUEST";
  intent: string;
  confidence: number;
  summary: string;
  locale: string;
  createdAt: string;
}

const STATUSES: readonly TicketStatus[] = ["OPEN", "IN_PROGRESS", "RESOLVED"];

/** v5 P1-4: insan destek kuyruğu — filtrele, incelemeye al, çöz (denetim kayıtlı). */
export default function SupportAdmin() {
  const t = useTranslations("support.admin");
  const f = useFormat();
  const filterId = useId();
  const [status, setStatus] = useState<TicketStatus | "">("OPEN");
  const { data, error, reload } = useLoader(
    () =>
      apiFetch<{ tickets: TicketRow[] }>(
        `/api/admin/support${status ? `?status=${encodeURIComponent(status)}` : ""}`
      ),
    [status]
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const update = async (id: string, next: TicketStatus) => {
    setBusy(id);
    setMessage(null);
    setActionError(null);
    try {
      await apiFetch(`/api/admin/support/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ status: next }),
      });
      setMessage(t("updated"));
      reload();
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card title={t("title")} id="support-admin">
      <label htmlFor={filterId} className="block text-sm font-medium text-gray-900">
        {t("filter")}
      </label>
      <select
        id={filterId}
        className={`${inputClass} mb-4 max-w-xs`}
        value={status}
        onChange={(e) => setStatus(e.target.value as TicketStatus | "")}
      >
        <option value="">{t("all")}</option>
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {t(`status.${s}`)}
          </option>
        ))}
      </select>
      {error ? (
        <Status error={error} />
      ) : !data ? (
        <p className="text-sm text-gray-600">{t("loading")}</p>
      ) : data.tickets.length === 0 ? (
        <p className="text-sm text-gray-700">{t("empty")}</p>
      ) : (
        <ul className="space-y-3">
          {data.tickets.map((row) => (
            <li key={row.id} className="rounded-md border border-gray-200 p-3 text-sm">
              <p className="font-medium text-gray-900">
                {t(`reason.${row.reason}`)} · {t(`status.${row.status}`)} ·{" "}
                {f.dateTime(row.createdAt)}
              </p>
              <p className="text-gray-700">
                {row.intent} · {t("confidence", { value: row.confidence.toFixed(2) })}
                {row.bookingId ? ` · ${t("booking", { id: row.bookingId })}` : ""}
              </p>
              <p className="mt-1 whitespace-pre-line text-gray-900">{row.summary}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {row.status === "OPEN" && (
                  <Button
                    variant="secondary"
                    disabled={busy === row.id}
                    onClick={() => update(row.id, "IN_PROGRESS")}
                  >
                    {t("markInProgress")}
                  </Button>
                )}
                {row.status !== "RESOLVED" ? (
                  <Button disabled={busy === row.id} onClick={() => update(row.id, "RESOLVED")}>
                    {t("markResolved")}
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    disabled={busy === row.id}
                    onClick={() => update(row.id, "OPEN")}
                  >
                    {t("reopen")}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <Status error={actionError} message={message} />
    </Card>
  );
}
