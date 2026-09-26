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
  guestCount: number;
}

export const ITINERARY_MAX_ITEMS = 20;

export async function qrDataUrl(text: string): Promise<string> {
  const svg = await QRCode.toString(text, { type: "svg", errorCorrectionLevel: "M", margin: 1 });
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
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
        guestCount: b.guestCount,
      };
    })
  );
}
