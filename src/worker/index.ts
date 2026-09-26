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
import { processFulfilmentJob } from "@/lib/saga/booking-saga";
import { QUEUE_NAMES, getQueue, getQueueConnection, type PricingJobData } from "@/lib/queue";
import {
  EXPIRE_HOLDS_JOB,
  ROLLOVER_JOB,
  COMPLETE_STAYS_JOB,
  runCompleteStays,
  runExpireHolds,
  runRollover,
  scheduleExpireHolds,
} from "./jobs/expire-holds";
import { FX_REFRESH_JOB, runFxRefresh, scheduleFxRefresh } from "./jobs/fx-refresh";
import { PRICE_ALERT_JOB, runPriceAlertsJob, schedulePriceAlerts } from "./jobs/price-alerts";
import { PAYOUT_JOB, runPayouts, schedulePayouts } from "./jobs/payouts";
import { ICAL_POLL_JOB, runIcalPoll, scheduleIcalPoll } from "./jobs/ical-poll";
import { onRefundRetryFailed, processRefundRetry } from "./jobs/refund-retry";
import { TRANSFER_SWEEP_JOB, runTransferSweep, scheduleTransferSweep } from "./jobs/transfer-sweep";
import { runOutboxRelay } from "@/lib/cqrs";
import { registerEventHandlers } from "@/lib/events/register";
import { updateAvailabilityPrices } from "@/lib/pricing-service";
import { logger, errorFields } from "@/lib/observability/logger";
import { logLlmStartup } from "@/lib/llm/startup";
import { registerTracing } from "@/lib/observability/tracing";
import { createServer } from "http";
import { registry } from "@/lib/observability/metrics";
import { metricsAuthorized } from "@/lib/observability/metrics-auth";

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
  await registerTracing("booking-worker");
  logLlmStartup("worker");
  registerEventHandlers();

  const connection = getQueueConnection();
  const pricing = new Worker<PricingJobData>(QUEUE_NAMES.pricing, processPricing, { connection });
  pricing.on("failed", (job, err) =>
    logger.error({ jobId: job?.id, queue: QUEUE_NAMES.pricing, ...errorFields(err) }, "job failed")
  );
  workers.push(pricing);

  const maintenance = new Worker(
    QUEUE_NAMES.maintenance,
    async (job: Job) => {
      if (job.name === EXPIRE_HOLDS_JOB) return runExpireHolds();
      if (job.name === ROLLOVER_JOB) return runRollover();
      if (job.name === COMPLETE_STAYS_JOB) return runCompleteStays();
      if (job.name === FX_REFRESH_JOB) return runFxRefresh();
      if (job.name === PRICE_ALERT_JOB) return runPriceAlertsJob();
      if (job.name === PAYOUT_JOB) return runPayouts();
      if (job.name === ICAL_POLL_JOB) return runIcalPoll();
      if (job.name === TRANSFER_SWEEP_JOB) return runTransferSweep();
      throw new Error(`Bilinmeyen bakım işi: ${job.name}`);
    },
    { connection }
  );
  maintenance.on("failed", (job, err) =>
    logger.error(
      { jobId: job?.id, queue: QUEUE_NAMES.maintenance, ...errorFields(err) },
      "job failed"
    )
  );
  workers.push(maintenance);

  // P0-7 saga devamı: fatura (çocuk) → bildirim (ebeveyn) akış işleri.
  const saga = new Worker(
    QUEUE_NAMES.saga,
    async (job: Job) => processFulfilmentJob(job.name, job.data),
    { connection }
  );
  saga.on("failed", (job, err) =>
    logger.error({ jobId: job?.id, queue: QUEUE_NAMES.saga, ...errorFields(err) }, "job failed")
  );
  workers.push(saga);

  // v4#7: başarısız PSP iadelerinin üstel geri çekilmeli yeniden denemesi.
  const refundRetry = new Worker(QUEUE_NAMES.refundRetry, processRefundRetry, { connection });
  refundRetry.on("failed", onRefundRetryFailed);
  workers.push(refundRetry);
  await scheduleExpireHolds(getQueue(QUEUE_NAMES.maintenance));
  await scheduleFxRefresh(getQueue(QUEUE_NAMES.maintenance));
  await schedulePriceAlerts(getQueue(QUEUE_NAMES.maintenance));
  await schedulePayouts(getQueue(QUEUE_NAMES.maintenance));
  await scheduleIcalPoll(getQueue(QUEUE_NAMES.maintenance));
  await scheduleTransferSweep(getQueue(QUEUE_NAMES.maintenance));

  // Prometheus için işçi metrikleri (outbox, expire, bildirim sayaçları).
  const metricsPort = Number(process.env.WORKER_METRICS_PORT ?? 9464);
  createServer(async (req, res) => {
    const auth = metricsAuthorized(req.headers.authorization ?? null);
    if (req.url !== "/metrics" || auth !== "ok") {
      res.writeHead(auth === "disabled" ? 503 : req.url === "/metrics" ? 401 : 404).end();
      return;
    }
    res.writeHead(200, { "content-type": registry.contentType }).end(await registry.metrics());
  }).listen(metricsPort);

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
