import { getConfig } from "@/lib/config/app-config";
import { getQueue, QUEUE_NAMES } from "@/lib/queue";
import { counter } from "@/lib/observability/metrics";
import { errorFields, logger } from "@/lib/observability/logger";

/**
 * fix-sweep-3: başarısız saga telafisinin (void / iade PSP hatası, serileştirme tükenmesi)
 * yeniden denemesi. P2-3 kaos koşusunda telafi bir kez düşünce sepet CANCELLED kalırken PSP'de
 * yetkilendirme açık kalıyordu (tasarım yalnız log + metrikti).
 *
 * İş yükü yalnız kimlik taşır; telafi durumu DB'den yeniden kurulur ve aynı idempotent telafi
 * adımları tekrar çalışır (iade anahtarı `compensate:<ref>` → PSP en fazla bir kez iade eder).
 * Deneme hakkı bitince iş BullMQ'nun başarısız listesinde kalır + audit + metrik
 * `{outcome="exhausted"}` → `SagaCompensationRetryExhausted` alarmı (elle müdahale).
 */

export const SAGA_COMPENSATION_RETRY_JOB = "saga-compensation-retry";

export type CompensationRetryData =
  | { saga: "cart_payment"; cartId: string; providerRef: string; captured: boolean }
  | { saga: "split_payment"; planId: string }
  | {
      saga: "payment";
      bookingId: string;
      userId: string;
      providerRef: string;
      claimed: boolean;
      captured: boolean;
    };

export const sagaCompensationRetryTotal = counter(
  "saga_compensation_retry_total",
  "Başarısız saga telafilerinin yeniden denemeleri (saga, sonuç)",
  ["saga", "outcome"] as const
);

function jobKey(data: CompensationRetryData): string {
  if (data.saga === "cart_payment") return `cart-${data.cartId}-${data.providerRef}`;
  if (data.saga === "split_payment") return `split-${data.planId}`;
  return `payment-${data.bookingId}-${data.providerRef}`;
}

/**
 * Telafi yeniden deneme işini kuyruğa koyar (özne başına tek iş; üstel geri çekilme).
 * Kuyruk erişilemezse hata yutulur: `saga_compensation_total{outcome="failed"}` alarmı ve
 * log elle müdahaleyi zaten tetikler.
 */
export async function scheduleCompensationRetry(
  data: CompensationRetryData,
  failedSteps: string[]
): Promise<void> {
  const { SAGA_COMPENSATION_RETRY_MAX_ATTEMPTS, SAGA_COMPENSATION_RETRY_BASE_DELAY_MS } =
    getConfig();
  try {
    await getQueue(QUEUE_NAMES.sagaCompensationRetry).add(SAGA_COMPENSATION_RETRY_JOB, data, {
      jobId: `comp-${jobKey(data)}`,
      delay: SAGA_COMPENSATION_RETRY_BASE_DELAY_MS,
      attempts: SAGA_COMPENSATION_RETRY_MAX_ATTEMPTS,
      backoff: { type: "exponential", delay: SAGA_COMPENSATION_RETRY_BASE_DELAY_MS },
      removeOnComplete: true,
      removeOnFail: 1000,
    });
    sagaCompensationRetryTotal.inc({ saga: data.saga, outcome: "scheduled" });
    logger.warn({ ...data, failedSteps }, "saga compensation retry scheduled");
  } catch (error) {
    logger.error({ ...data, ...errorFields(error) }, "saga compensation retry not scheduled");
  }
}
