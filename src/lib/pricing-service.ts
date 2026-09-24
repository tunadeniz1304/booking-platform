import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { calculateDynamicPrice } from "@/lib/pricing/engine";

const PRICE_CACHE_PREFIX = "price:";
const PRICE_CACHE_TTL = 60 * 30; // 30 dakika
const PRICE_QUEUE_KEY = "pricing:queue";
const PRICE_QUEUE_LOCK_KEY = "pricing:queue:lock";
const PRICE_QUEUE_LOCK_TTL = 10; // saniye

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
    console.error("Price cache write failed:", error);
  }

  return result;
}

export async function getCachedPrice(roomId: string, date: string): Promise<PricingResult | null> {
  const cacheKey = `${PRICE_CACHE_PREFIX}${roomId}:${date}`;

  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as PricingResult;
    }
  } catch (error) {
    console.error("Price cache read failed:", error);
  }

  return null;
}

export async function updateAvailabilityPrices(
  roomId: string,
  dates: string[],
  basePrice: number,
  currency: string
): Promise<PricingResult[]> {
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { propertyId: true },
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
        await tx.availability.upsert({
          where: {
            roomId_date: {
              roomId,
              date: new Date(result.date),
            },
          },
          update: {
            price: new Prisma.Decimal(result.price),
          },
          create: {
            roomId,
            date: new Date(result.date),
            price: new Prisma.Decimal(result.price),
            isAvailable: true,
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

export async function enqueuePricingUpdate(input: PricingInput): Promise<void> {
  try {
    const lockAcquired = await redis.set(PRICE_QUEUE_LOCK_KEY, "1", {
      nx: true,
      ex: PRICE_QUEUE_LOCK_TTL,
    });

    if (!lockAcquired) {
      return;
    }

    const queueLength = await redis.llen(PRICE_QUEUE_KEY);
    if (queueLength >= 1000) {
      await redis.del(PRICE_QUEUE_LOCK_KEY);
      return;
    }

    await redis.rpush(PRICE_QUEUE_KEY, JSON.stringify(input));
    await redis.del(PRICE_QUEUE_LOCK_KEY);
  } catch (error) {
    console.error("Failed to enqueue pricing update:", error);
  }
}

export async function processPricingQueue(batchSize = 50): Promise<number> {
  let processed = 0;

  try {
    const lockAcquired = await redis.set(PRICE_QUEUE_LOCK_KEY, "1", {
      nx: true,
      ex: PRICE_QUEUE_LOCK_TTL,
    });

    if (!lockAcquired) {
      return 0;
    }

    for (let i = 0; i < batchSize; i++) {
      const raw = await redis.lpop(PRICE_QUEUE_KEY);
      if (!raw) break;

      try {
        const input = JSON.parse(raw) as PricingInput;
        await calculateAndCachePrice(input);
        processed++;
      } catch (error) {
        console.error("Pricing queue item failed:", error);
      }
    }

    await redis.del(PRICE_QUEUE_LOCK_KEY);
  } catch (error) {
    console.error("Failed to process pricing queue:", error);
  }

  return processed;
}

export async function invalidatePriceCache(roomId: string, date: string): Promise<void> {
  try {
    await redis.del(`${PRICE_CACHE_PREFIX}${roomId}:${date}`);
  } catch (error) {
    console.error("Price cache invalidation failed:", error);
  }
}

export async function invalidateRoomPriceCache(roomId: string): Promise<void> {
  try {
    const keys = await redis.keys(`${PRICE_CACHE_PREFIX}${roomId}:*`);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } catch (error) {
    console.error("Room price cache invalidation failed:", error);
  }
}
