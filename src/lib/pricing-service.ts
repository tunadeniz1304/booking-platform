import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { priceNights, type PriceExplanation } from "@/lib/pricing/event-signals";
import { money, toDecimalString, toMinor } from "@/lib/money/money";
import { logger, errorFields } from "@/lib/observability/logger";

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
  basePrice: number,
  currency: string
): Promise<PricingResult[]> {
  const room = await prisma.roomType.findUnique({
    where: { id: roomId },
    select: { units: true, property: { select: { locationId: true } } },
  });
  const explained = await priceNights({
    locationId: room?.property.locationId ?? null,
    nights: dates,
    baseMinor: toMinor(basePrice, currency),
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
  for (const result of results) await cachePrice(result);

  await prisma.$transaction(
    async (tx) => {
      for (const result of results) {
        const price = new Prisma.Decimal(
          toDecimalString(money(result.explanation.price, currency))
        );
        const priceExplanation = result.explanation as unknown as Prisma.InputJsonValue;
        await tx.inventoryDay.upsert({
          where: { roomTypeId_date: { roomTypeId: roomId, date: new Date(result.date) } },
          update: { price, priceExplanation },
          create: {
            roomTypeId: roomId,
            date: new Date(result.date),
            price,
            priceExplanation,
            total: room?.units ?? 1,
          },
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
