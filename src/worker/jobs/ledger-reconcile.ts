import type { Queue } from "bullmq";
import { getConfig } from "@/lib/config/app-config";
import { reconcile } from "@/lib/ledger/reconcile";
import { audit } from "@/lib/admin/audit";
import { logger } from "@/lib/observability/logger";

/**
 * Günlük defter mutabakatı (P0-3): dünün (UTC) PSP kayıtları ↔ jurnal. Fark varsa uyarı
 * logu + denetim kaydı; ayrıntı `GET /api/admin/reconciliation?date=` ile okunur.
 * Zamanlama `LEDGER_RECONCILE_CRON` (UTC).
 */
export const LEDGER_RECONCILE_JOB = "ledger-reconcile";

/** İdempotent scheduler. */
export async function scheduleLedgerReconcile(queue: Queue): Promise<void> {
  await queue.upsertJobScheduler(
    LEDGER_RECONCILE_JOB,
    { pattern: getConfig().LEDGER_RECONCILE_CRON, tz: "UTC" },
    { name: LEDGER_RECONCILE_JOB, data: {}, opts: { removeOnComplete: true, removeOnFail: 100 } }
  );
}

export async function runLedgerReconcile(now = new Date()) {
  const day = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
  const report = await reconcile(day);
  const summary = {
    date: report.date,
    checked: report.checked,
    differences: report.differences.length,
    imbalancedEntries: report.imbalancedEntries,
    orphanEvents: report.orphanEvents.length,
  };
  if (report.ok) {
    logger.info(summary, "ledger reconciliation clean");
  } else {
    logger.warn(summary, "ledger reconciliation found differences");
  }
  await audit("system:ledger-reconcile", "ledger.reconciliation", "Ledger", report.date, {
    ...summary,
    ok: report.ok,
  });
  return summary;
}
