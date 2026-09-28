import type { Job, Queue } from "bullmq";
import { getConfig } from "@/lib/config/app-config";
import {
  RNPL_CHARGE_JOB,
  RNPL_SWEEP_JOB,
  chargeRnplSchedule,
  sweepRnplCharges,
} from "@/lib/payment/rnpl";

/**
 * `rnpl` kuyruğu (P1-3): vadede (ya da yeniden deneme anında) gecikmeli `rnpl-charge` ve kaybolan
 * işler için yedek süpürücü (`rnpl-sweep`, UTC cron).
 */
export async function processRnplJob(job: Job<{ scheduleId?: string }>) {
  if (job.name === RNPL_CHARGE_JOB) {
    if (!job.data.scheduleId) throw new Error("scheduleId zorunlu");
    return chargeRnplSchedule(job.data.scheduleId);
  }
  if (job.name === RNPL_SWEEP_JOB) return sweepRnplCharges();
  throw new Error(`Bilinmeyen RNPL işi: ${job.name}`);
}

/** İdempotent scheduler. */
export async function scheduleRnplSweep(queue: Queue): Promise<void> {
  await queue.upsertJobScheduler(
    RNPL_SWEEP_JOB,
    { pattern: getConfig().RNPL_SWEEP_CRON, tz: "UTC" },
    { name: RNPL_SWEEP_JOB, data: {}, opts: { removeOnComplete: true, removeOnFail: 100 } }
  );
}
