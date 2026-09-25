import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getConfig } from "@/lib/config/app-config";
import { appendOutbox } from "@/lib/cqrs";
import { EventTypes, makeEvent, type PriceDroppedPayload } from "@/lib/events/events";
import { ConflictError, HttpError, NotFoundError } from "@/lib/http/errors";
import { logger } from "@/lib/observability/logger";
import { fromDate, toDbDate, todayUtc } from "@/lib/time/nights";
import { computeTotal } from "./quote";
import { omnibusReferencePrice, recordObservation, type PriceObservation } from "./insight";

/**
 * Fiyat alarmları (P1-4). Günlük iş her aktif alarm için konaklama toplamını (vergiler
 * dahil, tesis para birimi) gözlemler; toplam Omnibus referansının (son PRICE_OMNIBUS_DAYS
 * günün en düşüğü) altına inerse outbox'a `price.dropped` yazar → e-posta (dedupe'lu).
 * Aynı gün tekrar çalışmak güvenlidir: gözlem üzerine yazılır, e-posta anahtarı günlüktür.
 */

function parseObservations(value: Prisma.JsonValue): PriceObservation[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (o): o is { on: string; total: number } =>
      !!o &&
      typeof o === "object" &&
      typeof (o as { on?: unknown }).on === "string" &&
      Number.isInteger((o as { total?: unknown }).total)
  );
}

function toJson(observations: readonly PriceObservation[]): Prisma.InputJsonValue {
  return observations.map(({ on, total }) => ({ on, total }));
}

export interface PriceAlertView {
  id: string;
  roomId: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  currency: string;
  lastTotalMinor: number;
  /** Omnibus "önceki fiyat" (son N günün en düşüğü); yalnızca güncel fiyattan yüksekse. */
  previousPriceMinor: number | null;
  active: boolean;
}

function toView(
  row: Prisma.PriceAlertGetPayload<object>,
  today: string,
  days: number
): PriceAlertView {
  const reference = omnibusReferencePrice(parseObservations(row.observations), today, days);
  return {
    id: row.id,
    roomId: row.roomTypeId,
    checkIn: fromDate(row.checkIn),
    checkOut: fromDate(row.checkOut),
    guests: row.guests,
    currency: row.currency,
    lastTotalMinor: row.lastTotalMinor,
    previousPriceMinor: reference !== null && reference > row.lastTotalMinor ? reference : null,
    active: row.active,
  };
}

export async function createPriceAlert(input: {
  userId: string;
  roomId: string;
  checkIn: string;
  checkOut: string;
  guests: number;
}): Promise<PriceAlertView> {
  const cfg = getConfig();
  const quote = await computeTotal({
    roomId: input.roomId,
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    guests: input.guests,
  });
  const today = todayUtc();
  const where = {
    userId_roomTypeId_checkIn_checkOut_guests: {
      userId: input.userId,
      roomTypeId: quote.roomId,
      checkIn: toDbDate(quote.checkIn),
      checkOut: toDbDate(quote.checkOut),
      guests: input.guests,
    },
  };
  const existing = await prisma.priceAlert.findUnique({ where });
  if (!existing?.active) {
    const count = await prisma.priceAlert.count({ where: { userId: input.userId, active: true } });
    if (count >= cfg.PRICE_ALERT_MAX_PER_USER) {
      throw new ConflictError("Azami fiyat alarmı sayısına ulaşıldı", "PRICE_ALERT_LIMIT");
    }
  }
  const observations = recordObservation(
    parseObservations(existing?.observations ?? []),
    { on: today, total: quote.total },
    cfg.PRICE_OMNIBUS_DAYS
  );
  const row = await prisma.priceAlert.upsert({
    where,
    update: { active: true, lastTotalMinor: quote.total, observations: toJson(observations) },
    create: {
      userId: input.userId,
      roomTypeId: quote.roomId,
      checkIn: toDbDate(quote.checkIn),
      checkOut: toDbDate(quote.checkOut),
      guests: input.guests,
      currency: quote.currency,
      lastTotalMinor: quote.total,
      observations: toJson(observations),
    },
  });
  return toView(row, today, cfg.PRICE_OMNIBUS_DAYS);
}

