import type { Job } from "bullmq";
import {
  REFUND_RETRY_JOB,
  refundRetryTotal,
  retryFailedRefund,
  type RefundRetryResult,
} from "@/lib/payment/payment-service";
import { logger, errorFields } from "@/lib/observability/logger";

/**
 * `refund-retry` işçisi (v4#7): başarısız PSP iadesini yeniden dener. Hata fırlatılırsa
 * BullMQ üstel geri çekilmeyle tekrar dener (deneme sayısı işte, config'ten).
 */
export async function processRefundRetry(
  job: Job<{ bookingId: string }>
): Promise<RefundRetryResult> {
  if (job.name !== REFUND_RETRY_JOB) throw new Error(`Bilinmeyen iade işi: ${job.name}`);
  return retryFailedRefund(job.data.bookingId);
}

/** Son deneme de düştüyse iş yönetici kuyruğuna kalır (`/api/admin/refunds`). */
export function onRefundRetryFailed(
  job: Job<{ bookingId: string }> | undefined,
  error: Error
): void {
  const exhausted = !!job && job.attemptsMade >= (job.opts.attempts ?? 1);
  if (exhausted) refundRetryTotal.inc({ outcome: "exhausted" });
  logger.error(
    { jobId: job?.id, bookingId: job?.data.bookingId, exhausted, ...errorFields(error) },
    exhausted ? "refund retry exhausted; manual review required" : "refund retry failed"
  );
}
