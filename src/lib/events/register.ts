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
  type SecurityAlertPayload,
  type PriceDroppedPayload,
} from "./events";
import { notifyAuthEmail, notifyPriceDrop } from "@/lib/notifications/auth-notifications";
import { upsertPropertyEmbedding } from "@/lib/embedding/backfill";
import { invalidatePropertySearchCache } from "@/lib/search";
import { invalidatePriceCache } from "@/lib/pricing-service";
import {
  notifyBookingCancelled,
  notifyBookingExpired,
} from "@/lib/notifications/booking-notifications";
import { startBookingFulfilment } from "@/lib/saga/booking-saga";
import { invalidateBookingCache } from "@/lib/booking/booking-cache";
import { notifySecurityAlert } from "@/lib/notifications/security-notifications";

/**
 * Outbox'tan yayınlanan domain olaylarının tüketicileri (worker sürecinde).
 * Hepsi IDEMPOTENT: at-least-once teslimde aynı olay tekrar gelebilir
 * (önbellek silme doğal olarak idempotent; e-postalar dedupeKey ile tekil).
 */
let registered = false;

/** Rezervasyon durumunu/sahipliğini değiştiren olaylar (v4#14 önbellek silme). */
export const BOOKING_STATE_EVENTS = [
  EventTypes.BookingCreated,
  EventTypes.BookingConfirmed,
  EventTypes.BookingCancelled,
  EventTypes.BookingExpired,
  EventTypes.BookingTransferred,
] as const;

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
  // Saga devamı (P0-7): fatura → bildirim, BullMQ FlowProducer ile.
  on<BookingConfirmedPayload>(EventTypes.BookingConfirmed, startBookingFulfilment);
  on<BookingCancelledPayload>(EventTypes.BookingCancelled, async (p) => {
    await invalidateStay(p);
    await notifyBookingCancelled(p);
  });
  on<PropertyCreatedPayload>(EventTypes.PropertyCreated, (p) =>
    upsertPropertyEmbedding(p.propertyId)
  );
  on<AuthEmailRequestedPayload>(EventTypes.AuthEmailRequested, notifyAuthEmail);
  on<PriceDroppedPayload>(EventTypes.PriceDropped, notifyPriceDrop);
  on<SecurityAlertPayload>(EventTypes.SecurityAlert, notifySecurityAlert);
  on<BookingExpiredPayload>(EventTypes.BookingExpired, async (p) => {
    await invalidateStay(p);
    await notifyBookingExpired(p);
  });
  // v4#14: her rezervasyon durum/sahiplik değişiminde detay önbelleği silinir → getBooking
  // bayat durumu TTL boyunca göstermez (yazan tarafın silmesi düşse bile).
  for (const type of BOOKING_STATE_EVENTS) {
    on<{ bookingId: string }>(type, (p) => invalidateBookingCache(p.bookingId));
  }
}
