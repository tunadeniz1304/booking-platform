import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { updateAvailabilityPrices } from "@/lib/pricing-service";
import { EventTypes, makeEvent, DemandSignalChangedPayload } from "@/lib/events/events";
import { eventBus } from "@/lib/cqrs";

/**
 * Global Sentiment & Event Trigger — dış sinyal (X/haber/duyuru) alındığında
 * o bölgedeki konaklama fiyatlarını anında optimize eder ve stok hedge eder.
 *
 * HFT-tarzı "reactive pricing" akışı:
 *   1. Lokasyon eşleştir (şehir/ülke)
 *   2. DemandEvent oluştur (talep motoru bunu fiyat çarpanına çevirir)
 *   3. Pencere günlerinde tüm odaları dinamik motor ile yeniden fiyatla
 *   4. Hedge: istenirse ilk N gece stok kaydını kilitler (lockedBy=hedge:<id>),
 *      geri-alma bilgisini Redis'te saklar (reversible)
 *   5. Olay yayını + denetim izi (Redis log)
 */

export interface ExternalSignalInput {
  title: string;
  city?: string;
  country?: string;
  startsOn: string;
  endsOn: string;
  impact: number;
  source: string;
  confidence?: number;
  hedgeLastN?: number;
}

export interface IngestResult {
  eventId: string;
  locationId: string;
  locationLabel: string;
  affectedProperties: number;
  repricedRooms: number;
  hedgedNights: number;
  source: string;
}

function parseDate(value: string): Date {
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw new Error("Geçersiz tarih");
  return d;
}

function getDatesBetween(start: Date, end: Date): Date[] {
  const dates: Date[] = [];
  const cur = new Date(start);
  cur.setUTCHours(0, 0, 0, 0);
  while (cur < end) {
    dates.push(new Date(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

const HEDGE_UNDO_PREFIX = "hedge:undo:";
const SIGNAL_LOG_KEY = "sentiment:events";

/**
 * Hedge geri-alma: yalnız `hedge:<eventId>` kilidiyle tutulan gece kayıtlarını
 * serbest bırakır (özgün değerleri her zaman true olduğundan güvenli).
 * @returns restore edilen gece sayısı
 */
export async function releaseEventHedge(eventId: string): Promise<number> {
  const result = await prisma.availability.updateMany({
    where: { lockedBy: `hedge:${eventId}` },
    data: { isAvailable: true, lockedBy: null },
  });
  return result.count;
}

export async function ingestExternalSignal(input: ExternalSignalInput): Promise<IngestResult> {
  const city = input.city?.trim();
  const country = input.country?.trim();

  // Çözümle: aday lokasyonları sırala — hangisinde AKTİF mülk varsa o kazanır
  // (Unicode varyantı/trail-space kopya satırlara karşı dayanıklılık).
  const candidates =
    city || country
      ? await prisma.location.findMany({
          where: {
            OR: [
              ...(city ? [{ city: { equals: city, mode: "insensitive" as const } }] : []),
              ...(country ? [{ country: { equals: country, mode: "insensitive" as const } }] : []),
            ],
          },
          orderBy: { properties: { _count: "desc" } },
          include: { _count: { select: { properties: { where: { isActive: true } } } } },
        })
      : [];
  const location = candidates.find((c) => c._count.properties > 0) ?? candidates[0] ?? null;
  if (!location) {
    throw new Error(`Lokasyon bulunamadı: ${city ?? country ?? "(boş)"}`);
  }

  const startsAt = parseDate(input.startsOn);
  const endsAt = parseDate(input.endsOn);
  if (startsAt > endsAt) throw new Error("Geçersiz tarih aralığı");
  const impact = Math.min(10, Math.max(1, Math.round(input.impact)));

  // Eşzamanlı aynı duyuru → tek olay (token-bucket yerine upsert-force)
  const existing = await prisma.demandEvent.findFirst({
    where: {
      locationId: location.id,
      title: { equals: input.title, mode: "insensitive" },
      startsAt: { equals: startsAt },
    },
  });
  const event =
    existing ??
    (await prisma.demandEvent.create({
      data: { locationId: location.id, title: input.title, startsAt, endsAt, impact },
    }));

  // Pencere: etkinlik günleri ±1 gece
  const windowStart = new Date(startsAt);
  windowStart.setUTCDate(windowStart.getUTCDate() - 1);
  const windowEnd = new Date(endsAt);
  windowEnd.setUTCDate(windowEnd.getUTCDate() + 2);
  const windowDates = getDatesBetween(windowStart, windowEnd).map((d) =>
    d.toISOString().slice(0, 10)
  );
  if (windowDates.length === 0) throw new Error("Boş pencere");

  const properties = await prisma.property.findMany({
    where: { locationId: location.id, isActive: true },
    select: { id: true },
  });
  const rooms = await prisma.room.findMany({
    where: { property: { locationId: location.id, isActive: true }, available: true },
    select: { id: true, priceModifier: true, property: { select: { basePrice: true } } },
  });

  // 3) Pencere boyunca her odayı dinamik motorla yeniden fiyatla (sync, milisaniye)
  let repricedRooms = 0;
  for (const room of rooms) {
    const firstNight = await prisma.availability.findFirst({
      where: {
        roomId: room.id,
        date: { in: windowDates.map((d) => new Date(`${d}T00:00:00.000Z`)) },
      },
      orderBy: { date: "asc" },
      select: { price: true },
    });
    const base = firstNight ? Number(firstNight.price) : Number(room.property.basePrice);
    await updateAvailabilityPrices(room.id, windowDates, base, "TRY");
    repricedRooms += 1;
  }

  // 4) Hedge: ilk N müsait geceyi kilitler (reversible), varsayılan 1
  const hedgeN = input.hedgeLastN ?? 1;
  let hedgedNights = 0;
  if (hedgeN > 0) {
    for (const room of rooms) {
      const rows = await prisma.availability.findMany({
        where: {
          roomId: room.id,
          date: { in: windowDates.map((d) => new Date(`${d}T00:00:00.000Z`)) },
          isAvailable: true,
        },
        orderBy: { date: "asc" },
        take: hedgeN,
      });
      for (const row of rows) {
        const dateStr = row.date.toISOString().slice(0, 10);
        await redis
          .set(`${HEDGE_UNDO_PREFIX}${room.id}:${dateStr}`, row.isAvailable ? "1" : "0", {
            ex: 60 * 60 * 24 * 30,
          })
          .catch(() => {});
      }
      if (rows.length > 0) {
        await prisma.availability.updateMany({
          where: { id: { in: rows.map((r) => r.id) } },
          data: { isAvailable: false, lockedBy: `hedge:${event.id}` },
        });
        hedgedNights += rows.length;
      }
    }
  }

  // 5) Talep sinyali olayı + denetim izi
  const signal: DemandSignalChangedPayload = {
    propertyId: "",
    date: windowDates[0],
    signal: impact / 10,
  };
  await eventBus.publish(
    makeEvent(
      EventTypes.DemandSignalChanged,
      event.id,
      "demand_event",
      signal,
      `signal:${event.id}`
    )
  );
  await redis
    .lpush(
      SIGNAL_LOG_KEY,
      JSON.stringify({
        eventId: event.id,
        title: input.title,
        source: input.source,
        city: location.city,
        country: location.country,
        at: new Date().toISOString(),
        repricedRooms,
        hedgedNights,
      })
    )
    .catch(() => {});

  return {
    eventId: event.id,
    locationId: location.id,
    locationLabel: `${location.city}, ${location.country}`,
    affectedProperties: properties.length,
    repricedRooms,
    hedgedNights,
    source: input.source,
  };
}
