import type { Queue } from "bullmq";
import { getConfig } from "@/lib/config/app-config";
import { pruneFxRates, refreshFxRates } from "@/lib/fx/store";

/**
 * Günlük kur yenileme (P0-5): TCMB → ECB → statik yedek; her çalışma yeni `FxRate` satırı.
 * Ardından saklama süresini aşan, rezervasyona bağlı olmayan satırlar budanır.
 */
export const FX_REFRESH_JOB = "fx-refresh";

/** İdempotent scheduler (birden çok worker güvenli); desen `FX_REFRESH_CRON`, UTC. */
export async function scheduleFxRefresh(queue: Queue): Promise<void> {
  await queue.upsertJobScheduler(
    FX_REFRESH_JOB,
    { pattern: getConfig().FX_REFRESH_CRON, tz: "UTC" },
    { name: FX_REFRESH_JOB, data: {}, opts: { removeOnComplete: true, removeOnFail: 100 } }
  );
}

export async function runFxRefresh(): Promise<{ source: string; stale: boolean; pruned: number }> {
  const table = await refreshFxRates();
  const pruned = await pruneFxRates();
  return { source: table.source, stale: table.stale, pruned };
}
