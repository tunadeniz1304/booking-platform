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
  /** İzlenen konaklamanın fiyatı Omnibus referansının altına düştü (P1-4). */
  PriceDropped: "price.dropped",
  /** Kullanıcı/oturum bir deney koluna ilk kez maruz kaldı (P1-3). */
  ExperimentExposure: "experiment.exposure",
  /** Hesapta güvenlik açısından önemli değişiklik (yeni passkey vb.) → e-posta (v4#2). */
  SecurityAlert: "auth.security_alert",
  /** DSA bildirimi alındı → bildirene alındı onayı (P1-13b). */
  NoticeReceived: "compliance.notice_received",
  /** DSA bildirimine karar verildi → gerekçeli karar bildirimi (P1-13b). */
  NoticeDecided: "compliance.notice_decided",
  /** Parti riski skoru eşik üstünde → ev sahibine uyarı (P1-6). */
  PartyRiskFlagged: "trust.party_risk_flagged",
  /** Bölünmüş ödeme: pay daveti / organizatöre yedek ödeme çağrısı → e-posta (P1-2). */
  SplitShareInvited: "cart.split_share_invited",
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
  /**
   * hold_timeout: TTL doldu; payment_failed: ödeme sagası telafisi (P0-7);
   * cart_released: grup sepetinin tutması kullanıcı tarafından bırakıldı / sepet iptal (P1-1).
   */
  reason: "hold_timeout" | "payment_failed" | "cart_released";
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
  /** Token'ın SHA-256 özeti (ham token outbox'a yazılmaz, v4#12). */
  tokenHash: string;
  /** AES-256-GCM ile şifreli bağlantı yolu (`link-crypto.ts`); yalnızca e-posta tüketicisi çözer. */
  sealedLink: string;
}

export interface SecurityAlertPayload {
  /** Olay başına tekil kimlik (e-posta tekilliği). */
  alertId: string;
  userId: string;
  to: string;
  name: string;
  kind: "PASSKEY_ADDED" | "NEW_DEVICE_LOGIN";
  /** Passkey adı (PASSKEY_ADDED) veya cihaz/IP ipucu (NEW_DEVICE_LOGIN), varsa. */
  detail: string | null;
  occurredAt: string;
}

export interface SplitShareInvitedPayload {
  shareId: string;
  planId: string;
  /** INVITE: katılımcıya davet; FALLBACK: süre doldu, kalan organizatörde. */
  kind: "INVITE" | "FALLBACK";
  /** Gönderim başına tekil kimlik (yeniden gönderim ayrı e-posta). */
  sendId: string;
}

export interface PriceDroppedPayload {
  alertId: string;
  userId: string;
  to: string;
  name: string;
  propertyId: string;
  propertyTitle: string;
  roomName: string;
  checkIn: string;
  checkOut: string;
  currency: string;
  /** Omnibus referansı (son N günün en düşüğü), minor unit. */
  previousMinor: number;
  currentMinor: number;
  /** Gözlem günü (YYYY-MM-DD) — e-posta tekilliği için. */
  observedOn: string;
}

export interface PartyRiskFlaggedPayload {
  bookingId: string;
  hostId: string;
  propertyId: string;
}

export interface PropertyCreatedPayload {
  propertyId: string;
  hostId: string;
}

/**
 * Envanter/fiyat/kısıt değişti (P1-3: fiyat takvimi artımlı yenilemesi). Aralık [from, to]
 * gece olarak dahil; `to` yoksa ufkun sonuna kadar (oda farkı/adet değişimi gibi).
 */
export interface PropertyAvailabilityChangedPayload {
  propertyId: string;
  roomId?: string;
  from: string;
  to?: string;
  /** Kaynak: "host_ari", "room_update", "channel_ari", "ical", "dynamic_pricing", "revenue". */
  reason?: string;
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
