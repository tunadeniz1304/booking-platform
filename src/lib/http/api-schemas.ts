import { z } from "zod";

/**
 * Çekirdek misafir akışı uçlarının sınır şemaları (v2 P1-2). Route handler'lar ve
 * OpenAPI belgesi (`src/lib/http/openapi.ts`) AYNI şemayı kullanır; belge elle
 * güncellenmez, şema değişince sözleşme de değişir.
 */

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const currencyCode = z
  .string()
  .regex(/^[A-Za-z]{3}$/)
  .transform((c) => c.toUpperCase());

/** POST /api/bookings gövdesi. */
export const createBookingSchema = z.object({
  propertyId: z.string().min(1).max(64),
  roomId: z.string().min(1).max(64),
  checkIn: isoDay,
  checkOut: isoDay,
  guestCount: z.number().int().positive().max(20),
  /** Checkout'ta gösterilen teklif; fiyat değiştiyse 409 PRICE_CHANGED. */
  quoteId: z.string().uuid().optional(),
  /** Fiyat planı (yoksa varsayılan) ve oda adedi (v3 P0-2). */
  ratePlanId: z.string().min(1).max(64).optional(),
  units: z.number().int().min(1).max(10).optional(),
  /** Tahsilat para birimi (P0-5); yoksa teklifinki ya da tesisinki. */
  currency: currencyCode.optional(),
  /** P1-8: kupon kodu; kullanım limiti rezervasyonla aynı işlemde atomik sayılır. */
  couponCode: z.string().trim().min(1).max(40).optional(),
});

/** GET /api/bookings sorgusu (cursor pagination, v4#14). */
export const listBookingsQuerySchema = z.object({
  cursor: z.string().min(1).max(256).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

/** GET /api/quote sorgusu. */
export const quoteQuerySchema = z.object({
  roomId: z.string().min(1).max(64),
  propertyId: z.string().min(1).max(64).optional(),
  checkIn: isoDay,
  checkOut: isoDay,
  guests: z.coerce.number().int().min(1).max(20).default(1),
  ratePlanId: z.string().min(1).max(64).optional(),
  units: z.coerce.number().int().min(1).max(10).optional(),
  /** Tahsilat para birimi (P0-5); izinli değilse 400. */
  currency: currencyCode.optional(),
  /** P1-8: kupon kodu (büyük/küçük harf duyarsız). */
  couponCode: z.string().trim().min(1).max(40).optional(),
});

/** POST /api/bookings/{id}/pay gövdesi. */
export const payBookingSchema = z.object({
  /** PSP hosted-field token'ı (kart numarası sunucuya gelmez). */
  cardToken: z.string().min(8).max(200),
  /** Passkey step-up token'ı (v4#2): bu rezervasyon + tutara bağlı, tek kullanımlık. */
  stepUpToken: z.string().min(16).max(64).optional(),
  /** P1-7: cüzdan kredisinden kullanılacak tutar (minor-unit); kalan kartla ödenir. */
  creditMinor: z.number().int().min(0).max(1_000_000_000_000).optional(),
  // v4#13: `cardBin` / `deviceId` artık istemciden ALINMAZ (gönderilirse yok sayılır):
  // BIN PSP token metadata'sından, cihaz kimliği sunucu imzalı `did` çerezinden gelir.
});
