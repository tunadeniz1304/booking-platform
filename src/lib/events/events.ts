import { DomainEvent } from "@/lib/cqrs/types";

/**
 * Domain olay tanımları — olay adları ve payload şemaları tek yerde.
 * Olaylar değişmezdir; yayınlanan her olay bu sözleşmeye uyar. Tutarlar minor-unit.
 */

export const EventTypes = {
  /** Rezervasyon oluşturuldu (HELD: ödeme bekliyor, envanter tutuluyor). */
  BookingCreated: "booking.created",
  BookingConfirmed: "booking.confirmed",
  BookingCancelled: "booking.cancelled",
  BookingExpired: "booking.expired",
  BookingTransferred: "booking.transferred",
  PropertyCreated: "property.created",
  PropertyAvailabilityChanged: "property.availability_changed",
  DemandSignalChanged: "demand.signal_changed",
  /** E-posta doğrulama / şifre sıfırlama bağlantısı gönderilmeli (P0-8). */
  AuthEmailRequested: "auth.email_requested",
} as const;

export type EventType = (typeof EventTypes)[keyof typeof EventTypes];

interface BookingRef {
  bookingId: string;
  propertyId: string;
  roomId: string;
  checkIn: string;
  checkOut: string;
  userId: string;
}

export interface BookingCreatedPayload extends BookingRef {
  status: "HELD";
  guestCount: number;
  /** Toplam (minor-unit). */
  totalMinor: number;
  currency: string;
  holdExpiresAt: string;
}

export interface BookingConfirmedPayload extends BookingRef {
  totalMinor: number;
  currency: string;
  paymentId: string;
}

export interface BookingCancelledPayload extends BookingRef {
  /** İade tutarı (minor-unit); ödeme yoksa 0. */
  refundMinor?: number;
  currency?: string;
  reason?: string;
}

export interface BookingExpiredPayload extends BookingRef {
  reason: "hold_timeout";
}

export interface BookingTransferredPayload extends BookingRef {
  fromUserId: string;
  toUserId: string;
  transferId: string;
}

export interface AuthEmailRequestedPayload {
  tokenId: string;
  userId: string;
  to: string;
  name: string;
  kind: "EMAIL_VERIFY" | "PASSWORD_RESET";
  /** Tek kullanımlık ham token (yalnızca e-posta bağlantısı için; DB'de özeti tutulur). */
  token: string;
}

export interface PropertyCreatedPayload {
  propertyId: string;
  hostId: string;
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
