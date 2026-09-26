import type { Queue } from "bullmq";
import { getConfig } from "@/lib/config/app-config";
import {
  runPayoutEngine,
  type PayoutRunOptions,
  type PayoutRunResult,
} from "@/lib/payout/payout-engine";

/**
 * Payout işi (P1-4, ADR 0021): devir payout'ları + serbest bırakılmış host_payable
 * bakiyesinden ev sahibi payout'ları tek motordan (`src/lib/payout/payout-engine.ts`),
 * payout sağlayıcı arayüzü üzerinden (Stripe Connect ya da mock) gönderilir. Eski doğrudan
 * mock yolu kaldırıldı; devir payout'larının `po_mock_…` referans biçimi korunur.
 */
export const PAYOUT_JOB = "payouts";

/** İdempotent scheduler; desen `PAYOUT_CRON`, UTC. */
export async function schedulePayouts(queue: Queue): Promise<void> {
  await queue.upsertJobScheduler(
    PAYOUT_JOB,
    { pattern: getConfig().PAYOUT_CRON, tz: "UTC" },
    { name: PAYOUT_JOB, data: {}, opts: { removeOnComplete: true, removeOnFail: 100 } }
  );
}

export async function runPayouts(
  now = new Date(),
  opts: PayoutRunOptions = {}
): Promise<PayoutRunResult> {
  return runPayoutEngine(now, opts);
}
