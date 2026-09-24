import { randomUUID } from "crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { getConfig } from "@/lib/config/app-config";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/http/errors";
import {
  add,
  money,
  multiplyRate,
  sum,
  toMinor,
  type CurrencyCode,
  assertCurrency,
} from "@/lib/money/money";
import { DateRangeError, fromDate, parseStay, toDbDate, type IsoDate } from "@/lib/time/nights";

/**
 * Fiyatın TEK kaynağı.
 *
 * Arama kartı, ürün sayfası (PDP), checkout ve tahsilat aynı saf fonksiyonu
 * (`priceStay`) kullanır → gösterilen fiyat = tahsil edilen fiyat. Tüm tutarlar
 * minor-unit tamsayıdır; konaklama vergisi dahil "all-in" toplam döner.
 *
 * Gece fiyatı = Availability.price (dinamik fiyat motorunun yazdığı) + Room.priceModifier.
 */

export interface NightInput {
  date: IsoDate;
  /** Availability.price, minor-unit. */
  baseMinor: number;
}

export interface QuoteNight {
  date: IsoDate;
  amount: number;
}

export interface QuoteFee {
  code: string;
  label: string;
  amount: number;
}

export interface QuoteTax {
  code: "ACCOMMODATION_TAX";
  label: string;
  rate: number;
  amount: number;
}

export interface PricedStay {
  currency: CurrencyCode;
  nights: QuoteNight[];
  subtotal: number;
  fees: QuoteFee[];
  taxes: QuoteTax[];
  total: number;
}

export interface Quote extends PricedStay {
  quoteId: string;
  propertyId: string;
  roomId: string;
  checkIn: IsoDate;
  checkOut: IsoDate;
  guests: number;
  createdAt: string;
  expiresAt: string;
}

/** Saf fiyatlama: geceler + oda farkı + vergi → kırılım. Yan etkisiz ve deterministik. */
export function priceStay(input: {
  nights: readonly NightInput[];
  modifierMinor: number;
  currency: CurrencyCode | string;
  taxRate: number;
}): PricedStay {
  const currency = assertCurrency(input.currency);
  if (input.nights.length === 0) throw new ValidationError("En az bir gece gerekli");
  const nights = input.nights.map((n) => ({
    date: n.date,
    amount: money(n.baseMinor + input.modifierMinor, currency).amount,
  }));
  if (nights.some((n) => n.amount < 0)) throw new ValidationError("Gece fiyatı negatif olamaz");
  const subtotal = sum(
    nights.map((n) => money(n.amount, currency)),
    currency
  );
  const fees: QuoteFee[] = [];
  const tax = multiplyRate(subtotal, input.taxRate);
  const taxes: QuoteTax[] =
    input.taxRate > 0
      ? [
          {
            code: "ACCOMMODATION_TAX",
            label: "Konaklama vergisi",
            rate: input.taxRate,
            amount: tax.amount,
          },
        ]
      : [];
  const total = add(
    subtotal,
    money(
      taxes.reduce((s, t) => s + t.amount, 0),
      currency
    )
  );
  return { currency, nights, subtotal: subtotal.amount, fees, taxes, total: total.amount };
}

/** Oda + tarih aralığı için kilitlenmiş/okunmuş Availability satırlarını gece girdisine çevirir. */
export function nightsFromRows(
  rows: ReadonlyArray<{
    date: Date;
    price: Prisma.Decimal | string | number;
    isAvailable: boolean;
  }>,
  stayNights: readonly IsoDate[],
  currency: CurrencyCode | string
): NightInput[] | null {
  const byDate = new Map(rows.map((r) => [fromDate(r.date), r]));
  const out: NightInput[] = [];
  for (const date of stayNights) {
    const row = byDate.get(date);
    if (!row || !row.isAvailable) return null;
    out.push({ date, baseMinor: toMinor(row.price.toString(), currency) });
  }
  return out;
}

