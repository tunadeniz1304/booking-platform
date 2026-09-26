import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getConfig } from "@/lib/config/app-config";
import { withSerializableRetry } from "@/lib/db/transactions";
import { isListable } from "@/lib/compliance/listing";
import { assertCurrency, minorFromDb, minorToDb, type CurrencyCode } from "@/lib/money/money";
import {
  addDays,
  clockOf,
  diffDays,
  fromDate,
  todayIn,
  toDbDate,
  type IsoDate,
} from "@/lib/time/nights";
import type { RestrictionRow } from "@/lib/booking/restrictions";
import { priceStay } from "@/lib/pricing/quote";
import { taxRulesFor, type TaxRule } from "@/lib/pricing/tax";
import { ValidationError } from "@/lib/http/errors";
import { errorFields, logger } from "@/lib/observability/logger";

/**
 * P1-3 esnek tarih fiyat takvimi — `MinPriceByDate` materyalize görünümü.
 *
 * Her (tesis, gece) için en ucuz 1 gecelik fiyat, teklif motorunun SAF fonksiyonu
 * `priceStay` ile hesaplanır (oda farkı + plan farkı + vergiler); böylece takvimde görünen
 * "vergiler dahil" tutar, aynı gece için 1 gecelik `createQuote` toplamının tüm oda/plan
 * seçenekleri üzerindeki en küçüğüne eşittir (property test: tests/unit/pricing/price-calendar).
 * Teklif motoru DEĞİŞTİRİLMEZ; yalnızca çağrılır.
 *
 * Satılabilir gece: oda tipi satışta (`available`), `PRICE_CALENDAR_GUESTS` kişiyi alır, aktif
 * fiyat planı var, envanter satırı var ve en az bir birim boş (`total − sold − held ≥ 1`),
 * gecede satış durdurma (`stopSell`) yok. Varış kısıtları (min. konaklama, girişe kapalı)
 * fiyatı değiştirmez; UI'da işaret olarak gösterilir.
 */

export interface CalendarPlanInput {
  id: string;
  priceModifierBps: number;
}

export interface CalendarRoomInput {
  roomTypeId: string;
  /** RoomType.priceModifierMinor. */
  modifierMinor: number;
  plans: readonly CalendarPlanInput[];
  /** O gecenin envanter satırı (yoksa satılamaz). */
  inventory?: { priceMinor: bigint | number; total: number; sold: number; held: number } | null;
  /** O gecenin kısıt satırı. */
  restriction?: RestrictionRow | null;
}

export interface CalendarDay {
  date: IsoDate;
  /** Vergiler hariç gecelik fiyat (minor-unit); satılamıyorsa null. */
  minNightlyMinor: number | null;
  /** Vergiler/ücretler dahil 1 gecelik toplam (minor-unit); satılamıyorsa null. */
  minTotalMinor: number | null;
  availableRoomTypes: number;
  roomTypeId: string | null;
  ratePlanId: string | null;
  minStay: number | null;
  closedToArrival: boolean;
}

interface Option {
  roomTypeId: string;
  ratePlanId: string;
  nightly: number;
  total: number;
  cta: boolean;
  minStay: number | null;
}

function better(a: Option, b: Option): boolean {
  if (a.total !== b.total) return a.total < b.total;
  if (a.nightly !== b.nightly) return a.nightly < b.nightly;
  if (a.roomTypeId !== b.roomTypeId) return a.roomTypeId < b.roomTypeId;
  return a.ratePlanId < b.ratePlanId;
}

/**
 * Saf çekirdek: tek gece için en ucuz (oda tipi, plan) seçeneği. Girişe açık seçenekler
 * önceliklidir; hepsi girişe kapalıysa en ucuzu `closedToArrival: true` ile döner.
 */
