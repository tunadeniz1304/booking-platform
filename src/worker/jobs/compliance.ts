import type { Job, Queue } from "bullmq";
import { getConfig } from "@/lib/config/app-config";
import {
  TAKEDOWN_SLA_CHECK_JOB,
  TAKEDOWN_SLA_SWEEP_JOB,
  checkTakedownSla,
  sweepTakedownSla,
} from "@/lib/compliance/takedown";

/**
 * `compliance` kuyruğu (P1-13a): 7565 kaldırma talebinin SLA bitişindeki gecikmeli kontrolü
 * ve kaybolan işler için yedek süpürücü (`TAKEDOWN_SLA_SWEEP_CRON`, UTC).
 */
export async function processComplianceJob(job: Job<{ takedownId?: string }>) {
  if (job.name === TAKEDOWN_SLA_CHECK_JOB) {
    if (!job.data.takedownId) throw new Error("takedownId zorunlu");
    return checkTakedownSla(job.data.takedownId);
  }
  if (job.name === TAKEDOWN_SLA_SWEEP_JOB) return sweepTakedownSla();
  throw new Error(`Bilinmeyen uyum işi: ${job.name}`);
}

/** İdempotent scheduler. */
export async function scheduleTakedownSlaSweep(queue: Queue): Promise<void> {
  await queue.upsertJobScheduler(
    TAKEDOWN_SLA_SWEEP_JOB,
    { pattern: getConfig().TAKEDOWN_SLA_SWEEP_CRON, tz: "UTC" },
    { name: TAKEDOWN_SLA_SWEEP_JOB, data: {}, opts: { removeOnComplete: true, removeOnFail: 100 } }
  );
}
