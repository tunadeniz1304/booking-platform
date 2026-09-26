import { randomUUID } from "crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { getConfig } from "@/lib/config/app-config";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/http/errors";
import {
  add,
  applyBps,
  money,
  sum,
  type CurrencyCode,
  assertCurrency,
  minorFromDb,
} from "@/lib/money/money";
import {
  clockOf,
  DateRangeError,
  fromDate,
  parseStay,
  todayIn,
  toDbDate,
  type IsoDate,
} from "@/lib/time/nights";
import { checkRestrictions, describeViolation } from "@/lib/booking/restrictions";
import { chargeAmount, getCurrentFx, resolveChargeCurrency } from "@/lib/fx/store";
import { computeTaxes, taxRulesFor, type TaxLine, type TaxRule } from "@/lib/pricing/tax";
import { isListable } from "@/lib/compliance/listing";

/**
 * Fiyatın TEK kaynağı.
 *
 * Arama kartı, ürün sayfası (PDP), checkout, gRPC/MCP ve tahsilat aynı saf fonksiyonu
 * (`priceStay`) kullanır → gösterilen fiyat = tahsil edilen fiyat. Tüm tutarlar minor-unit
 * tamsayıdır; vergiler dahil "all-in" toplam döner.
 *
 * Gece fiyatı = InventoryDay.price (dinamik fiyat motoru) + RoomType.priceModifier, sonra
 * fiyat planının baz puan farkı (`RatePlan.priceModifierBps`, ör. iade edilemez −%10).
 */

export interface NightInput {
  date: IsoDate;
  /** InventoryDay.price, minor-unit. */
  baseMinor: number;
}

export interface QuoteNight {
  date: IsoDate;
  amount: number;
}

/** Ücret satırı (hizmet bedeli…) — vergi motorunun satırıyla aynı biçim. */
export type QuoteFee = TaxLine;
/** Vergi satırı; `inclusive` ise tutar gece fiyatının içindedir (toplama eklenmez). */
export type QuoteTax = TaxLine;

export interface PricedStay {
  currency: CurrencyCode;
  nights: QuoteNight[];
  subtotal: number;
  fees: QuoteFee[];
  taxes: QuoteTax[];
  total: number;
}

export interface QuoteRatePlan {
  id: string;
  code: string;
  name: string;
  mealPlan: string;
  refundable: boolean;
  priceModifierBps: number;
}

export interface Quote extends PricedStay {
  quoteId: string;
  propertyId: string;
  roomId: string;
  ratePlan: QuoteRatePlan;
  checkIn: IsoDate;
  checkOut: IsoDate;
  guests: number;
  units: number;
  createdAt: string;
  expiresAt: string;
  /** Teklifin sabitlediği kur tablosu (`FxRate.id`; statik yedekte null) — P0-5. */
  fxSnapshotId: string | null;
  /** Tahsil edilecek tutar: tesis para biriminde ya da izin verilen seçili birimde. */
  charge: { currency: CurrencyCode; total: number };
}

/** Saf fiyatlama: geceler + oda farkı + plan farkı + vergi → kırılım. Deterministik. */
export function priceStay(input: {
  nights: readonly NightInput[];
  modifierMinor: number;
  /** Fiyat planı farkı (baz puan); verilmezse 0. */
  planModifierBps?: number;
  /** Oda adedi (gece tutarı × adet). */
  units?: number;
  currency: CurrencyCode | string;
  /** Tesisin ülkesine çözümlenmiş vergi/ücret kuralları (`taxRulesFor`). */
  taxRules: readonly TaxRule[];
  /** Kişi başı sabit vergiler için misafir sayısı. */
  guests?: number;
}): PricedStay {
  const currency = assertCurrency(input.currency);
  const units = input.units ?? 1;
  if (input.nights.length === 0) throw new ValidationError("En az bir gece gerekli");
  if (!Number.isInteger(units) || units < 1) throw new ValidationError("Oda adedi en az 1");
  const nights = input.nights.map((n) => {
    const perRoom = applyBps(
      money(n.baseMinor + input.modifierMinor, currency),
      input.planModifierBps ?? 0
    );
    return { date: n.date, amount: perRoom.amount * units };
  });
  if (nights.some((n) => n.amount < 0)) throw new ValidationError("Gece fiyatı negatif olamaz");
  const subtotal = sum(
    nights.map((n) => money(n.amount, currency)),
    currency
  );
  const { taxes, fees, addOn } = computeTaxes({
    nights,
    rules: input.taxRules,
    currency,
    guests: input.guests,
    units,
  });
  const total = add(subtotal, money(addOn, currency));
  return { currency, nights, subtotal: subtotal.amount, fees, taxes, total: total.amount };
}

/**
 * Kilitlenmiş/okunmuş envanter satırlarını gece girdisine çevirir. Her gece için satır
 * olmalı ve en az `units` oda boş olmalı (`total − sold − held`); değilse `null`.
 */
export function nightsFromInventory(
  rows: ReadonlyArray<{
    date: Date;
    priceMinor: bigint | number;
    total: number;
    sold: number;
    held: number;
  }>,
  stayNights: readonly IsoDate[],
  currency: CurrencyCode | string,
  units = 1
): NightInput[] | null {
  const byDate = new Map(rows.map((r) => [fromDate(r.date), r]));
  const out: NightInput[] = [];
  for (const date of stayNights) {
    const row = byDate.get(date);
    if (!row || row.total - row.sold - row.held < units) return null;
    out.push({ date, baseMinor: minorFromDb(row.priceMinor) });
  }
  return out;
}

export class SoldOutError extends ConflictError {
  constructor(message = "Oda seçilen tarihler için müsait değil") {
    super(message, "SOLD_OUT");
    this.name = "SoldOutError";
  }
}

