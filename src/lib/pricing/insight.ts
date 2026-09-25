import { prisma } from "@/lib/prisma";
import { getConfig } from "@/lib/config/app-config";
import { NotFoundError, ValidationError } from "@/lib/http/errors";
import { assertCurrency, toMinor } from "@/lib/money/money";
import {
  addDays,
  DateRangeError,
  fromDate,
  nightsBetween,
  parseIsoDate,
  toDbDate,
  type IsoDate,
} from "@/lib/time/nights";
import { explainNightPrice } from "./event-signals";

/**
 * Fiyat içgörüsü (P1-4): split conformal prediction ile gecelik fiyat için (1 − α) tahmin
 * aralığı ve "düşük / tipik / yüksek" etiketi; Omnibus referans fiyatı (son N günün en
 * düşüğü, "önceki fiyat"). Karar kuralları deterministiktir; LLM kullanılmaz.
 *
 * Nokta tahmini ŷ = olaysız motor fiyatı (taban × mevsim × hafta günü, ADR 0016).
 * Uygunsuzluk skoru ölçekten bağımsız göreli hata: s = |y / ŷ − 1|. Kalibrasyon kümesi
 * aynı konumdaki diğer oda-gecelerinden gelir (hedef gecelerden ayrık).
 */

export type PriceLabel = "low" | "typical" | "high";

export interface PriceInterval {
  low: number;
  high: number;
}

/**
 * Split conformal eşik: skorların ⌈(n+1)(1−α)⌉. en küçüğü. n bu sıra için yetersizse
 * `Infinity` (sonsuz aralık — kapsama garantisi korunur).
 */
export function conformalQuantile(scores: readonly number[], alpha: number): number {
  if (!(alpha > 0 && alpha < 1)) throw new ValidationError("alpha (0, 1) aralığında olmalı");
  const n = scores.length;
  const rank = Math.ceil((n + 1) * (1 - alpha));
  if (n === 0 || rank > n) return Number.POSITIVE_INFINITY;
  const sorted = [...scores].sort((a, b) => a - b);
  return sorted[rank - 1];
}

/** Göreli uygunsuzluk skoru |y/ŷ − 1| (ŷ > 0). */
export function relativeScore(actual: number, predicted: number): number {
  if (predicted <= 0) throw new ValidationError("Tahmin pozitif olmalı");
  return Math.abs(actual / predicted - 1);
}

/** ŷ(1 ± q), minor birime dışa doğru yuvarlanır (aralık daralmaz). */
export function predictionInterval(predictedMinor: number, q: number): PriceInterval {
  if (!Number.isFinite(q)) return { low: 0, high: Number.MAX_SAFE_INTEGER };
  return {
    low: Math.max(0, Math.floor(predictedMinor * (1 - q))),
    high: Math.ceil(predictedMinor * (1 + q)),
  };
}

export function classifyPrice(priceMinor: number, interval: PriceInterval): PriceLabel {
  if (priceMinor < interval.low) return "low";
  if (priceMinor > interval.high) return "high";
  return "typical";
}

export const PRICE_LABEL_TEXT: Record<PriceLabel, string> = {
  low: "Düşük",
  typical: "Tipik",
  high: "Yüksek",
};

export interface PriceObservation {
  /** Gözlem günü (YYYY-MM-DD, UTC). */
  on: string;
  /** Konaklama toplamı (minor unit). */
  total: number;
}

/**
 * Omnibus referans fiyatı: `today`'den önceki son `days` gün içindeki en düşük gözlem.
 * Bugünün gözlemi hariçtir (indirim, önceki fiyatla kıyaslanır). Gözlem yoksa `null`.
 */
export function omnibusReferencePrice(
  observations: readonly PriceObservation[],
  today: string,
  days: number
): number | null {
  const from = addDays(parseIsoDate(today), -days);
  const inWindow = observations.filter((o) => o.on >= from && o.on < today);
  if (inWindow.length === 0) return null;
  return Math.min(...inWindow.map((o) => o.total));
}

