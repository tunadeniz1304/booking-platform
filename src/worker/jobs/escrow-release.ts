import type { Queue } from "bullmq";
import { getConfig } from "@/lib/config/app-config";
import { runEscrowRelease } from "@/lib/payout/escrow";

/**
 * Escrow serbest bırakma işi (P1-4): yerel giriş + `PAYOUT_RELEASE_HOURS` geçmiş
 * rezervasyonların emanetini ev sahibine (komisyon + rezerv ayrılarak) ayırır, süresi dolan
 * rezervleri açar. Jurnal anahtarları idempotent → tekrar/eşzamanlı çalışma güvenli.
 */
export const ESCROW_RELEASE_JOB = "escrow-release";

export async function scheduleEscrowRelease(queue: Queue): Promise<void> {
  await queue.upsertJobScheduler(
    ESCROW_RELEASE_JOB,
    { pattern: getConfig().ESCROW_RELEASE_CRON, tz: "UTC" },
    { name: ESCROW_RELEASE_JOB, data: {}, opts: { removeOnComplete: true, removeOnFail: 100 } }
  );
}

export async function runEscrowReleaseJob(now = new Date()) {
  return runEscrowRelease(now);
}
