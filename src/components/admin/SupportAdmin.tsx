"use client";

import { useId, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api-client";
import { useFormat } from "@/i18n/use-format";
import { Button, Card, Field, Status, focusRing, inputClass, useLoader } from "@/components/ui/ui";
import { useRowFocusRecovery } from "@/components/admin/AdminDashboard";
import { AdminCopyableId } from "@/components/admin/AdminCopyableId";
import { shortRef } from "@/lib/ui/short-ref";
import { isStaleRecord, useAdminErrorText } from "@/components/admin/admin-error-text";
import { useConfirm } from "@/components/ui/ConfirmDialog";

type TicketStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED";
/** "ACTIVE": açık + inceleniyor (varsayılan; incelemeye alınan talep listede kalır). */
type TicketFilter = TicketStatus | "ACTIVE" | "";

interface TicketRow {
  id: string;
  userId?: string | null;
  bookingId: string | null;
  status: TicketStatus;
  reason: "LOW_CONFIDENCE" | "MONEY_REQUEST" | "LEGAL_OR_COMPLAINT" | "USER_REQUEST";
  intent: string;
  confidence: number;
  summary: string;
  locale: string;
  createdAt: string;
  /** Talebi üstlenen yönetici (API sağlıyorsa). */
  handlerId?: string | null;
}

interface TicketGroup {
  key: string;
  rows: TicketRow[];
  /** Grubun ilk satırının düz listedeki sırası (odak kurtarma için). */
  start: number;
}

const STATUSES: readonly TicketStatus[] = ["OPEN", "IN_PROGRESS", "RESOLVED"];

const byCreatedAt = (a: TicketRow, b: TicketRow) =>
  a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;

async function fetchTickets(filter: TicketFilter): Promise<TicketRow[]> {
  const get = (s?: TicketStatus) =>
    apiFetch<{ tickets: TicketRow[] }>(
      `/api/admin/support${s ? `?status=${encodeURIComponent(s)}` : ""}`
    ).then((r) => r.tickets);
  if (filter !== "ACTIVE") return get(filter || undefined);
  const [open, inProgress] = await Promise.all([get("OPEN"), get("IN_PROGRESS")]);
  return [...open, ...inProgress].sort(byCreatedAt);
}

/** Aynı kullanıcının aynı rezervasyona ait talepleri tek grupta (ilk görülme sırası). */
function groupTickets(rows: TicketRow[]): TicketGroup[] {
  const groups = new Map<string, TicketGroup>();
  for (const row of rows) {
    const key = row.bookingId ? `${row.userId ?? ""}|${row.bookingId}` : row.id;
    const group = groups.get(key);
    if (group) group.rows.push(row);
    else groups.set(key, { key, rows: [row], start: 0 });
  }
  let start = 0;
  for (const group of groups.values()) {
    group.start = start;
    start += group.rows.length;
  }
  return [...groups.values()];
}

/**
 * v5 P1-4: insan destek kuyruğu — filtrele, ara, incelemeye al, çöz (denetim kayıtlı).
 * Aynı rezervasyonun yinelenen talepleri gruplanır; seçilenlere toplu işlem uygulanır.
 */
export default function SupportAdmin({ currentUserId }: { currentUserId?: string } = {}) {
  const t = useTranslations("support.admin");
  const tc = useTranslations("common");
  const ta = useTranslations("admin");
  const f = useFormat();
  const errorText = useAdminErrorText();
  const filterId = useId();
  const searchId = useId();
  const [status, setStatus] = useState<TicketFilter>("ACTIVE");
  const [query, setQuery] = useState("");
  const { data, error, loading, reload } = useLoader(() => fetchTickets(status), [status], {
    resetOnDepsChange: true,
  });
  const [busy, setBusy] = useState<{ key: string; ids: ReadonlySet<string> } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  // Bu oturumda güncellenen talepler: filtre değişene kadar listede kalır.
  const [touched, setTouched] = useState<ReadonlyMap<string, TicketRow>>(() => new Map());
  const markFocus = useRowFocusRecovery(data, "support-admin");
  const { confirm, confirmDialog } = useConfirm();

  const rows = useMemo(() => {
    if (!data) return null;
    const ids = new Set(data.map((r) => r.id));
    const kept = [...touched.values()].filter((r) => !ids.has(r.id));
    return kept.length > 0 ? [...data, ...kept].sort(byCreatedAt) : data;
  }, [data, touched]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!rows || !q) return rows;
    return rows.filter((r) =>
      [r.id, r.bookingId, r.userId].some((v) => v?.toLowerCase().includes(q))
    );
  }, [rows, query]);

  const groups = useMemo(() => (visible ? groupTickets(visible) : []), [visible]);
  const selectedRows = visible?.filter((r) => selected.has(r.id)) ?? [];
  const allSelected = !!visible && visible.length > 0 && selectedRows.length === visible.length;

  const changeFilter = (next: TicketFilter) => {
    setStatus(next);
    setTouched(new Map());
    setSelected(new Set());
  };

  const toggle = (id: string, on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  /** Tek ya da toplu durum geçişi; istekler sırayla gönderilir, başarısızlar sayılır. */
  const update = async (
    key: string,
    targets: TicketRow[],
    next: TicketStatus,
    index: number,
    skipped = 0
  ) => {
    if (busy || targets.length === 0) return;
    setBusy({ key, ids: new Set(targets.map((r) => r.id)) });
    setMessage(null);
    setActionError(null);
    const done: TicketRow[] = [];
    let failure: unknown = null;
    let failed = 0;
    // Başka yönetici işlemiş/kaldırmış: hata metni bunu söyler ve liste yenilenir.
    let stale = false;
    try {
      for (const row of targets) {
        try {
          await apiFetch(`/api/admin/support/${encodeURIComponent(row.id)}`, {
            method: "PATCH",
            body: JSON.stringify({ status: next }),
          });
          done.push({ ...row, status: next });
        } catch (e) {
          failure = e;
          failed += 1;
          if (isStaleRecord(e)) stale = true;
        }
      }
      if (done.length > 0) {
        setTouched((m) => {
          const copy = new Map(m);
          for (const row of done) copy.set(row.id, row);
          return copy;
        });
        setSelected((s) => {
          const copy = new Set(s);
          for (const row of done) copy.delete(row.id);
          return copy;
        });
        // Yeni durum ve talebin bundan sonra listelendiği filtre adıyla.
        const statusLabel = t(`status.${next}`);
        const filter = next === "RESOLVED" ? statusLabel : t("active");
        const result =
          targets.length === 1 && skipped === 0
            ? t("updatedTo", { status: statusLabel, filter })
            : t("bulkUpdatedTo", { count: done.length, status: statusLabel, filter });
        // F2-29: uygun olmadığı için atlanan seçili talepler de sonuçta söylenir.
        setMessage(skipped > 0 ? `${result} ${t("bulkSkipped", { count: skipped })}` : result);
        markFocus(index);
        reload();
      } else if (stale) {
        markFocus(index);
        reload();
      }
      if (failed > 0) {
        const reason = stale ? ta("staleRecord") : errorText(failure);
        setActionError(
          targets.length === 1 ? reason : t("bulkFailed", { count: failed, error: reason })
        );
      }
    } finally {
      setBusy(null);
    }
  };

  const bulk = async (next: TicketStatus) => {
    if (busy) return;
    const targets = selectedRows.filter((r) =>
      next === "IN_PROGRESS" ? r.status === "OPEN" : r.status !== "RESOLVED"
    );
    setMessage(null);
    setActionError(null);
    // F2-29: uygun talep kalmadıysa sessizce dönmek yerine nedeni söylenir.
    if (targets.length === 0) {
      setActionError(t("bulkNoneEligible", { count: selectedRows.length }));
      return;
    }
    if (next === "RESOLVED") {
      const ok = await confirm({
        title: t("confirmBulkResolve.title", { count: targets.length }),
        body: t("confirmBulkResolve.body"),
        confirmLabel: t("confirmBulkResolve.confirm"),
      });
      if (!ok) return;
    }
    const first = visible?.findIndex((r) => r.id === targets[0]?.id) ?? 0;
    void update(
      `bulk:${next}`,
      targets,
      next,
      Math.max(first, 0),
      selectedRows.length - targets.length
    );
  };

  const renderRow = (row: TicketRow, index: number) => {
    const rowBusy = !!busy?.ids.has(row.id);
    // F2-52: satır düğmelerinin adı kaydı da tanıtır (admin.rowAction).
    const rowName = `${t(`reason.${row.reason}`)} · ${t("ticketId", { id: shortRef(row.id) })}`;
    const rowLabel = (action: string) => ta("rowAction", { action, name: rowName });
    const mine =
      row.status === "IN_PROGRESS" &&
      ((!!currentUserId && row.handlerId === currentUserId) ||
        touched.get(row.id)?.status === "IN_PROGRESS");
    return (
      <li key={row.id} data-row className="rounded-md border border-gray-200 p-3 text-sm">
        <div className="flex items-start gap-3">
          <label className="-m-2 inline-flex min-h-[44px] min-w-[44px] items-center justify-center p-2">
            <input
              type="checkbox"
              checked={selected.has(row.id)}
              onChange={(e) => toggle(row.id, e.target.checked)}
              className={`h-4 w-4 rounded border-gray-400 text-[#003580] ${focusRing}`}
            />
            <span className="sr-only">{t("selectRow", { id: row.id })}</span>
          </label>
          <div className="min-w-0 flex-1">
            <p className="font-medium text-gray-900">
              {t(`reason.${row.reason}`)} · {t(`status.${row.status}`)} ·{" "}
              {f.dateTime(row.createdAt)}
              {mine && (
                <span className="ml-2 inline-block rounded bg-gray-100 px-1.5 py-0.5 text-xs font-semibold text-gray-800">
                  {t("assignedToYou")}
                </span>
              )}
            </p>
            <p className="break-words text-gray-700">
              <AdminCopyableId id={row.id} label={(id) => t("ticketId", { id })} />
              {row.userId && (
                <>
                  {" · "}
                  <AdminCopyableId id={row.userId} label={(id) => t("user", { id })} />
                </>
              )}
              {row.locale && ` · ${t("language", { locale: row.locale.toUpperCase() })}`}
            </p>
            <p className="text-gray-700">
              {t.has(`intent.${row.intent}`) ? t(`intent.${row.intent}`) : row.intent} ·{" "}
              {t("confidence", { value: f.number(row.confidence, { style: "percent" }) })}
              {row.bookingId && (
                <>
                  {" · "}
                  <AdminCopyableId id={row.bookingId} label={(id) => t("booking", { id })} />
                </>
              )}
            </p>
            {row.status === "IN_PROGRESS" && row.handlerId && !mine && (
              <p className="break-words text-gray-700">
                <AdminCopyableId id={row.handlerId} label={(id) => t("handler", { id })} />
              </p>
            )}
            <p className="mt-1 whitespace-pre-line text-gray-900">{row.summary}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {row.status === "OPEN" && (
                <Button
                  variant="secondary"
                  busy={rowBusy}
                  aria-label={rowLabel(t("markInProgress"))}
                  onClick={() => update(row.id, [row], "IN_PROGRESS", index)}
                >
                  {t("markInProgress")}
                </Button>
              )}
              {row.status !== "RESOLVED" ? (
                <Button
                  busy={rowBusy}
                  aria-label={rowLabel(t("markResolved"))}
                  onClick={() => update(row.id, [row], "RESOLVED", index)}
                >
                  {t("markResolved")}
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  busy={rowBusy}
                  aria-label={rowLabel(t("reopen"))}
                  onClick={() => update(row.id, [row], "OPEN", index)}
                >
                  {t("reopen")}
                </Button>
              )}
            </div>
          </div>
        </div>
      </li>
    );
  };

  const noneSelected = selectedRows.length === 0;

  return (
    <Card title={t("title")} id="support-admin">
      {confirmDialog}
      <div className="mb-4 flex flex-wrap gap-4">
        <div className="w-full max-w-xs">
          <Field id={filterId} label={t("filter")}>
            <select
              id={filterId}
              className={inputClass}
              value={status}
              onChange={(e) => changeFilter(e.target.value as TicketFilter)}
            >
              <option value="ACTIVE">{t("active")}</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`status.${s}`)}
                </option>
              ))}
              <option value="">{t("all")}</option>
            </select>
          </Field>
        </div>
        <div className="w-full max-w-xs">
          <Field id={searchId} label={t("search")}>
            <input
              id={searchId}
              type="search"
              className={inputClass}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
            />
          </Field>
        </div>
      </div>
      <div className="mb-3">
        <Status error={actionError} message={message} />
      </div>
      {error ? (
        <div className="space-y-2">
          <Status error={error} />
          <Button variant="secondary" busy={loading} onClick={reload}>
            {tc("errorPage.retry")}
          </Button>
        </div>
      ) : !rows || !visible ? (
        <p role="status" className="text-sm text-gray-600">
          {t("loading")}
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-700">{t("empty")}</p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md bg-gray-50 p-2 text-sm">
            <label className="inline-flex min-h-[44px] items-center gap-2 px-1 font-medium text-gray-900">
              <input
                type="checkbox"
                checked={allSelected}
                ref={(el) => {
                  if (el) el.indeterminate = !allSelected && selectedRows.length > 0;
                }}
                onChange={(e) =>
                  setSelected(e.target.checked ? new Set(visible.map((r) => r.id)) : new Set())
                }
                disabled={visible.length === 0}
                className={`h-4 w-4 rounded border-gray-400 text-[#003580] ${focusRing}`}
              />
              {t("selectAll", { count: visible.length })}
            </label>
            <span className="text-gray-700">
              {t("selectedCount", { count: selectedRows.length })}
            </span>
            <Button
              variant="secondary"
              aria-disabled={noneSelected || undefined}
              busy={busy?.key === "bulk:IN_PROGRESS"}
              onClick={() => void bulk("IN_PROGRESS")}
            >
              {t("bulkInProgress")}
            </Button>
            <Button
              variant="secondary"
              aria-disabled={noneSelected || undefined}
              busy={busy?.key === "bulk:RESOLVED"}
              onClick={() => void bulk("RESOLVED")}
            >
              {t("bulkResolve")}
            </Button>
          </div>
          {visible.length === 0 ? (
            <p className="text-sm text-gray-700">{t("noMatch")}</p>
          ) : (
            <ul className="space-y-3">
              {groups.map(({ key, rows: groupRows, start }) => {
                if (groupRows.length === 1) return renderRow(groupRows[0], start);
                const headingId = `${filterId}-g-${start}`;
                const unresolved = groupRows.filter((r) => r.status !== "RESOLVED");
                return (
                  <li key={key} className="rounded-md border border-gray-300 p-3">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <p id={headingId} className="text-sm font-semibold text-gray-900">
                        {t("groupTitle", { count: groupRows.length })}
                      </p>
                      {unresolved.length > 0 && (
                        <Button
                          variant="secondary"
                          aria-describedby={headingId}
                          busy={busy?.key === `group:${key}`}
                          onClick={() => update(`group:${key}`, unresolved, "RESOLVED", start)}
                        >
                          {t("groupResolveAll")}
                        </Button>
                      )}
                    </div>
                    <ul aria-labelledby={headingId} className="space-y-3">
                      {groupRows.map((row, i) => renderRow(row, start + i))}
                    </ul>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}