/** Gözlem listesine bugünü yazar (aynı gün tekrar → üzerine yazılır) ve pencere dışını atar. */
export function recordObservation(
  observations: readonly PriceObservation[],
  obs: PriceObservation,
  days: number
): PriceObservation[] {
  const from = addDays(parseIsoDate(obs.on), -days);
  return [...observations.filter((o) => o.on !== obs.on && o.on >= from), obs].sort((a, b) =>
    a.on.localeCompare(b.on)
  );
}

export interface PriceInsight {
  currency: string;
  /** Konaklamanın gece başı ortalama taban fiyatı (minor unit). */
  nightlyMinor: number;
  /** Olaysız motor tahmini (gece başı ortalama). */
  predictedMinor: number;
  /** Kapsama hedefi, ör. 0.9. */
  level: number;
  interval: PriceInterval | null;
  /** Kalibrasyon yetersizse `null`. */
  label: PriceLabel | null;
  calibrationSize: number;
}

function predictedFor(date: IsoDate, baseMinor: number, currency: string): number {
  return explainNightPrice({ date, baseMinor, currency, events: [] }).price;
}

/** Oda + konaklama için içgörü (salt okunur; envanterdeki gecelik fiyatlar üzerinden). */
export async function getPriceInsight(input: {
  roomId: string;
  checkIn: string;
  checkOut: string;
}): Promise<PriceInsight> {
  const cfg = getConfig();
  let nights: IsoDate[];
  try {
    nights = nightsBetween(parseIsoDate(input.checkIn), parseIsoDate(input.checkOut));
  } catch (error) {
    if (error instanceof DateRangeError) throw new ValidationError(error.message);
    throw error;
  }
  if (nights.length === 0) throw new ValidationError("En az bir gece gerekli");
  const room = await prisma.roomType.findUnique({
    where: { id: input.roomId },
    select: {
      property: { select: { locationId: true, currency: true, basePrice: true } },
    },
  });
  if (!room) throw new NotFoundError("Oda bulunamadı");
  const currency = assertCurrency(room.property.currency);
  const baseMinor = toMinor(room.property.basePrice.toString(), currency);

  const own = await prisma.inventoryDay.findMany({
    where: {
      roomTypeId: input.roomId,
      date: { gte: toDbDate(nights[0]), lte: toDbDate(nights[nights.length - 1]) },
    },
    select: { date: true, price: true },
  });
  if (own.length !== nights.length) throw new NotFoundError("Seçilen geceler için fiyat yok");
  const nightlyMinor = Math.round(
    own.reduce((s, r) => s + toMinor(r.price.toString(), currency), 0) / own.length
  );
  const predictedMinor = Math.round(
    nights.reduce((s, d) => s + predictedFor(d, baseMinor, currency), 0) / nights.length
  );

  const today = fromDate(new Date());
  const calibration = await prisma.inventoryDay.findMany({
    where: {
      roomTypeId: { not: input.roomId },
      date: {
        gte: toDbDate(addDays(today, -cfg.PRICE_INSIGHT_WINDOW_DAYS)),
        lte: toDbDate(addDays(today, cfg.PRICE_INSIGHT_WINDOW_DAYS)),
      },
      roomType: { property: { locationId: room.property.locationId, currency } },
    },
    select: {
      date: true,
      price: true,
      roomType: { select: { property: { select: { basePrice: true } } } },
    },
  });
  const scores: number[] = [];
  for (const row of calibration) {
    const predicted = predictedFor(
      fromDate(row.date),
      toMinor(row.roomType.property.basePrice.toString(), currency),
      currency
    );
    if (predicted > 0) {
      scores.push(relativeScore(toMinor(row.price.toString(), currency), predicted));
    }
  }

  const level = Math.round((1 - cfg.PRICE_INSIGHT_ALPHA) * 1000) / 1000;
  if (scores.length < cfg.PRICE_INSIGHT_MIN_CALIBRATION || predictedMinor <= 0) {
    return {
      currency,
      nightlyMinor,
      predictedMinor,
      level,
      interval: null,
      label: null,
      calibrationSize: scores.length,
    };
  }
  const interval = predictionInterval(
    predictedMinor,
    conformalQuantile(scores, cfg.PRICE_INSIGHT_ALPHA)
  );
  return {
    currency,
    nightlyMinor,
    predictedMinor,
    level,
    interval,
    label: classifyPrice(nightlyMinor, interval),
    calibrationSize: scores.length,
  };
}