/** Satış kısıtı ihlali (min konaklama, varışa kapalı, satış durdurma…) → 409. */
export class RestrictionError extends ConflictError {
  constructor(message: string, code: string) {
    super(message, "RESTRICTED", { restriction: code });
    this.name = "RestrictionError";
  }
}

export interface QuoteRequest {
  roomId: string;
  propertyId?: string;
  ratePlanId?: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  units?: number;
  /** Tahsilat para birimi (`FX_CHARGE_CURRENCIES` ile izinli); yoksa tesisinki. */
  currency?: string;
}

const ratePlanSelect = {
  id: true,
  code: true,
  name: true,
  mealPlan: true,
  refundable: true,
  priceModifierBps: true,
  isDefault: true,
  active: true,
} satisfies Prisma.RatePlanSelect;

type RatePlanRow = Prisma.RatePlanGetPayload<{ select: typeof ratePlanSelect }>;

/** İstenen aktif planı ya da varsayılanı (yoksa ilk aktif planı) seçer. */
export function pickRatePlan<T extends RatePlanRow>(plans: readonly T[], ratePlanId?: string): T {
  const active = plans.filter((p) => p.active);
  if (ratePlanId) {
    const plan = active.find((p) => p.id === ratePlanId);
    if (!plan) throw new ValidationError("Fiyat planı bulunamadı");
    return plan;
  }
  const plan = active.find((p) => p.isDefault) ?? active[0];
  if (!plan) throw new SoldOutError("Bu oda için satışta fiyat planı yok");
  return plan;
}

function toQuotePlan(p: RatePlanRow): QuoteRatePlan {
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    mealPlan: p.mealPlan,
    refundable: p.refundable,
    priceModifierBps: p.priceModifierBps,
  };
}

/**
 * `computeTotal` — veritabanındaki güncel gece fiyatlarından teklif üretir.
 * Uygun değilse 409 SOLD_OUT / RESTRICTED, oda yoksa 404, kapasite aşımında 400.
 * "Geçmiş tarih" kontrolü TESİSİN yerel bugününe göre yapılır (v3#6).
 */
export async function computeTotal(req: QuoteRequest, now: Date = new Date()): Promise<Quote> {
  const config = getConfig();
  const units = req.units ?? 1;
  const room = await prisma.roomType.findUnique({
    where: { id: req.roomId },
    select: {
      id: true,
      maxOccupancy: true,
      units: true,
      available: true,
      priceModifierMinor: true,
      propertyId: true,
      property: {
        select: {
          currency: true,
          isActive: true,
          licenseStatus: true,
          timeZone: true,
          checkInTime: true,
          checkOutTime: true,
          location: { select: { country: true } },
        },
      },
      ratePlans: { select: ratePlanSelect },
    },
  });
  // Doğrulanmamış ilana teklif verilmez (v3#26).
  if (
    !room ||
    !isListable(room.property) ||
    (req.propertyId && room.propertyId !== req.propertyId)
  ) {
    throw new NotFoundError("Oda bulunamadı");
  }
  let stay;
  try {
    stay = parseStay(req.checkIn, req.checkOut, {
      maxNights: config.MAX_STAY_NIGHTS,
      today: todayIn(clockOf(room.property).timeZone, now),
    });
  } catch (error) {
    if (error instanceof DateRangeError) throw new ValidationError(error.message);
    throw error;
  }
  if (req.guests > room.maxOccupancy * units) {
    throw new ValidationError(`Bu oda en fazla ${room.maxOccupancy} kişiliktir`);
  }
  if (!room.available || units > room.units) throw new SoldOutError();
  const plan = pickRatePlan(room.ratePlans, req.ratePlanId);

  const currency = assertCurrency(room.property.currency);
  const [rows, restrictions] = await Promise.all([
    prisma.inventoryDay.findMany({
      where: {
        roomTypeId: room.id,
        date: { gte: toDbDate(stay.checkIn), lt: toDbDate(stay.checkOut) },
      },
      select: { date: true, priceMinor: true, total: true, sold: true, held: true },
    }),
    prisma.restriction.findMany({
      where: {
        roomTypeId: room.id,
        date: { gte: toDbDate(stay.checkIn), lte: toDbDate(stay.checkOut) },
      },
    }),
  ]);
  const violation = checkRestrictions(stay, restrictions);
  if (violation) throw new RestrictionError(describeViolation(violation), violation.code);
  const nights = nightsFromInventory(rows, stay.nights, currency, units);
  if (!nights) throw new SoldOutError();

  const priced = priceStay({
    nights,
    modifierMinor: minorFromDb(room.priceModifierMinor),
    planModifierBps: plan.priceModifierBps,
    units,
    currency,
    taxRules: taxRulesFor(room.property.location.country),
    guests: req.guests,
  });
  const chargeCurrency = resolveChargeCurrency(currency, req.currency);
  const fx = await getCurrentFx(now);
  const charge = chargeAmount(money(priced.total, currency), chargeCurrency, fx);
  const expiresAt = new Date(now.getTime() + config.QUOTE_TTL_MINUTES * 60_000);
  return {
    ...priced,
    fxSnapshotId: fx.id,
    charge: { currency: charge.currency, total: charge.total },
    quoteId: randomUUID(),
    propertyId: room.propertyId,
    roomId: room.id,
    ratePlan: toQuotePlan(plan),
    checkIn: stay.checkIn,
    checkOut: stay.checkOut,
    guests: req.guests,
    units,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
}

const QUOTE_PREFIX = "quote:";

/** Teklifi TTL ile saklar (checkout `quoteId` gönderir). */
async function saveQuote(quote: Quote): Promise<void> {
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