export function cheapestNight(input: {
  date: IsoDate;
  currency: CurrencyCode | string;
  taxRules: readonly TaxRule[];
  guests: number;
  rooms: readonly CalendarRoomInput[];
}): CalendarDay {
  let open: Option | null = null;
  let closed: Option | null = null;
  let sellable = 0;
  for (const room of input.rooms) {
    const inv = room.inventory;
    if (!inv || inv.total - inv.sold - inv.held < 1) continue;
    if (room.restriction?.stopSell) continue;
    if (room.plans.length === 0) continue;
    let counted = false;
    const cta = room.restriction?.closedToArrival ?? false;
    const minStay =
      room.restriction?.minStay && room.restriction.minStay > 1 ? room.restriction.minStay : null;
    for (const plan of room.plans) {
      let priced;
      try {
        priced = priceStay({
          nights: [{ date: input.date, baseMinor: minorFromDb(inv.priceMinor) }],
          modifierMinor: room.modifierMinor,
          planModifierBps: plan.priceModifierBps,
          currency: input.currency,
          taxRules: input.taxRules,
          guests: input.guests,
        });
      } catch (error) {
        // Negatif gece fiyatı (hatalı oda farkı) teklif motorunda da satılamaz.
        if (error instanceof ValidationError) continue;
        throw error;
      }
      counted = true;
      const option: Option = {
        roomTypeId: room.roomTypeId,
        ratePlanId: plan.id,
        nightly: priced.subtotal,
        total: priced.total,
        cta,
        minStay,
      };
      if (cta) {
        if (!closed || better(option, closed)) closed = option;
      } else if (!open || better(option, open)) {
        open = option;
      }
    }
    if (counted) sellable += 1;
  }
  const best = open ?? closed;
  return {
    date: input.date,
    minNightlyMinor: best?.nightly ?? null,
    minTotalMinor: best?.total ?? null,
    availableRoomTypes: sellable,
    roomTypeId: best?.roomTypeId ?? null,
    ratePlanId: best?.ratePlanId ?? null,
    minStay: best?.minStay ?? null,
    closedToArrival: best?.cta ?? false,
  };
}

/** Gece listesi [from, to] (ikisi dahil). */
export function daysInclusive(from: IsoDate, to: IsoDate): IsoDate[] {
  const n = diffDays(from, to);
  return n < 0 ? [] : Array.from({ length: n + 1 }, (_, i) => addDays(from, i));
}

export interface RefreshRange {
  from?: IsoDate;
  to?: IsoDate;
}

export interface RefreshResult {
  propertyId: string;
  /** Yazılan gece satırı. */
  written: number;
  /** İlan listelenemez/silinmiş → tüm satırları silindi. */
  cleared: boolean;
  from?: IsoDate;
  to?: IsoDate;
}

/**
 * Bir tesisin takvimini [from, to] aralığında (varsayılan: yerel bugün → ufuk) yeniden
 * hesaplar ve aralığı atomik olarak değiştirir (sil + yaz, SERIALIZABLE). İdempotent.
 */
export async function refreshPropertyCalendar(
  propertyId: string,
  range: RefreshRange = {},
  now: Date = new Date()
): Promise<RefreshResult> {
  const config = getConfig();
  const guests = config.PRICE_CALENDAR_GUESTS;
  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    select: {
      id: true,
      currency: true,
      isActive: true,
      licenseStatus: true,
      timeZone: true,
      checkInTime: true,
      checkOutTime: true,
      location: { select: { country: true } },
      rooms: {
        where: { available: true, maxOccupancy: { gte: guests } },
        select: {
          id: true,
          priceModifierMinor: true,
          ratePlans: {
            where: { active: true },
            select: { id: true, priceModifierBps: true },
          },
        },
      },
    },
  });
  if (!property || !isListable(property)) {
    await prisma.minPriceByDate.deleteMany({ where: { propertyId } });
    return { propertyId, written: 0, cleared: true };
  }
  const today = todayIn(clockOf(property).timeZone, now);
  const horizonEnd = addDays(today, config.PRICE_CALENDAR_HORIZON_DAYS - 1);
  const from = range.from && range.from > today ? range.from : today;
  const to = range.to && range.to < horizonEnd ? range.to : horizonEnd;
  const dates = daysInclusive(from, to);
  if (dates.length === 0) return { propertyId, written: 0, cleared: false };

  const currency = assertCurrency(property.currency);
  const taxRules = taxRulesFor(property.location.country);
  const roomIds = property.rooms.map((r) => r.id);
  const dbRange = { gte: toDbDate(from), lte: toDbDate(to) };
  const [inventory, restrictions] =
    roomIds.length === 0
      ? [[], []]
      : await Promise.all([
          prisma.inventoryDay.findMany({
            where: { roomTypeId: { in: roomIds }, date: dbRange },
            select: {
              roomTypeId: true,
              date: true,
              priceMinor: true,
              total: true,
              sold: true,
              held: true,
            },
          }),
          prisma.restriction.findMany({
            where: { roomTypeId: { in: roomIds }, date: dbRange },
          }),
        ]);
  const key = (roomId: string, date: Date) => `${roomId}|${fromDate(date)}`;
  const invByKey = new Map(inventory.map((r) => [key(r.roomTypeId, r.date), r]));
  const resByKey = new Map(restrictions.map((r) => [key(r.roomTypeId, r.date), r]));

  const days = dates.map((date) =>
    cheapestNight({
      date,
      currency,
      taxRules,
      guests,
      rooms: property.rooms.map((room) => {
        const k = `${room.id}|${date}`;
        return {
          roomTypeId: room.id,
          modifierMinor: minorFromDb(room.priceModifierMinor),
          plans: room.ratePlans,
          inventory: invByKey.get(k) ?? null,
          restriction: resByKey.get(k) ?? null,
        };
      }),
    })
  );

  await withSerializableRetry(
    async (tx) => {
      await tx.minPriceByDate.deleteMany({ where: { propertyId, date: dbRange } });
      await tx.minPriceByDate.createMany({
        data: days.map((d) => ({
          propertyId,
          date: toDbDate(d.date),
          minNightlyMinor: d.minNightlyMinor === null ? null : minorToDb(d.minNightlyMinor),
          minTotalMinor: d.minTotalMinor === null ? null : minorToDb(d.minTotalMinor),
          currency,
          availableRoomTypes: d.availableRoomTypes,
          roomTypeId: d.roomTypeId,
          ratePlanId: d.ratePlanId,
          minStay: d.minStay,
          closedToArrival: d.closedToArrival,
          guests,
        })),
      });
    },
    { timeout: 30_000 }
  );
  return { propertyId, written: days.length, cleared: false, from, to };
}

