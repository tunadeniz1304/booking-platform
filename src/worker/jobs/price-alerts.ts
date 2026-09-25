import type { Queue } from "bullmq";
import { getConfig } from "@/lib/config/app-config";
import { runPriceAlerts, type PriceAlertRun } from "@/lib/pricing/price-alerts";

/** Günlük fiyat alarmı taraması (P1-4); fiyat düşüşünde outbox → e-posta. */
export const PRICE_ALERT_JOB = "price-alerts";

/** İdempotent scheduler; desen `PRICE_ALERT_CRON`, UTC. */
export async function schedulePriceAlerts(queue: Queue): Promise<void> {
  await queue.upsertJobScheduler(
    PRICE_ALERT_JOB,
    { pattern: getConfig().PRICE_ALERT_CRON, tz: "UTC" },
    { name: PRICE_ALERT_JOB, data: {}, opts: { removeOnComplete: true, removeOnFail: 100 } }
  );
}

export async function runPriceAlertsJob(): Promise<PriceAlertRun> {
  return runPriceAlerts();
}
