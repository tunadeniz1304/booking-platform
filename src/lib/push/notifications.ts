import { prisma } from "@/lib/prisma";
import { getConfig } from "@/lib/config/app-config";
import type { PriceDroppedPayload } from "@/lib/events/events";
import { errorFields, logger } from "@/lib/observability/logger";
import { addDays, fromDate, toDbDate, todayUtc } from "@/lib/time/nights";
import { getPushSettings } from "./config";
import { sendPushToUser, type PushLocale, type PushMessage } from "./send";

/**
 * Push bildirim türleri (P1-12): fiyat düşüşü (mevcut fiyat alarmı olayına bağlı) ve
 * check-in hatırlatması. Metinler TR/EN; tutar yazılmaz (fiyat hesabı alarm modülünde).
 */

const TEXT = {
  priceDropTitle: { tr: "Fiyat düştü", en: "Price drop" },
  checkinTitle: {
    tr: (days: number) =>
      days === 0 ? "Bugün check-in" : days === 1 ? "Yarın check-in" : `${days} gün sonra check-in`,
    en: (days: number) =>
      days === 0 ? "Check-in today" : days === 1 ? "Check-in tomorrow" : `Check-in in ${days} days`,
  },
  checkinBody: {
    tr: (title: string, date: string) =>
      `${title} · ${date}. Rezervasyon kartınız çevrimdışı da açılır.`,
    en: (title: string, date: string) => `${title} · ${date}. Your booking card works offline too.`,
  },
} as const;

export function priceDropMessage(p: PriceDroppedPayload, locale: PushLocale): PushMessage {
  return {
    title: TEXT.priceDropTitle[locale],
    body: `${p.propertyTitle} · ${p.roomName} · ${p.checkIn} → ${p.checkOut}`,
    url: `/property/${encodeURIComponent(p.propertyId)}`,
    tag: `price-drop:${p.alertId}`,
  };
}

export function checkinReminderMessage(
  booking: { id: string; propertyTitle: string; checkIn: string },
  daysAhead: number,
  locale: PushLocale
): PushMessage {
  return {
    title: TEXT.checkinTitle[locale](daysAhead),
    body: TEXT.checkinBody[locale](booking.propertyTitle, booking.checkIn),
    url: "/trips",
    tag: `checkin:${booking.id}`,
  };
}

/** `price.dropped` tüketicisi: e-postaya ek olarak push. Asla fırlatmaz (e-postayı etkilemez). */
export async function pushPriceDrop(p: PriceDroppedPayload): Promise<void> {
  try {
    await sendPushToUser(p.userId, "price_drop", (locale) => priceDropMessage(p, locale), {
      dedupeKey: `price:${p.alertId}:${p.observedOn}`,
    });
  } catch (error) {
    logger.error({ ...errorFields(error), alertId: p.alertId }, "price drop push failed");
  }
}

export interface CheckinReminderRun {
  candidates: number;
  sent: number;
  removed: number;
  failed: number;
  skipped: number;
  disabled: boolean;
}

/** Günlük iş gövdesi: `PUSH_CHECKIN_REMINDER_DAYS_AHEAD` gün sonra girişi olan onaylı rezervasyonlar. */
export async function runCheckinReminders(now: Date = new Date()): Promise<CheckinReminderRun> {
  const run: CheckinReminderRun = {
    candidates: 0,
    sent: 0,
    removed: 0,
    failed: 0,
    skipped: 0,
    disabled: false,
  };
  if (!getPushSettings().enabled) {
    run.disabled = true;
    return run;
  }
  const daysAhead = getConfig().PUSH_CHECKIN_REMINDER_DAYS_AHEAD;
  const target = toDbDate(addDays(todayUtc(now), daysAhead));
  const bookings = await prisma.booking.findMany({
    where: {
      status: "CONFIRMED",
      checkIn: target,
      user: { deletedAt: null, pushSubscriptions: { some: {} } },
    },
    select: { id: true, userId: true, checkIn: true, property: { select: { title: true } } },
    orderBy: { id: "asc" },
  });
  run.candidates = bookings.length;
  for (const b of bookings) {
    const checkIn = fromDate(b.checkIn);
    const result = await sendPushToUser(
      b.userId,
      "checkin_reminder",
      (locale) =>
        checkinReminderMessage(
          { id: b.id, propertyTitle: b.property.title, checkIn },
          daysAhead,
          locale
        ),
      { dedupeKey: `checkin:${b.id}:${checkIn}` }
    );
    run.sent += result.sent;
    run.removed += result.removed;
    run.failed += result.failed;
    if (result.skipped) run.skipped++;
  }
  logger.info({ ...run }, "check-in hatırlatmaları işlendi");
  return run;
}