/**
 * Tam yeniden hesaplama (tekrarlayan iş): tüm listelenebilir tesisler ufuk boyunca;
 * listelenemeyen/silinmiş tesislerin ve geçmiş gecelerin satırları temizlenir.
 */
export async function refreshAllCalendars(now: Date = new Date()): Promise<{
  properties: number;
  written: number;
  failed: number;
  purged: number;
}> {
  const purgedOrphans = await prisma.$executeRaw`
    DELETE FROM "MinPriceByDate" m
    WHERE NOT EXISTS (
      SELECT 1 FROM "Property" p
      WHERE p.id = m."propertyId" AND p."isActive" = true
        AND p."licenseStatus"::text = ${"VERIFIED"}
    )`;
  // Dünden eski geceler hiçbir saat diliminde "bugün" olamaz.
  const purgedPast = await prisma.minPriceByDate.deleteMany({
    where: { date: { lt: toDbDate(addDays(fromDate(now), -1)) } },
  });
  const ids = await prisma.property.findMany({
    where: { isActive: true, licenseStatus: "VERIFIED" },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  let written = 0;
  let failed = 0;
  for (const { id } of ids) {
    try {
      written += (await refreshPropertyCalendar(id, {}, now)).written;
    } catch (error) {
      failed += 1;
      logger.error({ propertyId: id, ...errorFields(error) }, "price calendar refresh failed");
    }
  }
  return {
    properties: ids.length,
    written,
    failed,
    purged: purgedOrphans + purgedPast.count,
  };
}

// --- Okuma: ay ızgarası ----------------------------------------------------------------

export type CalendarTaxMode = "included" | "excluded";

export interface CalendarMonthDay {
  date: IsoDate;
  available: boolean;
  /** Seçili vergi modunda gece fiyatı (minor-unit); müsait değilse null. */
  priceMinor: number | null;
  /** Ayın en ucuz gecesi (eşitlikte hepsi). */
  cheapest: boolean;
  /** Fiyat bandı 0 (en ucuz) … 4 (en pahalı); müsait değilse null. Renk tek sinyal değildir. */
  band: number | null;
  /** Ayın en ucuzuna göre `PRICE_CALENDAR_CHEAP_BAND_BPS` içinde. */
  cheap: boolean;
  minStay: number | null;
  closedToArrival: boolean;
  /** Geçmiş gece (tesisin yerel bugününden önce). */
  past: boolean;
}

export interface CalendarMonth {
  propertyId: string;
  month: string;
  currency: string;
  taxMode: CalendarTaxMode;
  guests: number;
  days: CalendarMonthDay[];
  /** Ayın en ucuz gece fiyatı (minor-unit); hiç müsait gece yoksa null. */
  minPriceMinor: number | null;
  maxPriceMinor: number | null;
  /** Satırların en son güncellenme zamanı (ISO); hiç satır yoksa null. */
  updatedAt: string | null;
}

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
export const PRICE_BANDS = 5;

export function parseMonth(value: string | null | undefined): { first: IsoDate; last: IsoDate } {
  const m = value ? MONTH_RE.exec(value) : null;
  if (!m) throw new ValidationError("Ay YYYY-AA biçiminde olmalı", { field: "month" });
  const year = Number(m[1]);
  const month = Number(m[2]);
  const first = `${m[1]}-${m[2]}-01` as IsoDate;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { first, last: `${m[1]}-${m[2]}-${String(lastDay).padStart(2, "0")}` as IsoDate };
}

/** Saf: satırlardan ay ızgarası (bant, en ucuz işareti). */
export function buildMonthGrid(input: {
  first: IsoDate;
  last: IsoDate;
  today: IsoDate;
  taxMode: CalendarTaxMode;
  cheapBandBps: number;
  rows: ReadonlyArray<{
    date: IsoDate;
    minNightlyMinor: number | null;
    minTotalMinor: number | null;
    minStay: number | null;
    closedToArrival: boolean;
  }>;
}): { days: CalendarMonthDay[]; min: number | null; max: number | null } {
  const byDate = new Map(input.rows.map((r) => [r.date, r]));
  const priceOf = (d: IsoDate): number | null => {
    const r = byDate.get(d);
    if (!r || d < input.today) return null;
    return input.taxMode === "included" ? r.minTotalMinor : r.minNightlyMinor;
  };
  const dates = daysInclusive(input.first, input.last);
  const prices = dates.map(priceOf).filter((p): p is number => p !== null);
  const min = prices.length > 0 ? Math.min(...prices) : null;
  const max = prices.length > 0 ? Math.max(...prices) : null;
  const days = dates.map((date): CalendarMonthDay => {
    const price = priceOf(date);
    const row = byDate.get(date);
    let band: number | null = null;
    if (price !== null && min !== null && max !== null) {
      band =
        max === min
          ? 0
          : Math.min(PRICE_BANDS - 1, Math.floor(((price - min) * PRICE_BANDS) / (max - min + 1)));
    }
    return {
      date,
      available: price !== null,
      priceMinor: price,
      cheapest: price !== null && price === min,
      band,
      cheap:
        price !== null && min !== null && price * 10_000 <= min * (10_000 + input.cheapBandBps),
      minStay: price !== null ? (row?.minStay ?? null) : null,
      closedToArrival: price !== null ? (row?.closedToArrival ?? false) : false,
      past: date < input.today,
    };
  });
  return { days, min, max };
}

/**
 * Ay ızgarası. İlan yok/listelenemez → null (route 404). Ayın hesaplanabilir gecelerinin
 * hiç satırı yoksa (yeni ilan, iş henüz koşmadı) aralık istek anında hesaplanır.
 */
export async function getCalendarMonth(
  propertyId: string,
  month: string,
  taxMode: CalendarTaxMode = "included",
  now: Date = new Date()
): Promise<CalendarMonth | null> {
  const config = getConfig();
  const { first, last } = parseMonth(month);
  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    select: {
      id: true,
      currency: true,
      isActive: true,
      licenseStatus: true,
      timeZone: true,
      checkInTime: true,
      checkOutTime: true,
    },
  });
  if (!property || !isListable(property)) return null;
  const today = todayIn(clockOf(property).timeZone, now);
  const horizonEnd = addDays(today, config.PRICE_CALENDAR_HORIZON_DAYS - 1);
  const where = {
    propertyId,
    date: { gte: toDbDate(first), lte: toDbDate(last) },
  } satisfies Prisma.MinPriceByDateWhereInput;
  let rows = await prisma.minPriceByDate.findMany({ where, orderBy: { date: "asc" } });
  const liveFrom = first > today ? first : today;
  const liveTo = last < horizonEnd ? last : horizonEnd;
  if (rows.length === 0 && liveFrom <= liveTo) {
    await refreshPropertyCalendar(propertyId, { from: liveFrom, to: liveTo }, now);
    rows = await prisma.minPriceByDate.findMany({ where, orderBy: { date: "asc" } });
  }
  const grid = buildMonthGrid({
    first,
    last,
    today,
    taxMode,
    cheapBandBps: config.PRICE_CALENDAR_CHEAP_BAND_BPS,
    rows: rows.map((r) => ({
      date: fromDate(r.date),
      minNightlyMinor: r.minNightlyMinor === null ? null : minorFromDb(r.minNightlyMinor),
      minTotalMinor: r.minTotalMinor === null ? null : minorFromDb(r.minTotalMinor),
      minStay: r.minStay,
      closedToArrival: r.closedToArrival,
    })),
  });
  const updatedAt = rows.reduce<Date | null>(
    (acc, r) => (!acc || r.updatedAt > acc ? r.updatedAt : acc),
    null
  );
  return {
    propertyId,
    month,
    currency: property.currency,
    taxMode,
    guests: config.PRICE_CALENDAR_GUESTS,
    days: grid.days,
    minPriceMinor: grid.min,
    maxPriceMinor: grid.max,
    updatedAt: updatedAt?.toISOString() ?? null,
  };
}
