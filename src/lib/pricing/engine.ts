import { prisma } from "@/lib/prisma";
import { diffDays, fromDate, monthOf, parseIsoDate, toDbDate } from "@/lib/time/nights";
import { PricingResult } from "@/lib/pricing-service";
import { breakers } from "@/lib/resilience/circuit-breaker";

/**
 * Türevsel (predictive) fiyatlandırma motoru.
 *
 * Talep sinyali beş bağımsız bileşenin birleşimidir:
 *  1. Occupancy: o anki doluluk (rezervasyon/ayrılan oda oranı)
 *  2. Mevsimsellik: yüksek sezon / yılbaşı / düşük sezon eğrileri
 *  3. Lead-time: son dakika (acele) + erken rezervasyon (indirim) eğrileri
 *  4. Hafta içi gün: Cuma/Cumartesi gece yoğunluğu
 *  5. Etkinlik yakınlığı: lokasyondaki konser/festival/etkinlikler (DemandEvent)
 *
 * Nihai fiyat her zaman zemin fiyatın [0.60, 3.00] aralığında kelepçelenir.
 */

export interface DynamicPricingInput {
  propertyId: string;
  roomId: string;
  date: string;
  basePrice: number;
  occupancyRate?: number;
  seasonalFactor?: number;
  lastMinuteFactor?: number;
  currency?: string;
  /** İsteğe bağlı önbelleğe alınmış lokasyon; yoksa DB'den çekilir. */
  locationId?: string;
}