export async function listPriceAlerts(userId: string): Promise<PriceAlertView[]> {
  const cfg = getConfig();
  const rows = await prisma.priceAlert.findMany({
    where: { userId, active: true },
    orderBy: { checkIn: "asc" },
  });
  const today = todayUtc();
  return rows.map((r) => toView(r, today, cfg.PRICE_OMNIBUS_DAYS));
}

export async function deletePriceAlert(userId: string, id: string): Promise<void> {
  const { count } = await prisma.priceAlert.updateMany({
    where: { id, userId, active: true },
    data: { active: false },
  });
  if (count === 0) throw new NotFoundError("Fiyat alarmı bulunamadı");
}

export interface PriceAlertRun {
  checked: number;
  dropped: number;
  skipped: number;
  expired: number;
}

/** Günlük iş gövdesi (idempotent). */
export async function runPriceAlerts(now: Date = new Date()): Promise<PriceAlertRun> {
  const cfg = getConfig();
  const today = todayUtc(now);
  const { count: expired } = await prisma.priceAlert.updateMany({
    where: { active: true, checkIn: { lte: toDbDate(today) } },
    data: { active: false },
  });
  const alerts = await prisma.priceAlert.findMany({
    where: { active: true },
    include: {
      user: { select: { email: true, firstName: true, deletedAt: true } },
      roomType: { select: { name: true, property: { select: { id: true, title: true } } } },
    },
  });
  const result: PriceAlertRun = { checked: 0, dropped: 0, skipped: 0, expired };
  for (const alert of alerts) {
    if (alert.user.deletedAt) {
      result.skipped++;
      continue;
    }
    const checkIn = fromDate(alert.checkIn);
    const checkOut = fromDate(alert.checkOut);
    let total: number;
    try {
      total = (
        await computeTotal(
          { roomId: alert.roomTypeId, checkIn, checkOut, guests: alert.guests },
          now
        )
      ).total;
    } catch (error) {
      // Dolu / kısıtlı / fiyatsız → bugün gözlem yok (alarm aktif kalır).
      if (error instanceof HttpError) {
        result.skipped++;
        continue;
      }
      throw error;
    }
    result.checked++;
    const previous = parseObservations(alert.observations);
    const reference = omnibusReferencePrice(previous, today, cfg.PRICE_OMNIBUS_DAYS);
    const observations = recordObservation(previous, { on: today, total }, cfg.PRICE_OMNIBUS_DAYS);
    const dropped = reference !== null && total < reference;
    const notifiedToday = alert.lastNotifiedAt && fromDate(alert.lastNotifiedAt) === today;
    await prisma.$transaction(async (tx) => {
      await tx.priceAlert.update({
        where: { id: alert.id },
        data: {
          lastTotalMinor: total,
          observations: toJson(observations),
          ...(dropped ? { lastNotifiedAt: now } : {}),
        },
      });
      if (dropped && !notifiedToday) {
        await appendOutbox(
          tx,
          makeEvent<PriceDroppedPayload>(EventTypes.PriceDropped, alert.id, "priceAlert", {
            alertId: alert.id,
            userId: alert.userId,
            to: alert.user.email,
            name: alert.user.firstName,
            propertyId: alert.roomType.property.id,
            propertyTitle: alert.roomType.property.title,
            roomName: alert.roomType.name,
            checkIn,
            checkOut,
            currency: alert.currency,
            previousMinor: reference,
            currentMinor: total,
            observedOn: today,
          })
        );
      }
    });
    if (dropped) result.dropped++;
  }
  logger.info({ ...result }, "fiyat alarmları işlendi");
  return result;
}
