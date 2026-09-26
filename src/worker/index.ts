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
import {
  ESCROW_RELEASE_JOB,
  runEscrowReleaseJob,
  scheduleEscrowRelease,
} from "./jobs/escrow-release";
import { ICAL_POLL_JOB, runIcalPoll, scheduleIcalPoll } from "./jobs/ical-poll";
import { WALLET_SWEEP_JOB, runWalletSweepJob, scheduleWalletSweep } from "./jobs/wallet";
import { onRefundRetryFailed, processRefundRetry } from "./jobs/refund-retry";
import { onConfirmRetryFailed, processConfirmRetryJob } from "./jobs/confirm-retry";
import {
  onCompensationRetryFailed,
  processCompensationRetryJob,
} from "./jobs/saga-compensation-retry";
import { runSplitDeadlineJob, SPLIT_DEADLINE_JOB } from "@/lib/cart/split-payment";
import { TRANSFER_SWEEP_JOB, runTransferSweep, scheduleTransferSweep } from "./jobs/transfer-sweep";
import {
  LEDGER_RECONCILE_JOB,
  runLedgerReconcile,
  scheduleLedgerReconcile,
} from "./jobs/ledger-reconcile";
import { processComplianceJob, scheduleTakedownSlaSweep } from "./jobs/compliance";
import { processResolutionJob, scheduleResolutionSweeps } from "./jobs/resolution";
import {
  PUSH_CHECKIN_REMINDER_JOB,
  runPushReminders,
  schedulePushReminders,
} from "./jobs/push-reminders";
import {
  processPriceCalendarJob,
  schedulePriceCalendarRefresh,
} from "@/lib/pricing/price-calendar-jobs";
import { runOutboxRelay } from "@/lib/cqrs";
import { registerEventHandlers } from "@/lib/events/register";
import { updateAvailabilityPrices } from "@/lib/pricing-service";
import { logger, errorFields } from "@/lib/observability/logger";
import { logLlmStartup } from "@/lib/llm/startup";
import { registerTracing } from "@/lib/observability/tracing";
import { createServer } from "http";
import { registry } from "@/lib/observability/metrics";
import { primeBusinessMetrics } from "@/lib/observability/business-metrics";
import { metricsAuthorized } from "@/lib/observability/metrics-auth";
import { DATA_RETENTION_JOB, runDataRetention, scheduleDataRetention } from "./jobs/data-retention";

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
  const { roomId, dates, basePriceMinor, currency } = job.data;
  if (!roomId || !Array.isArray(dates) || dates.length === 0) {
    throw new Error("Geçersiz pricing iş yükü: roomId ve dates zorunlu");
  }
  await updateAvailabilityPrices(roomId, dates, basePriceMinor, currency);
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
      if (job.name === SPLIT_DEADLINE_JOB) return runSplitDeadlineJob(job.data);
      if (job.name === ROLLOVER_JOB) return runRollover();
      if (job.name === COMPLETE_STAYS_JOB) return runCompleteStays();
      if (job.name === FX_REFRESH_JOB) return runFxRefresh();
      if (job.name === PRICE_ALERT_JOB) return runPriceAlertsJob();
      if (job.name === PAYOUT_JOB) return runPayouts();
      if (job.name === ESCROW_RELEASE_JOB) return runEscrowReleaseJob();
      if (job.name === WALLET_SWEEP_JOB) return runWalletSweepJob();
      if (job.name === ICAL_POLL_JOB) return runIcalPoll();
      if (job.name === TRANSFER_SWEEP_JOB) return runTransferSweep();
      if (job.name === LEDGER_RECONCILE_JOB) return runLedgerReconcile();
      if (job.name === PUSH_CHECKIN_REMINDER_JOB) return runPushReminders();
      if (job.name === DATA_RETENTION_JOB) return runDataRetention();
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

  // fix-sweep-3: capture sonrası çakışan onay (iade yerine yeniden deneme) ve başarısız saga
  // telafisinin (void/iade) yeniden denemesi.
  const confirmRetry = new Worker(QUEUE_NAMES.confirmRetry, processConfirmRetryJob, {
    connection,
  });
  confirmRetry.on("failed", onConfirmRetryFailed);
  workers.push(confirmRetry);
  const compensationRetry = new Worker(
    QUEUE_NAMES.sagaCompensationRetry,
    processCompensationRetryJob,
    { connection }
  );
  compensationRetry.on("failed", (job, err) => void onCompensationRetryFailed(job, err));
  workers.push(compensationRetry);

  // P1-13a: 7565 kaldırma SLA kontrolü (gecikmeli iş + yedek süpürücü).
  const compliance = new Worker(QUEUE_NAMES.compliance, processComplianceJob, { connection });
  compliance.on("failed", (job, err) =>
    logger.error(
      { jobId: job?.id, queue: QUEUE_NAMES.compliance, ...errorFields(err) },
      "job failed"
    )
  );
  workers.push(compliance);

  // P1-5: çözüm merkezi — talep SLA'sı + depozito void (gecikmeli) ve yedek süpürücüler.
  const resolution = new Worker(QUEUE_NAMES.resolution, processResolutionJob, { connection });
  resolution.on("failed", (job, err) =>
    logger.error(
      { jobId: job?.id, queue: QUEUE_NAMES.resolution, ...errorFields(err) },
      "job failed"
    )
  );
  workers.push(resolution);

  // P1-3: fiyat takvimi (MinPriceByDate) — artımlı olay işleri + tekrarlayan tam hesaplama.
  const priceCalendar = new Worker(
    QUEUE_NAMES.priceCalendar,
    async (job: Job) => processPriceCalendarJob(job),
    { connection }
  );
  priceCalendar.on("failed", (job, err) =>
    logger.error(
      { jobId: job?.id, queue: QUEUE_NAMES.priceCalendar, ...errorFields(err) },
      "job failed"
    )
  );
  workers.push(priceCalendar);
  await scheduleExpireHolds(getQueue(QUEUE_NAMES.maintenance));
  await scheduleFxRefresh(getQueue(QUEUE_NAMES.maintenance));
  await schedulePriceAlerts(getQueue(QUEUE_NAMES.maintenance));
  await schedulePayouts(getQueue(QUEUE_NAMES.maintenance));
  await scheduleEscrowRelease(getQueue(QUEUE_NAMES.maintenance));
  await scheduleWalletSweep(getQueue(QUEUE_NAMES.maintenance));
  await scheduleIcalPoll(getQueue(QUEUE_NAMES.maintenance));
  await scheduleTransferSweep(getQueue(QUEUE_NAMES.maintenance));
  await scheduleLedgerReconcile(getQueue(QUEUE_NAMES.maintenance));
  await scheduleTakedownSlaSweep(getQueue(QUEUE_NAMES.compliance));
  await schedulePushReminders(getQueue(QUEUE_NAMES.maintenance));
  await scheduleDataRetention(getQueue(QUEUE_NAMES.maintenance));
  await schedulePriceCalendarRefresh(getQueue(QUEUE_NAMES.priceCalendar));
  await scheduleResolutionSweeps(getQueue(QUEUE_NAMES.resolution));

  // Prometheus için işçi metrikleri (outbox, expire, bildirim sayaçları).
  const metricsPort = Number(process.env.WORKER_METRICS_PORT ?? 9464);
  primeBusinessMetrics();
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
