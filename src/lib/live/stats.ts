import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { getConfig } from "@/lib/config/app-config";
import { eventSignal, priceNights } from "@/lib/pricing/event-signals";
import { minorFromDb, moneyFromDb, toDecimalString } from "@/lib/money/money";

/**
 * Canlı talep ısı haritası istatistikleri.
 *
 * Gerçek "Son 1 oda" yerine çok-bileşenli canlı sinyal:
 *  - scarcity: oda için aralıkta dolu gece oranı (stok)
 *  - views: son pencerelerdeki tekil izleyici tahmini (HyperLogLog, ilgi)
 *  - booked: Redis'teki son 24 saatteki rezervasyon sayacı
 *  - demandSignal: olay sinyali (tek fiyat motoru) + doluluk kıtlığı ortalaması
 *
 * SSE akışı bu değerleri 3 sn'de bir yayınlar.
 */

const VIEWS_PREFIX = "live:room:";
const BOOKED_PREFIX = "live:room:";

/** PFADD + TTL (atomik). 1 → HLL değişti (büyük olasılıkla yeni izleyici). */
const PFADD_WITH_TTL = `local a = redis.call('PFADD', KEYS[1], ARGV[1])
redis.call('EXPIRE', KEYS[1], ARGV[2])
return a`;
const PFCOUNT = `return redis.call('PFCOUNT', unpack(KEYS))`;

/** Görüntülenme penceresi anahtarları: [şimdiki, önceki] (kayan ~2 pencere). */
function viewKeys(roomId: string, now: number): [string, string] {
  const window = getConfig().LIVE_VIEW_DEDUPE_SECONDS;
  const bucket = Math.floor(now / 1000 / window);
  return [`${VIEWS_PREFIX}${roomId}:hll:${bucket}`, `${VIEWS_PREFIX}${roomId}:hll:${bucket - 1}`];
}

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

/**
 * Görüntülenme kaydı (v4#18): izleyici kimliği (imzalı oturum `u:` / imzalı cihaz
 * çerezi `d:`, bkz. `live/viewer.ts`) HyperLogLog'a `PFADD` ile eklenir. Aynı
 * izleyicinin yeniden bağlanması sayacı şişiremez; bellek oda başına sabittir.
 */
export async function recordRoomView(
  roomId: string,
  viewerId: string,
  now = Date.now()
): Promise<boolean> {
  try {
    const [current] = viewKeys(roomId, now);
    const ttl = String(getConfig().LIVE_VIEW_DEDUPE_SECONDS * 2);
    return Number(await redis.eval(PFADD_WITH_TTL, [current], [viewerId, ttl])) === 1;
  } catch {
    return false; // sayaç arızası zararsız
  }
}

/** Son iki penceredeki tekil izleyici tahmini (`PFCOUNT` birleşimi). */
export async function countRoomViewers(roomId: string, now = Date.now()): Promise<number> {
  try {
    return Number(await redis.eval(PFCOUNT, viewKeys(roomId, now), [])) || 0;
  } catch {
    return 0;
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
  const room = await prisma.roomType.findUnique({
    where: { id: roomId },
    select: {
      propertyId: true,
      property: { select: { locationId: true, currency: true, basePriceMinor: true } },
    },
  });
  if (!room) return null;

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const start = startDate ? parseDate(startDate) : today;
  const end = endDate ? parseDate(endDate) : new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
  if (end <= start) {
    throw new Error("Geçersiz tarih aralığı");
  }

  const availability = await prisma.inventoryDay.findMany({
    where: { roomTypeId: roomId, date: { gte: start, lt: end } },
    select: { total: true, sold: true, held: true, priceMinor: true, date: true },
  });

  // Oda-gece cinsinden: toplam satılabilir, satılmış + tutulmuş (sayaçlı envanter, ADR 0010).
  const totalNights = availability.reduce((s, a) => s + a.total, 0);
  const bookedNights = availability.reduce((s, a) => s + a.sold + a.held, 0);
  const availableNights = totalNights - bookedNights;
  const scarcity = totalNights > 0 ? bookedNights / totalNights : 0;

  const [views, bookedRaw] = await Promise.all([
    countRoomViewers(roomId),
    redis.get(`${BOOKED_PREFIX}${roomId}:booked`).catch(() => null),
  ]);
  const bookedRecent = Number(bookedRaw ?? "0");

  // Güncel fiyat = envanterdeki (tek motorla yazılmış) fiyat; çarpan tekrar uygulanmaz (v3#9).
  const nightlyBaseMinor =
    availability.find((a) => a.date.getTime() === start.getTime())?.priceMinor ??
    room.property.basePriceMinor ??
    availability[0]?.priceMinor;
  // Görüntüleme için ana birim (ör. 1234.5); minor-unit'ten para biriminin üssüyle.
  const currentNightlyPrice =
    nightlyBaseMinor === undefined
      ? 0
      : Number(toDecimalString(moneyFromDb(nightlyBaseMinor, room.property.currency)));
  // Talep sinyali: olay sinyali (ilk gece) ile doluluk kıtlığının ortalaması.
  let demandSignal = scarcity;
  try {
    const firstNight = start.toISOString().slice(0, 10);
    const priced = await priceNights({
      locationId: room.property.locationId,
      nights: [firstNight],
      baseMinor: minorFromDb(room.property.basePriceMinor),
      currency: room.property.currency,
    });
    demandSignal = (eventSignal(priced.get(firstNight)!) + scarcity) / 2;
  } catch {
    // motor yoksa yalnız doluluk kıtlığı kullanılır
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
