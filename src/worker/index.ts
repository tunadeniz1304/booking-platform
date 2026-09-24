/**
 * Arka plan işçisi (bağımsız süreç): `npm run worker`
 *
 * - BullMQ işleyicileri YALNIZCA burada başlar (Next sunucusu iş işlemez).
 * - Transactional Outbox periyodik olarak boşaltılır (at-least-once yayın).
 *
 * Docker Compose'ta ayrı bir servis olarak ölçeklenebilir.
 */
import { Worker, type Job } from "bullmq";
import { loadEnv } from "@/lib/config/load-env";
import { QUEUE_NAMES, getQueueConnection, type PricingJobData } from "@/lib/queue";
import { runOutboxRelay } from "@/lib/cqrs";
import { registerEventHandlers } from "@/lib/events/register";
import { updateAvailabilityPrices } from "@/lib/pricing-service";
import { logger, errorFields } from "@/lib/observability/logger";
import { logLlmStartup } from "@/lib/llm/startup";

loadEnv();

const OUTBOX_RELAY_INTERVAL_MS = 5_000;
const OUTBOX_RELAY_BATCH = 100;

let relayTimer: NodeJS.Timeout | undefined;
let shuttingDown = false;
const workers: Worker[] = [];

async function drainOutbox(): Promise<void> {
  if (shuttingDown) return;
  try {
    const published = await runOutboxRelay(OUTBOX_RELAY_BATCH);
    if (published > 0) logger.info({ published }, "outbox relayed");
  } catch (error) {
    logger.error(errorFields(error), "outbox relay failed");
  }
}

async function processPricing(job: Job<PricingJobData>): Promise<void> {
  const { roomId, dates, basePrice, currency } = job.data;
  if (!roomId || !Array.isArray(dates) || dates.length === 0) {
    throw new Error("Geçersiz pricing iş yükü: roomId ve dates zorunlu");
  }
  await updateAvailabilityPrices(roomId, dates, basePrice, currency);
}

async function main(): Promise<void> {
  logLlmStartup("worker");
  registerEventHandlers();

  const connection = getQueueConnection();
  const pricing = new Worker<PricingJobData>(QUEUE_NAMES.pricing, processPricing, { connection });
  pricing.on("failed", (job, err) =>
    logger.error({ jobId: job?.id, queue: QUEUE_NAMES.pricing, ...errorFields(err) }, "job failed")
  );
  workers.push(pricing);

  await drainOutbox();
  relayTimer = setInterval(drainOutbox, OUTBOX_RELAY_INTERVAL_MS);
  logger.info({ outboxIntervalMs: OUTBOX_RELAY_INTERVAL_MS }, "worker ready");
}

async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(relayTimer);
  await Promise.allSettled(workers.map((w) => w.close()));
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

main().catch((error) => {
  logger.fatal(errorFields(error), "worker failed to start");
  process.exit(1);
});
