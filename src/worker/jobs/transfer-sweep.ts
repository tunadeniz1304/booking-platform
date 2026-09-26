import type { Queue } from "bullmq";
import { getConfig } from "@/lib/config/app-config";
import { sweepStuckTransfers } from "@/lib/transfer/transfer-service";

/**
 * Takılı devir süpürücüsü (v4#1): `CAPTURE_PENDING`'de eşikten uzun kalan devirleri
 * void/iade edip FAILED'a çeker. Zamanlama `TRANSFER_SWEEP_CRON` (UTC).
 */
export const TRANSFER_SWEEP_JOB = "transfer-sweep";

/** İdempotent scheduler. */
export async function scheduleTransferSweep(queue: Queue): Promise<void> {
  await queue.upsertJobScheduler(
    TRANSFER_SWEEP_JOB,
    { pattern: getConfig().TRANSFER_SWEEP_CRON, tz: "UTC" },
    { name: TRANSFER_SWEEP_JOB, data: {}, opts: { removeOnComplete: true, removeOnFail: 100 } }
  );
}

export async function runTransferSweep(now = new Date()) {
  return sweepStuckTransfers(now);
}
