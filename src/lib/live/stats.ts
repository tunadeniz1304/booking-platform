import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { calculateDynamicPrice } from "@/lib/pricing/engine";

/**
 * Canlı talep ısı haritası istatistikleri.
 *
 * Gerçek "Son 1 oda" yerine çok-bileşenli canlı sinyal:
 *  - scarcity: oda için aralıkta dolu gece oranı (stok)
 *  - views: Redis'teki son dakika görüntülenme sayacı (ilgi)
 *  - booked: Redis'teki son 24 saatteki rezervasyon sayacı
 *  - demandSignal: predictif fiyat motorunun talep sinyali
 *
 * SSE akışı bu değerleri 3 sn'de bir yayınlar.
 */

const VIEWS_PREFIX = "live:room:";
const BOOKED_PREFIX = "live:room:";
const VIEW_WINDOW_TTL = 60 * 10; // 10 dk

export interface RoomHeat {
  roomId: string;
  propertyId: string;
  totalNights: number;
  bookedNights: number;
  availableNights: number;
  scarcity: number; // 0..1 (dolu oranı)
  views: number;
  bookedRecent: number;
  demandSignal: number;
  currentNightlyPrice: number;
  status: "available" | "limited" | "sold_out";
  updatedAt: number;
}

function parseDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/** Odanın bir görüntülenmesini kaydet (sayfa yüklendiğinde / SSE bağlanınca). */
export async function recordRoomView(roomId: string): Promise<void> {
  try {
    const key = `${VIEWS_PREFIX}${roomId}:views`;
    const current = Number((await redis.get(key)) ?? "0");
    await redis.set(key, String(current + 1), { ex: VIEW_WINDOW_TTL });
  } catch {
    // sayaç arızası zararsız
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Oda için güncel talep ısısını hesaplar. `startDate`/`endDate` (YYY-MM-DD)
 * isteğe bağlıdır; verilmezse önümüzdeki 7 gece için hesap edilir.
 */
export async function getRoomHeat(
  roomId: string,
  startDate?: string,
  endDate?: string
): Promise<RoomHeat | null> {
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: {
      propertyId: true,
      property: { select: { locationId: true, currency: true, basePrice: true } },
    },
  });
  if (!room) return null;

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const start = startDate ? parseDate(startDate) : today;
  const end = endDate
    ? parseDate(endDate)
    : new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
  if (end <= start) {
    throw new Error("Geçersiz tarih aralığı");
  }

  const availability = await prisma.availability.findMany({
    where: { roomId, date: { gte: start, lt: end } },
    select: { isAvailable: true, price: true, date: true },
  });

  const totalNights = availability.length;
  const bookedNights = availability.filter((a) => !a.isAvailable).length;
  const availableNights = totalNights - bookedNights;
  const scarcity = totalNights > 0 ? bookedNights / totalNights : 0;

  const [viewsRaw, bookedRaw] = await Promise.all([
    redis.get(`${VIEWS_PREFIX}${roomId}:views`).catch(() => null),
    redis.get(`${BOOKED_PREFIX}${roomId}:booked`).catch(() => null),
  ]);
  const views = Number(viewsRaw ?? "0");
  const bookedRecent = Number(bookedRaw ?? "0");

  // predictif motor: ilk gece için talep sinyali + güncel fiyat
  const nightlyBase =
    availability.find((a) => a.date.getTime() === start.getTime())?.price ??
    room.property.basePrice ??
    Number(availability[0]?.price ?? 0);
  let demandSignal = 0;
  let currentNightlyPrice = Number(nightlyBase) || 0;
  try {
    const quote = await calculateDynamicPrice({
      propertyId: room.propertyId,
      roomId,
      date: start.toISOString().slice(0, 10),
      basePrice: Number(nightlyBase) || Number(room.property.basePrice) || 0,
      occupancyRate: scarcity,
      locationId: room.property.locationId,
    });
    demandSignal = quote.factors.demandSignal ?? scarcity;
    currentNightlyPrice = quote.price;
  } catch {
    // motor yoksa DB fiyatı korunur
  }

  let status: RoomHeat["status"] = "available";
  if (availableNights === 0) status = "sold_out";
  else if (scarcity >= 0.7 || views >= 50 || demandSignal >= 0.6) status = "limited";

  return {
    roomId,
    propertyId: room.propertyId,
    totalNights,
    bookedNights,
    availableNights,
    scarcity: Math.round(scarcity * 100) / 100,
    views,
    bookedRecent,
    demandSignal: Math.round(clamp(demandSignal, 0, 1) * 100) / 100,
    currentNightlyPrice,
    status,
    updatedAt: Date.now(),
  };
}
