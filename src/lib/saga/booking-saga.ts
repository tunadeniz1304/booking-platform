import { FlowProducer, type FlowJob } from "bullmq";
import type { BookingConfirmedPayload } from "@/lib/events/events";
import { ConflictError } from "@/lib/http/errors";
import { issueInvoice } from "@/lib/invoice/invoice";
import { notifyBookingConfirmed } from "@/lib/notifications/booking-notifications";
import { errorFields, logger } from "@/lib/observability/logger";
import { QUEUE_NAMES, getQueueConnection } from "@/lib/queue";
import { SagaFaultError, isSagaFaultInjected } from "./saga";

/**
 * Rezervasyon sagası (P0-7, ADR 0013):
 *
 *   hold → authorize → capture → confirm   (senkron, `payment-service` içinde; telafili)
 *                                  │ outbox: BookingConfirmed (aynı işlemde)
 *                                  ▼
 *               BullMQ FlowProducer: invoice (çocuk) → notify (ebeveyn)
 *
 * Onay pivot adımıdır: sonrasında para geri verilmez; fatura ve bildirim idempotent işler
 * olarak yeniden denenir (ileri-kurtarma). Job id'leri deterministik → aynı olay iki kez
 * gelse de akış bir kez kuyruğa girer.
 */
export const PAYMENT_SAGA = "booking_payment";
export const FULFILMENT_SAGA = "booking_fulfilment";
export const SAGA_STEPS = {
  hold: "hold",
  authorize: "authorize",
  capture: "capture",
  confirm: "confirm",
  invoice: "invoice",
  notify: "notify",
} as const;

/** Redis erişilemezse kuyruğa ekleme bu süre sonunda bırakılır ve akış süreç-içi çalışır. */
const FLOW_ENQUEUE_TIMEOUT_MS = 2_000;
const FLOW_JOB_ATTEMPTS = 5;
const FLOW_BACKOFF_MS = 5_000;
const FLOW_KEEP_FAILED = 1_000;

export interface FlowAdder {
  add(flow: FlowJob): Promise<unknown>;
}

export function fulfilmentFlow(p: BookingConfirmedPayload): FlowJob {
  const opts = (step: string) => ({
    jobId: `${step}:${p.bookingId}`,
    attempts: FLOW_JOB_ATTEMPTS,
    backoff: { type: "exponential", delay: FLOW_BACKOFF_MS },
    removeOnComplete: true,
    removeOnFail: FLOW_KEEP_FAILED,
  });
  return {
    name: SAGA_STEPS.notify,
    queueName: QUEUE_NAMES.saga,
    data: p,
    opts: opts(SAGA_STEPS.notify),
    children: [
      {
        name: SAGA_STEPS.invoice,
        queueName: QUEUE_NAMES.saga,
        data: p,
        opts: opts(SAGA_STEPS.invoice),
      },
    ],
  };
}

/** Worker işleyicisi (ve süreç-içi yedek) — her adım idempotent. */
export async function processFulfilmentJob(
  name: string,
  p: BookingConfirmedPayload
): Promise<unknown> {
  if (isSagaFaultInjected(FULFILMENT_SAGA, name)) throw new SagaFaultError(FULFILMENT_SAGA, name);
  if (name === SAGA_STEPS.invoice) {
    try {
      return (await issueInvoice(p.bookingId, p.userId)).number;
    } catch (error) {
      // Onaydan sonra iptal edildiyse fatura kesilmez; akış bildirime devam eder.
      if (error instanceof ConflictError) {
        logger.info({ bookingId: p.bookingId }, "invoice skipped: booking not invoiceable");
        return null;
      }
      throw error;
    }
  }
  if (name === SAGA_STEPS.notify) return notifyBookingConfirmed(p);
  throw new Error(`Bilinmeyen saga işi: ${name}`);
}

/** Akışı süreç-içi yürütür: önce çocuklar, sonra ebeveyn (FlowProducer semantiği). */
export const inlineFlow: FlowAdder = {
  async add(flow) {
    for (const child of flow.children ?? []) await inlineFlow.add(child);
    return processFulfilmentJob(flow.name, flow.data as BookingConfirmedPayload);
  },
};

const globalForFlow = globalThis as unknown as { __bookingFlowProducer?: FlowProducer };
let flowOverride: FlowAdder | null = null;

export function setFulfilmentFlowForTests(flow: FlowAdder | null): void {
  flowOverride = flow;
}

function getFlowProducer(): FlowAdder {
  globalForFlow.__bookingFlowProducer ??= new FlowProducer({ connection: getQueueConnection() });
  return globalForFlow.__bookingFlowProducer;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("flow enqueue timeout")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** `BookingConfirmed` tüketicisi: fatura → bildirim akışını başlatır. */
export async function startBookingFulfilment(p: BookingConfirmedPayload): Promise<void> {
  const flow = fulfilmentFlow(p);
  if (flowOverride) {
    await flowOverride.add(flow);
    return;
  }
  try {
    await withTimeout(getFlowProducer().add(flow), FLOW_ENQUEUE_TIMEOUT_MS);
  } catch (error) {
    // Çevrimdışı yedek: kuyruk yoksa aynı adımlar süreç-içi çalışır (idempotent).
    logger.warn({ bookingId: p.bookingId, ...errorFields(error) }, "flow enqueue failed; inline");
    await inlineFlow.add(flow);
  }
}
