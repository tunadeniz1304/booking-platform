import type { Job, Queue } from "bullmq";
import { getConfig } from "@/lib/config/app-config";
import {
  CLAIM_SLA_CHECK_JOB,
  CLAIM_SLA_SWEEP_JOB,
  checkClaimSla,
  sweepClaimSla,
} from "@/lib/resolution/claims";
import {
  DEPOSIT_SWEEP_JOB,
  DEPOSIT_VOID_JOB,
  releaseDeposit,
  sweepDeposits,
} from "@/lib/resolution/deposit";

/**
 * `resolution` kuyruğu (P1-5): talep yanıt SLA'sının gecikmeli kontrolü, depozito void'i
 * (çıkış + DEPOSIT_HOLD_DAYS) ve kaybolan işler için iki yedek süpürücü (UTC cron).
 */
export async function processResolutionJob(job: Job<{ claimId?: string; depositId?: string }>) {
  if (job.name === CLAIM_SLA_CHECK_JOB) {
    if (!job.data.claimId) throw new Error("claimId zorunlu");
    return checkClaimSla(job.data.claimId);
  }
  if (job.name === DEPOSIT_VOID_JOB) {
    if (!job.data.depositId) throw new Error("depositId zorunlu");
    return releaseDeposit(job.data.depositId);
  }
  if (job.name === CLAIM_SLA_SWEEP_JOB) return sweepClaimSla();
  if (job.name === DEPOSIT_SWEEP_JOB) return sweepDeposits();
  throw new Error(`Bilinmeyen çözüm merkezi işi: ${job.name}`);
}

/** İdempotent scheduler'lar. */
export async function scheduleResolutionSweeps(queue: Queue): Promise<void> {
  const cfg = getConfig();
  const opts = { removeOnComplete: true, removeOnFail: 100 };
  await queue.upsertJobScheduler(
    CLAIM_SLA_SWEEP_JOB,
    { pattern: cfg.CLAIM_SLA_SWEEP_CRON, tz: "UTC" },
    { name: CLAIM_SLA_SWEEP_JOB, data: {}, opts }
  );
  await queue.upsertJobScheduler(
    DEPOSIT_SWEEP_JOB,
    { pattern: cfg.DEPOSIT_SWEEP_CRON, tz: "UTC" },
    { name: DEPOSIT_SWEEP_JOB, data: {}, opts }
  );
}
