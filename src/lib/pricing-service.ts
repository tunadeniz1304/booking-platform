import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";

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
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getSeasonalFactor(date: Date): number {
  const month = date.getMonth();

  // Haziran-Eylül arası yüksek sezon
  if (month >= 5 && month <= 8) {
    return 1.3;
  }

  // Aralık-Ocak yılbaşı dönemi
  if (month === 11 || month === 0) {
    return 1.15;
  }

  return 1.0;
}

function getLastMinuteFactor(date: Date): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const target = new Date(date);
  target.setHours(0, 0, 0, 0);

  const daysUntil = Math.round(
    (target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (daysUntil <= 3) {
    return 1.2;
  }

  if (daysUntil <= 7) {
    return 1.1;
  }

  return 1.0;
}

function calculatePrice(input: PricingInput): PricingResult {
  const date = new Date(input.date);
  const occupancyRate = clamp(input.occupancyRate ?? 0.5, 0, 1);
  const seasonalFactor = input.seasonalFactor ?? getSeasonalFactor(date);
  const lastMinuteFactor = input.lastMinuteFactor ?? getLastMinuteFactor(date);

  const occupancyMultiplier = 1 + (occupancyRate - 0.5) * 0.4;
  const price =
    input.basePrice * seasonalFactor * lastMinuteFactor * occupancyMultiplier;

  return {
    roomId: input.roomId,
    date: input.date,
    price: Math.round(price * 100) / 100,
    currency: input.currency || "TRY",
    factors: {
      occupancyRate,
      seasonalFactor,
      lastMinuteFactor,
    },
  };
}

export async function calculateAndCachePrice(input: PricingInput): Promise<PricingResult> {
  const result = calculatePrice(input);
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
  const results: PricingResult[] = [];

  for (const date of dates) {
    const result = await calculateAndCachePrice({
      propertyId: "",
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