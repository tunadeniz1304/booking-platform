import QRCode from "qrcode";
import { prisma } from "@/lib/prisma";
import { fromDate, toDbDate, todayUtc } from "@/lib/time/nights";
import { signBookingCode } from "./booking-code";

/**
 * Çevrimdışı seyahat planı (P1-12): kullanıcının yaklaşan onaylı rezervasyonları + imzalı
 * rezervasyon kodu ve QR'ı. Tutar dönmez (kart girişte gösterilir, ödeme bilgisi gerekmez);
 * service worker bu yanıtı network-first önbelleğe alır.
 */
export interface ItineraryItem {
  id: string;
  code: string;
  /** `data:image/svg+xml;base64,…` — CSP `img-src data:` ile uyumlu. */
  qrDataUrl: string;
  propertyTitle: string;
  city: string;
  country: string;
  roomName: string;
  checkIn: string;
  checkOut: string;
  checkInTime: string;
  checkOutTime: string;
  guestCount: number;
}

export const ITINERARY_MAX_ITEMS = 20;

/** İmzalı kod rezervasyon kimliği + sırra göre deterministiktir → QR SVG'si önbelleklenir. */
const QR_CACHE_MAX = 500;
const qrCache = new Map<string, string>();

export async function qrDataUrl(text: string): Promise<string> {
  const cached = qrCache.get(text);
  if (cached) return cached;
  const svg = await QRCode.toString(text, { type: "svg", errorCorrectionLevel: "M", margin: 1 });
  const url = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  // Doluysa en eski girdi atılır (Map ekleme sırasını korur).
  if (qrCache.size >= QR_CACHE_MAX) {
    const oldest = qrCache.keys().next().value;
    if (oldest !== undefined) qrCache.delete(oldest);
  }
  qrCache.set(text, url);
  return url;
}

export async function listUpcomingItinerary(
  userId: string,
  now: Date = new Date()
): Promise<ItineraryItem[]> {
  const rows = await prisma.booking.findMany({
    where: { userId, status: "CONFIRMED", checkOut: { gte: toDbDate(todayUtc(now)) } },
    orderBy: [{ checkIn: "asc" }, { id: "asc" }],
    take: ITINERARY_MAX_ITEMS,
    select: {
      id: true,
      checkIn: true,
      checkOut: true,
      guestCount: true,
      room: { select: { name: true } },
      property: {
        select: {
          title: true,
          checkInTime: true,
          checkOutTime: true,
          location: { select: { city: true, country: true } },
        },
      },
    },
  });
  return Promise.all(
    rows.map(async (b) => {
      const code = signBookingCode(b.id);
      return {
        id: b.id,
        code,
        qrDataUrl: await qrDataUrl(code),
        propertyTitle: b.property.title,
        city: b.property.location.city,
        country: b.property.location.country,
        roomName: b.room.name,
        checkIn: fromDate(b.checkIn),
        checkOut: fromDate(b.checkOut),
        checkInTime: b.property.checkInTime,
        checkOutTime: b.property.checkOutTime,
        guestCount: b.guestCount,
      };
    })
  );
}
