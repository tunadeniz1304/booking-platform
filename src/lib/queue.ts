import { Queue, type JobsOptions } from "bullmq";
import { Redis } from "ioredis";

/**
 * BullMQ kuyruk TANIMLARI (yalnızca producer).
 *
 * Bu modül import edildiğinde hiçbir Worker başlamaz ve Redis bağlantısı
 * açılmaz; kuyruklar ilk kullanımda tembel oluşturulur. İşleyiciler (Worker)
 * YALNIZCA `src/worker/index.ts` sürecinde çalışır — Next sunucusu iş işlemez.
 */

export const QUEUE_NAMES = {
  pricing: "pricing",
  maintenance: "maintenance",
  saga: "saga",
  /** Başarısız PSP iadelerinin üstel geri çekilmeli yeniden denemesi (v4#7). */
  refundRetry: "refund-retry",
  /** Uyum otomasyonu (P1-13): 7565 kaldırma SLA kontrolü (gecikmeli iş). */
  compliance: "compliance",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export interface PricingJobData {
  roomId: string;
  dates: string[];
  /** Taban gecelik fiyat, minor-unit (tesis para biriminde; ADR 0019). */
  basePriceMinor: number;
  currency: string;
}

const globalForQueues = globalThis as unknown as {
  __bookingQueueConnection?: Redis;
  __bookingQueues?: Map<QueueName, Queue>;
};

/** BullMQ bağlantısı (`maxRetriesPerRequest: null` BullMQ gereksinimidir). */
export function getQueueConnection(): Redis {
  globalForQueues.__bookingQueueConnection ??= new Redis(
    process.env.REDIS_URL || "redis://localhost:6379",
    { maxRetriesPerRequest: null, lazyConnect: true }
  );
  return globalForQueues.__bookingQueueConnection;
}

export function getQueue(name: QueueName): Queue {
  globalForQueues.__bookingQueues ??= new Map();
  let queue = globalForQueues.__bookingQueues.get(name);
  if (!queue) {
    queue = new Queue(name, { connection: getQueueConnection() });
    globalForQueues.__bookingQueues.set(name, queue);
  }
  return queue;
}

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 5000 },
  removeOnComplete: true,
  removeOnFail: 1000,
};

export async function addPricingUpdateJob(data: PricingJobData): Promise<string | undefined> {
  const job = await getQueue(QUEUE_NAMES.pricing).add("update-pricing", data, DEFAULT_JOB_OPTIONS);
  return job.id;
}