export class SoldOutError extends ConflictError {
  constructor(message = "Oda seçilen tarihler için müsait değil") {
    super(message, "SOLD_OUT");
    this.name = "SoldOutError";
  }
}

export interface QuoteRequest {
  roomId: string;
  propertyId?: string;
  checkIn: string;
  checkOut: string;
  guests: number;
}

/**
 * `computeTotal` — veritabanındaki güncel gece fiyatlarından teklif üretir.
 * Uygun değilse 409 SOLD_OUT, oda yoksa 404, kapasite aşımında 400.
 */
export async function computeTotal(req: QuoteRequest, now: Date = new Date()): Promise<Quote> {
  const config = getConfig();
  let stay;
  try {
    stay = parseStay(req.checkIn, req.checkOut, {
      maxNights: config.MAX_STAY_NIGHTS,
      today: fromDate(now),
    });
  } catch (error) {
    if (error instanceof DateRangeError) throw new ValidationError(error.message);
    throw error;
  }

  const room = await prisma.room.findUnique({
    where: { id: req.roomId },
    select: {
      id: true,
      capacity: true,
      available: true,
      priceModifier: true,
      propertyId: true,
      property: { select: { currency: true, isActive: true } },
    },
  });
  if (!room || !room.property.isActive || (req.propertyId && room.propertyId !== req.propertyId)) {
    throw new NotFoundError("Oda bulunamadı");
  }
  if (req.guests > room.capacity) {
    throw new ValidationError(`Bu oda en fazla ${room.capacity} kişiliktir`);
  }
  if (!room.available) throw new SoldOutError();

  const currency = assertCurrency(room.property.currency);
  const rows = await prisma.availability.findMany({
    where: {
      roomId: room.id,
      date: { gte: toDbDate(stay.checkIn), lt: toDbDate(stay.checkOut) },
    },
    select: { date: true, price: true, isAvailable: true },
  });
  const nights = nightsFromRows(rows, stay.nights, currency);
  if (!nights) throw new SoldOutError();

  const priced = priceStay({
    nights,
    modifierMinor: toMinor(room.priceModifier.toString(), currency),
    currency,
    taxRate: config.ACCOMMODATION_TAX_RATE,
  });
  const expiresAt = new Date(now.getTime() + config.QUOTE_TTL_MINUTES * 60_000);
  return {
    ...priced,
    quoteId: randomUUID(),
    propertyId: room.propertyId,
    roomId: room.id,
    checkIn: stay.checkIn,
    checkOut: stay.checkOut,
    guests: req.guests,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
}

const QUOTE_PREFIX = "quote:";

/** Teklifi TTL ile saklar (checkout `quoteId` gönderir). */
export async function saveQuote(quote: Quote): Promise<void> {
  await redis.set(`${QUOTE_PREFIX}${quote.quoteId}`, JSON.stringify(quote), {
    ex: getConfig().QUOTE_TTL_MINUTES * 60,
  });
}

export async function loadQuote(quoteId: string): Promise<Quote | null> {
  const raw = await redis.get(`${QUOTE_PREFIX}${quoteId}`);
  return raw ? (JSON.parse(raw) as Quote) : null;
}

/** computeTotal + saveQuote (Redis yoksa teklif yine döner; checkout yeniden teklif ister). */
export async function createQuote(req: QuoteRequest): Promise<Quote> {
  const quote = await computeTotal(req);
  try {
    await saveQuote(quote);
  } catch {
    // Redis erişilemezse teklif geçerli kalır; rezervasyon anında yeniden hesaplanır.
  }
  return quote;
}

/** İki fiyatlamanın tahsilat açısından aynı olup olmadığı. */
export function samePrice(a: PricedStay, b: PricedStay): boolean {
  return (
    a.currency === b.currency &&
    a.total === b.total &&
    a.nights.length === b.nights.length &&
    a.nights.every((n, i) => n.date === b.nights[i].date && n.amount === b.nights[i].amount)
  );
}