export interface DynamicFactors {
  seasonalFactor: number;
  lastMinuteFactor: number;
  occupancyMultiplier: number;
  leadTimeFactor: number;
  weekdayFactor: number;
  eventFactor: number;
  demandSignal: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Bugünden (UTC) hedef geceye kalan gün sayısı — yerel saat dilimi kullanılmaz. */
export function daysUntil(date: Date, now: Date = new Date()): number {
  return diffDays(fromDate(now), fromDate(date));
}

export function getSeasonalFactor(date: Date): number {
  // 0 tabanlı UTC ay (yerel getMonth DEĞİL — gece sınırında yanlış ay üretmesin).
  const month = monthOf(fromDate(date)) - 1;
  // Haziran-Eylül yüksek sezon
  if (month >= 5 && month <= 8) return 1.3;
  // Aralık-Ocak yılbaşı
  if (month === 11 || month === 0) return 1.15;
  return 1.0;
}

/** Son dakika (acele) ve çok erken rezervasyon eğrisi. */
export function getLeadTimeFactor(date: Date): { lastMinute: number; leadTime: number } {
  const days = daysUntil(date);
  let lastMinute = 1.0;
  if (days <= 3) lastMinute = 1.2;
  else if (days <= 7) lastMinute = 1.1;
  // 90 günden uzun süre önce → erken rezervasyon müjdesi
  const leadTime = days >= 90 ? 0.95 : 1.0;
  return { lastMinute, leadTime };
}

export function getWeekdayFactor(date: Date): number {
  const day = date.getUTCDay();
  // Cuma (5) / Cumartesi (6) geceleri daha pahalı; Pazar (0) hafif yüksek
  if (day === 5) return 1.15;
  if (day === 6) return 1.18;
  if (day === 0) return 1.05;
  return 1.0;
}

export function getOccupancyMultiplier(occupancyRate: number): number {
  const rate = clamp(occupancyRate, 0, 1);
  // %50 doluluk = 1.0; her %10 yukarı/aşağı yaklaşık %4
  return 1 + (rate - 0.5) * 0.4;
}

/**
 * Lokasyondaki etkinliklerin tarih yakınlığına göre ağırlıklı talep etkisi.
 * Etkinlik penceresi (başlangıç-2gün .. bitiş+1gün) güçlü; öncesi 10 gün boyunca
 * doğrusal sönümlenir. demandSignal 0..1, eventFactor 1+boost.
 */
export async function loadDemandImpact(
  locationId: string,
  date: Date
): Promise<{ eventFactor: number; demandSignal: number }> {
  const windowStart = new Date(date);
  windowStart.setUTCDate(windowStart.getUTCDate() - 12);
  const windowEnd = new Date(date);
  windowEnd.setUTCDate(windowEnd.getUTCDate() + 1);

  const events = await prisma.demandEvent.findMany({
    where: {
      locationId,
      endsAt: { gte: windowStart },
      startsAt: { lte: windowEnd },
    },
    select: { startsAt: true, endsAt: true, impact: true },
  });

  if (events.length === 0) {
    return { eventFactor: 1, demandSignal: 0 };
  }

  const dayMs = 1000 * 60 * 60 * 24;
  let totalImpact = 0;
  for (const event of events) {
    const start = new Date(event.startsAt);
    const end = new Date(event.endsAt);
    // Etkinlik penceresinin hedef günle kesişimi
    const inWindow =
      date.getTime() >= start.getTime() - 2 * dayMs && date.getTime() <= end.getTime() + 1 * dayMs;
    const daysBefore = Math.round((start.getTime() - date.getTime()) / dayMs);
    // 10 gün önceden doğrusal sönüm
    const decay = inWindow ? 1 : Math.max(0, 1 - Math.max(0, daysBefore) / 10);
    totalImpact += event.impact * decay;
  }

  const maxImpact = 30; // doygunluk eşiği
  const demandSignal = Math.min(1, totalImpact / maxImpact);
  const eventFactor = 1 + demandSignal * 0.6; // en fazla %60 artış
  return { eventFactor, demandSignal };
}

export function computeDynamicPrice(
  input: DynamicPricingInput,
  demand: { eventFactor: number; demandSignal: number }
): PricingResult {
  const date = toDbDate(parseIsoDate(input.date));
  const occupancyRate = clamp(input.occupancyRate ?? 0.5, 0, 1);
  const seasonalFactor = input.seasonalFactor ?? getSeasonalFactor(date);
  const lastMinuteFactor = input.lastMinuteFactor ?? getLeadTimeFactor(date).lastMinute;
  const leadTimeFactor = getLeadTimeFactor(date).leadTime;
  const weekdayFactor = getWeekdayFactor(date);
  const occupancyMultiplier = getOccupancyMultiplier(occupancyRate);

  const price = clamp(
    input.basePrice *
      seasonalFactor *
      lastMinuteFactor *
      leadTimeFactor *
      weekdayFactor *
      occupancyMultiplier *
      demand.eventFactor,
    input.basePrice * 0.6,
    input.basePrice * 3.0
  );

  // Birleşik talep sinyali (0..1): etc. payı baskın, ama occupancy da sinyale karışır
  const demandSignal = clamp(0.5 * demand.demandSignal + 0.5 * occupancyRate, 0, 1);

  return {
    roomId: input.roomId,
    date: input.date,
    price: Math.round(price * 100) / 100,
    currency: input.currency || "TRY",
    factors: {
      occupancyRate,
      seasonalFactor,
      lastMinuteFactor,
      eventFactor: demand.eventFactor,
      leadTimeFactor,
      weekdayFactor,
      occupancyMultiplier,
      demandSignal,
    },
  };
}

export async function calculateDynamicPrice(input: DynamicPricingInput): Promise<PricingResult> {
  let locationId = input.locationId;
  if (!locationId) {
    const property = await prisma.property.findUnique({
      where: { id: input.propertyId },
      select: { locationId: true },
    });
    locationId = property?.locationId ?? "";
  }

  let demand = { eventFactor: 1, demandSignal: 0 };
  if (locationId) {
    demand = await breakers.pricing.call(
      () => loadDemandImpact(locationId, new Date(input.date)),
      async () => ({ eventFactor: 1, demandSignal: 0 })
    );
  }

  return computeDynamicPrice(input, demand);
}
