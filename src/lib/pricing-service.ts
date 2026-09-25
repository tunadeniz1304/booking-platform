import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { calculateDynamicPrice } from "@/lib/pricing/engine";
import { logger, errorFields } from "@/lib/observability/logger";

const PRICE_CACHE_PREFIX = "price:";
const PRICE_CACHE_TTL = 60 * 30; // 30 dakika

export interface PricingInput {
  propertyId: string;
  roomId: string;
  date: string;
  basePrice: number;
  occupancyRate?: number;
  seasonalFactor?: number;
  lastMinuteFactor?: number;
  currency?: string;
}

export interface PricingResult {
  roomId: string;
  date: string;
  price: number;
  currency: string;
  factors: {
    occupancyRate: number;
    seasonalFactor: number;
    lastMinuteFactor: number;
    /** Etkinlik yakınlığı çarpanı (predictive motor). */
    eventFactor?: number;
    leadTimeFactor?: number;
    weekdayFactor?: number;
    occupancyMultiplier?: number;
    /** Birleşik talep sinyali 0..1 (SSE ısı haritası besler). */
    demandSignal?: number;
  };
}

/**
 * Fiyat hesabı → predictif motor (src/lib/pricing/engine.ts).
 * Mevsimsellik, lead-time, hafta içi gün, occupancy ve lokasyon etkinlik
 * korelasyonu tek akışta birleşir.
 */
async function calculatePrice(input: PricingInput): Promise<PricingResult> {
  const result = await calculateDynamicPrice({
    propertyId: input.propertyId,
    roomId: input.roomId,
    date: input.date,
    basePrice: input.basePrice,
    occupancyRate: input.occupancyRate,
    seasonalFactor: input.seasonalFactor,
    lastMinuteFactor: input.lastMinuteFactor,
    currency: input.currency,
  });
  return result;
}

export async function calculateAndCachePrice(input: PricingInput): Promise<PricingResult> {
  const result = await calculatePrice(input);
  const cacheKey = `${PRICE_CACHE_PREFIX}${input.roomId}:${input.date}`;

  try {
    await redis.set(cacheKey, JSON.stringify(result), { ex: PRICE_CACHE_TTL });
  } catch (error) {
    logger.error(errorFields(error), "Price cache write failed");
  }

  return result;
}

export async function updateAvailabilityPrices(
  roomId: string,
  dates: string[],
  basePrice: number,
  currency: string
): Promise<PricingResult[]> {
  const room = await prisma.roomType.findUnique({
    where: { id: roomId },
    select: { propertyId: true, units: true },
  });
  const propertyId = room?.propertyId ?? "";

  const results: PricingResult[] = [];

  for (const date of dates) {
    const result = await calculateAndCachePrice({
      propertyId,
      roomId,
      date,
      basePrice,
      currency,
    });
    results.push(result);
  }

  await prisma.$transaction(
    async (tx) => {
      for (const result of results) {
        await tx.inventoryDay.upsert({
          where: {
            roomTypeId_date: {
              roomTypeId: roomId,
              date: new Date(result.date),
            },
          },
          update: {
            price: new Prisma.Decimal(result.price),
          },
          create: {
            roomTypeId: roomId,
            date: new Date(result.date),
            price: new Prisma.Decimal(result.price),
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
    logger.error(errorFields(error), "Price cache invalidation failed");
  }
}
