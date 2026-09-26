import type { Queue } from "bullmq";
import { getConfig } from "@/lib/config/app-config";
import { pruneExpiredData, type RetentionResult } from "@/lib/privacy/retention";

/** P0-5 veri yaşam döngüsü: saklama süresi dolan operasyonel kayıtları partiler hâlinde siler. */
export const DATA_RETENTION_JOB = "data-retention";

/** Gecelik tekrarlı iş (idempotent scheduler — birden çok worker güvenli). */
export async function scheduleDataRetention(queue: Queue): Promise<void> {
  await queue.upsertJobScheduler(
    DATA_RETENTION_JOB,
    { pattern: getConfig().RETENTION_CRON, tz: "UTC" },
    { name: DATA_RETENTION_JOB, data: {}, opts: { removeOnComplete: true, removeOnFail: 100 } }
  );
}

export async function runDataRetention(now = new Date()): Promise<RetentionResult> {
  return pruneExpiredData(now);
}
