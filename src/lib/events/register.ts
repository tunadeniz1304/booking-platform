import { eventBus } from "@/lib/cqrs";
import { EventTypes, BookingCreatedPayload, BookingCancelledPayload } from "./events";
import { invalidatePropertySearchCache } from "@/lib/search";
import { invalidatePriceCache } from "@/lib/pricing-service";
import { redis } from "@/lib/redis";

interface DomainEventLike {
  type: string;
  aggregateId: string;
  aggregateType: string;
  payload: unknown;
  correlationId?: string;
}

/**
 * Domain olay tüketicilerini kaydeder. Idempotent: aynı süreçte iki kez
 * çağrılsa bile subscriber setleri aynı kalır.
 */
let registered = false;
const LIVE_STATS_PREFIX = "live:room:";

export function registerEventHandlers(): void {
  if (registered) return;
  registered = true;

  eventBus.on({
    listens: EventTypes.BookingCreated,
    handle: async (event: unknown) => {
      const payload = (event as unknown as DomainEventLike).payload as BookingCreatedPayload;
      if (!payload?.bookingId) return;

      // Aramayı tazele: yeni rezervasyon oda müsaitliğini değiştirdi
      await invalidatePropertySearchCache(payload.propertyId).catch(() => {});
      await invalidateRoomDatesCache(payload.roomId, payload.checkIn, payload.checkOut);

      // Canlı talep ısı haritası sayacı: oda boşaltılana dek +1
      try {
        const key = `${LIVE_STATS_PREFIX}${payload.roomId}:booked`;
        const current = Number((await redis.get(key)) ?? "0");
        await redis.set(key, String(current + 1), { ex: 60 * 60 * 24 });
      } catch {
        // sayaç arızası zararsız
      }

      console.info(
        `[events] booking.created ${payload.bookingId} -> property ${payload.propertyId}`,
        process.pid
      );
    },
  });

  eventBus.on({
    listens: EventTypes.BookingCancelled,
    handle: async (event: unknown) => {
      const payload = (event as unknown as DomainEventLike).payload as BookingCancelledPayload;
      if (!payload?.bookingId) return;

      await invalidatePropertySearchCache(payload.propertyId).catch(() => {});
      await invalidateRoomDatesCache(payload.roomId, payload.checkIn, payload.checkOut);

      try {
        const key = `${LIVE_STATS_PREFIX}${payload.roomId}:booked`;
        const current = Math.max(0, Number((await redis.get(key)) ?? "0") - 1);
        await redis.set(key, String(current), { ex: 60 * 60 * 24 });
      } catch {
        // sayaç arızası zararsız
      }

      console.info(
        `[events] booking.cancelled ${payload.bookingId} -> property ${payload.propertyId}`,
        process.pid
      );
    },
  });
}

async function invalidateRoomDatesCache(
  roomId: string,
  checkIn: string,
  checkOut: string
): Promise<void> {
  const start = new Date(`${checkIn}T00:00:00.000Z`);
  const end = new Date(`${checkOut}T00:00:00.000Z`);
  for (let d = new Date(start); d < end; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    await invalidatePriceCache(roomId, iso).catch(() => {});
  }
}
