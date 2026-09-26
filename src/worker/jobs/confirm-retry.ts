import type { Job } from "bullmq";
import { processConfirmRetry, type ConfirmRetryOutcome } from "@/lib/cart/confirm-retry-job";
import {
  CONFIRM_RETRY_JOB,
  confirmRetryTotal,
  type ConfirmRetryData,
} from "@/lib/cart/confirm-pending";
import { logger, errorFields } from "@/lib/observability/logger";

/**
 * `confirm-retry` işçisi (fix-sweep-3): capture sonrası çakışan onayı yeniden dener. Son
 * denemede (`attemptsMade + 1 >= attempts`) onay yine olmazsa iade + iptal yapılır.
 */
export async function processConfirmRetryJob(
  job: Job<ConfirmRetryData>
): Promise<ConfirmRetryOutcome> {
  if (job.name !== CONFIRM_RETRY_JOB) throw new Error(`Bilinmeyen onay işi: ${job.name}`);
  const final = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
  return processConfirmRetry(job.data, { final });
}

export function onConfirmRetryFailed(job: Job<ConfirmRetryData> | undefined, error: Error): void {
  const exhausted = !!job && job.attemptsMade >= (job.opts.attempts ?? 1);
  if (exhausted) confirmRetryTotal.inc({ outcome: "exhausted" });
  logger.error(
    { jobId: job?.id, ...job?.data, exhausted, ...errorFields(error) },
    exhausted ? "confirm retry exhausted; manual review required" : "confirm retry failed"
  );
}
