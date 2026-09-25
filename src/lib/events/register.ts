import { eventBus } from "@/lib/cqrs";
import type { DomainEvent } from "@/lib/cqrs/types";
import {
  EventTypes,
  type BookingCancelledPayload,
  type BookingConfirmedPayload,
  type BookingCreatedPayload,
  type BookingExpiredPayload,
  type PropertyCreatedPayload,
  type AuthEmailRequestedPayload,
} from "./events";
import { notifyAuthEmail } from "@/lib/notifications/auth-notifications";
import { upsertPropertyEmbedding } from "@/lib/embedding/backfill";
import { invalidatePropertySearchCache } from "@/lib/search";
import { invalidatePriceCache } from "@/lib/pricing-service";
import {
  notifyBookingCancelled,
  notifyBookingConfirmed,
  notifyBookingExpired,
} from "@/lib/notifications/booking-notifications";

/**
 * Outbox'tan yayınlanan domain olaylarının tüketicileri (worker sürecinde).
 * Hepsi IDEMPOTENT: at-least-once teslimde aynı olay tekrar gelebilir
 * (önbellek silme doğal olarak idempotent; e-postalar dedupeKey ile tekil).
 */
let registered = false;

type WithRoom = { propertyId: string; roomId: string; checkIn: string; checkOut: string };

async function invalidateStay(p: WithRoom): Promise<void> {
  await invalidatePropertySearchCache(p.propertyId).catch(() => {});
  const start = new Date(`${p.checkIn}T00:00:00.000Z`);
  const end = new Date(`${p.checkOut}T00:00:00.000Z`);
  for (let d = new Date(start); d < end; d.setUTCDate(d.getUTCDate() + 1)) {
    await invalidatePriceCache(p.roomId, d.toISOString().slice(0, 10)).catch(() => {});
  }
}

function on<T>(type: string, handler: (payload: T) => Promise<unknown>): void {
  eventBus.on({
    listens: type,
    handle: async (event: DomainEvent) => {
      await handler(event.payload as T);
    },
  });
}

export function registerEventHandlers(): void {
  if (registered) return;
  registered = true;

  on<BookingCreatedPayload>(EventTypes.BookingCreated, invalidateStay);
  on<BookingConfirmedPayload>(EventTypes.BookingConfirmed, notifyBookingConfirmed);
  on<BookingCancelledPayload>(EventTypes.BookingCancelled, async (p) => {
    await invalidateStay(p);
    await notifyBookingCancelled(p);
  });
  on<PropertyCreatedPayload>(EventTypes.PropertyCreated, (p) =>
    upsertPropertyEmbedding(p.propertyId)
  );
  on<AuthEmailRequestedPayload>(EventTypes.AuthEmailRequested, notifyAuthEmail);
  on<BookingExpiredPayload>(EventTypes.BookingExpired, async (p) => {
    await invalidateStay(p);
    await notifyBookingExpired(p);
  });
}
