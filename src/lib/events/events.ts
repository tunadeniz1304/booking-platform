import { DomainEvent } from "@/lib/cqrs/types";

/**
 * Domain olay tanımları — olay adları ve payload şemaları tek yerde.
 * Olaylar değişmezdir; yayınlanan her olay bu sözleşmeye uyar.
 */

export const EventTypes = {
  BookingCreated: "booking.created",
  BookingCancelled: "booking.cancelled",
  PropertyAvailabilityChanged: "property.availability_changed",
  DemandSignalChanged: "demand.signal_changed",
} as const;

export type EventType = (typeof EventTypes)[keyof typeof EventTypes];

export interface BookingCreatedPayload {
  bookingId: string;
  propertyId: string;
  roomId: string;
  checkIn: string;
  checkOut: string;
  guestCount: number;
  totalPrice: number;
  currency: string;
  userId: string;
}

export interface BookingCancelledPayload {
  bookingId: string;
  propertyId: string;
  roomId: string;
  checkIn: string;
  checkOut: string;
}

export interface PropertyAvailabilityChangedPayload {
  propertyId: string;
  roomId: string;
  date: string;
}

export interface DemandSignalChangedPayload {
  propertyId: string;
  date: string;
  signal: number;
}

export function makeEvent<T>(
  type: EventType,
  aggregateId: string,
  aggregateType: string,
  payload: T,
  correlationId?: string
): DomainEvent<T> {
  return {
    type,
    aggregateId,
    aggregateType,
    payload,
    correlationId,
    occurredAt: Date.now(),
  };
}
