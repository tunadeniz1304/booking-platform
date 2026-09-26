import type { Job } from "bullmq";
import { compensateCartPayment } from "@/lib/cart/cart-payment";
import { compensateSplitPlan } from "@/lib/cart/split-payment";
import { retryPaymentCompensation } from "@/lib/payment/payment-service";
import {
  SAGA_COMPENSATION_RETRY_JOB,
  sagaCompensationRetryTotal,
  type CompensationRetryData,
} from "@/lib/saga/compensation-retry";
import { audit } from "@/lib/admin/audit";
import { logger, errorFields } from "@/lib/observability/logger";

/**
 * `saga-compensation-retry` işçisi (fix-sweep-3): başarısız telafiyi (void / iade) DB'den
 * kurulan bağlamla idempotent olarak yeniden çalıştırır. Hata → BullMQ üstel geri çekilme.
 */
export async function runCompensationRetry(
  data: CompensationRetryData
): Promise<"compensated" | "noop"> {
  let outcome: "compensated" | "noop";
  if (data.saga === "cart_payment") outcome = await compensateCartPayment(data);
  else if (data.saga === "split_payment") outcome = await compensateSplitPlan(data.planId);
  else outcome = await retryPaymentCompensation(data);
  sagaCompensationRetryTotal.inc({
    saga: data.saga,
    outcome: outcome === "noop" ? "noop" : "succeeded",
  });
  return outcome;
}

export async function processCompensationRetryJob(
  job: Job<CompensationRetryData>
): Promise<"compensated" | "noop"> {
  if (job.name !== SAGA_COMPENSATION_RETRY_JOB) {
    throw new Error(`Bilinmeyen telafi işi: ${job.name}`);
  }
  try {
    return await runCompensationRetry(job.data);
  } catch (error) {
    sagaCompensationRetryTotal.inc({ saga: job.data.saga, outcome: "failed" });
    throw error;
  }
}

/**
 * Son deneme de düştüyse: metrik `{outcome="exhausted"}` (→ `SagaCompensationRetryExhausted`
 * alarmı) + audit (`saga.compensation_exhausted`) — iş BullMQ başarısız listesinde kalır
 * (removeOnFail: 1000), yönetici elle void/iade eder.
 */
export async function onCompensationRetryFailed(
  job: Job<CompensationRetryData> | undefined,
  error: Error
): Promise<void> {
  const exhausted = !!job && job.attemptsMade >= (job.opts.attempts ?? 1);
  if (job && exhausted) {
    sagaCompensationRetryTotal.inc({ saga: job.data.saga, outcome: "exhausted" });
    const subject =
      job.data.saga === "split_payment"
        ? job.data.planId
        : job.data.saga === "cart_payment"
          ? job.data.cartId
          : job.data.bookingId;
    await audit("system:saga", "saga.compensation_exhausted", "Saga", subject, {
      ...job.data,
      jobId: job.id ?? null,
      error: error.message.slice(0, 500),
    }).catch((e) => logger.warn(errorFields(e), "audit failed"));
  }
  logger.error(
    { jobId: job?.id, ...job?.data, exhausted, ...errorFields(error) },
    exhausted
      ? "saga compensation retry exhausted; manual review required"
      : "saga compensation retry failed"
  );
}
