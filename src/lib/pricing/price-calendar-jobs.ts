import type { Job, Queue } from "bullmq";
import { getConfig } from "@/lib/config/app-config";
import { appendOutbox, type OutboxWriter } from "@/lib/cqrs";
import {
  EventTypes,
  makeEvent,
  type PropertyAvailabilityChangedPayload,
} from "@/lib/events/events";
import { QUEUE_NAMES, getQueue } from "@/lib/queue";
import { addDays, isIsoDate, type IsoDate } from "@/lib/time/nights";
import { counter } from "@/lib/observability/metrics";
import { errorFields, logger } from "@/lib/observability/logger";
import { refreshAllCalendars, refreshPropertyCalendar } from "./price-calendar";

/**
 * P1-3 fiyat takvimi işleri (BullMQ `price-calendar` kuyruğu):
 *  - `price-calendar-refresh`: artımlı — outbox olaylarından (envanter/fiyat/kısıt değişimi,
 *    rezervasyon oluştu/iptal/süresi doldu) tek tesisin gece aralığı. Aynı (tesis, aralık)
 *    için BullMQ deduplication: bekleyen iş varsa yenisi eklenmez; iş çalışırken gelen
 *    olay bitişte bir kez daha koşturulur (`keepLastIfActive`) → güncelleme kaybolmaz.
 *  - `price-calendar-full`: tekrarlayan tam yeniden hesaplama (`PRICE_CALENDAR_REFRESH_CRON`);
 *    olay üretmeyen yollar (rollover, talep simülasyonu, ilan durumu) buradan yakalanır.
 */

export const PRICE_CALENDAR_REFRESH_JOB = "price-calendar-refresh";
export const PRICE_CALENDAR_FULL_JOB = "price-calendar-full";

export interface PriceCalendarJobData {
  propertyId: string;
  from?: IsoDate;
  to?: IsoDate;
}

const jobsTotal = counter("price_calendar_jobs_total", "Fiyat takvimi işleri", [
  "kind",
  "outcome",
] as const);

/** Deduplication kimliği (BullMQ özel kimliklerinde ':' kullanılamaz). */
export function calendarJobKey(data: PriceCalendarJobData): string {
  return `mpbd-${data.propertyId}-${data.from ?? "start"}-${data.to ?? "end"}`;
}

export async function enqueueCalendarRefresh(
  data: PriceCalendarJobData,
  queue: Queue = getQueue(QUEUE_NAMES.priceCalendar)
): Promise<string | undefined> {
  const job = await queue.add(PRICE_CALENDAR_REFRESH_JOB, data, {
    delay: getConfig().PRICE_CALENDAR_DEBOUNCE_MS,
    deduplication: { id: calendarJobKey(data), keepLastIfActive: true },
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: true,
    removeOnFail: 1000,
  });
  return job.id;
}

/** İdempotent tekrarlayan tam yeniden hesaplama zamanlayıcısı. */
export async function schedulePriceCalendarRefresh(queue: Queue): Promise<void> {
  await queue.upsertJobScheduler(
    PRICE_CALENDAR_FULL_JOB,
    { pattern: getConfig().PRICE_CALENDAR_REFRESH_CRON, tz: "UTC" },
    { name: PRICE_CALENDAR_FULL_JOB, data: {}, opts: { removeOnComplete: true, removeOnFail: 100 } }
  );
}

/** Worker işleyicisi. */
export async function processPriceCalendarJob(
  job: Pick<Job, "name" | "data">,
  now: Date = new Date()
): Promise<unknown> {
  if (job.name === PRICE_CALENDAR_FULL_JOB) {
    try {
      const result = await refreshAllCalendars(now);
      jobsTotal.inc({ kind: "full", outcome: result.failed > 0 ? "partial" : "ok" });
      logger.info(result, "price calendar full refresh");
      return result;
    } catch (error) {
      jobsTotal.inc({ kind: "full", outcome: "error" });
      throw error;
    }
  }
  if (job.name === PRICE_CALENDAR_REFRESH_JOB) {
    const data = job.data as PriceCalendarJobData;
    if (!data?.propertyId) throw new Error("Geçersiz fiyat takvimi iş yükü: propertyId zorunlu");
    try {
      const result = await refreshPropertyCalendar(
        data.propertyId,
        {
          from: data.from && isIsoDate(data.from) ? data.from : undefined,
          to: data.to && isIsoDate(data.to) ? data.to : undefined,
        },
        now
      );
      jobsTotal.inc({ kind: "incremental", outcome: "ok" });
      return result;
    } catch (error) {
      jobsTotal.inc({ kind: "incremental", outcome: "error" });
      throw error;
    }
  }
  throw new Error(`Bilinmeyen fiyat takvimi işi: ${job.name}`);
}

/**
 * Envanter/fiyat/kısıt yazan işlemin İÇİNDE çağrılır: outbox'a
 * `property.availability_changed` ekler (commit olursa yayınlanır).
 */
export async function noteAvailabilityChanged(
  tx: OutboxWriter,
  payload: PropertyAvailabilityChangedPayload
): Promise<void> {
  await appendOutbox(
    tx,
    makeEvent(EventTypes.PropertyAvailabilityChanged, payload.propertyId, "Property", payload)
  );
}

/** Outbox tüketicisi: availability_changed → artımlı iş. */
export async function onAvailabilityChanged(p: PropertyAvailabilityChangedPayload): Promise<void> {
  await enqueueCalendarRefresh({
    propertyId: p.propertyId,
    from: isIsoDate(p.from) ? p.from : undefined,
    to: p.to && isIsoDate(p.to) ? p.to : undefined,
  });
}

/** Outbox tüketicisi: rezervasyon oluştu/iptal/süresi doldu → konaklama geceleri. */
export async function onBookingInventoryChanged(p: {
  propertyId: string;
  checkIn: string;
  checkOut: string;
}): Promise<void> {
  if (!isIsoDate(p.checkIn) || !isIsoDate(p.checkOut)) return;
  try {
    await enqueueCalendarRefresh({
      propertyId: p.propertyId,
      from: p.checkIn,
      to: addDays(p.checkOut, -1),
    });
  } catch (error) {
    // Kuyruk erişilemezse rezervasyon olayının diğer tüketicileri etkilenmesin; tam
    // yeniden hesaplama farkı kapatır.
    logger.warn({ propertyId: p.propertyId, ...errorFields(error) }, "calendar enqueue failed");
  }
}
