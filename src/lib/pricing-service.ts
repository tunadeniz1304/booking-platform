import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { priceNights, type PriceExplanation } from "@/lib/pricing/event-signals";
import { money, toDecimalString, minorToDb } from "@/lib/money/money";
import { logger, errorFields } from "@/lib/observability/logger";
import { noteAvailabilityChanged } from "@/lib/pricing/price-calendar-jobs";

const PRICE_CACHE_PREFIX = "price:";
const PRICE_CACHE_TTL = 60 * 30; // 30 dakika

export interface PricingResult {
  roomId: string;
  date: string;
  /** Gecelik fiyat, ana birim (DB `Decimal` ile aynı değer). */
  price: number;
  currency: string;
  /** Tek motorun açıklaması (tutarlar minor birim, v3#9). */
  explanation: PriceExplanation;
}

async function cachePrice(result: PricingResult): Promise<void> {
  try {
    await redis.set(
      `${PRICE_CACHE_PREFIX}${result.roomId}:${result.date}`,
      JSON.stringify(result),
      {
        ex: PRICE_CACHE_TTL,
      }
    );
  } catch (error) {
    logger.error(errorFields(error), "Fiyat önbelleği yazılamadı");
  }
}

/**
 * Worker fiyat işi: geceleri tek motorla (`priceNights`, ADR 0016) fiyatlar, önbelleğe ve
 * `InventoryDay` satırlarına açıklamasıyla yazar.
 */
export async function updateAvailabilityPrices(
  roomId: string,
  dates: string[],
  basePriceMinor: number,
  currency: string
): Promise<PricingResult[]> {
  const room = await prisma.roomType.findUnique({
    where: { id: roomId },
    select: { units: true, propertyId: true, property: { select: { locationId: true } } },
  });
  const explained = await priceNights({
    locationId: room?.property.locationId ?? null,
    nights: dates,
    baseMinor: basePriceMinor,
    currency,
  });

  const results: PricingResult[] = dates.map((date) => {
    const explanation = explained.get(date)!;
    return {
      roomId,
      date,
      price: Number(toDecimalString(money(explanation.price, currency))),
      currency,
      explanation,
    };
  });
  // Ev sahibinin sabitlediği geceler (P1-5 öneri kabulü) motor tarafından ezilmez.
  const overridden = new Set(
    (
      await prisma.inventoryDay.findMany({
        where: {
          roomTypeId: roomId,
          priceOverride: true,
          date: { in: dates.map((d) => new Date(d)) },
        },
        select: { date: true },
      })
    ).map((row) => row.date.toISOString().slice(0, 10))
  );
  const writable = results.filter((r) => !overridden.has(r.date));
  for (const result of writable) await cachePrice(result);

  await prisma.$transaction(
    async (tx) => {
      for (const result of writable) {
        const price = minorToDb(result.explanation.price);
        const priceExplanation = result.explanation as unknown as Prisma.InputJsonValue;
        await tx.inventoryDay.upsert({
          where: { roomTypeId_date: { roomTypeId: roomId, date: new Date(result.date) } },
          update: { priceMinor: price, priceExplanation },
          create: {
            roomTypeId: roomId,
            date: new Date(result.date),
            priceMinor: price,
            priceExplanation,
            total: room?.units ?? 1,
          },
        });
      }
      // P1-3: fiyat takvimi artımlı yenilemesi.
      if (room && writable.length > 0) {
        const written = writable.map((r) => r.date).sort();
        await noteAvailabilityChanged(tx, {
          propertyId: room.propertyId,
          roomId,
          from: written[0],
          to: written[written.length - 1],
          reason: "dynamic_pricing",
        });
      }
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 5000,
      timeout: 10000,
    }
  );

  return results;
}

export async function invalidatePriceCache(roomId: string, date: string): Promise<void> {
  try {
    await redis.del(`${PRICE_CACHE_PREFIX}${roomId}:${date}`);
  } catch (error) {
    logger.error(errorFields(error), "Fiyat önbelleği silinemedi");
  }
}
