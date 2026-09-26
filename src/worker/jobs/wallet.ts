import type { Queue } from "bullmq";
import { getConfig } from "@/lib/config/app-config";
import { runWalletSweep } from "@/lib/wallet/wallet-service";

/**
 * Cüzdan işi (P1-7): vadesi gelen cashback'leri krediye çevirir, süresi dolan kredi
 * lot'larının kalanını ters jurnalle (creditExpired) düşer, bayat kredi rezervlerini bırakır.
 * Jurnal anahtarları idempotent → tekrar/eşzamanlı çalışma güvenli.
 */
export const WALLET_SWEEP_JOB = "wallet-sweep";

export async function scheduleWalletSweep(queue: Queue): Promise<void> {
  await queue.upsertJobScheduler(
    WALLET_SWEEP_JOB,
    { pattern: getConfig().WALLET_SWEEP_CRON, tz: "UTC" },
    { name: WALLET_SWEEP_JOB, data: {}, opts: { removeOnComplete: true, removeOnFail: 100 } }
  );
}

export async function runWalletSweepJob(now = new Date()) {
  return runWalletSweep(now);
}
