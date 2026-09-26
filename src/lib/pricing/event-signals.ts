import { Prisma, type DemandEventStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getConfig } from "@/lib/config/app-config";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/http/errors";
import { breakers } from "@/lib/resilience/circuit-breaker";
import { money, multiplyRate, assertCurrency, minorFromDb, minorToDb } from "@/lib/money/money";
import {
  addDays,
  dayOfWeek,
  fromDate,
  monthOf,
  nightsBetween,
  parseIsoDate,
  toDbDate,
  type IsoDate,
} from "@/lib/time/nights";
import { invalidateSearchCache } from "@/lib/search";

/**
 * Talep olayı sinyalleri + açıklanabilir dinamik fiyat (P1-5; eski "sentiment" modülünün
 * yerine, hata #13 düzeltmeleri):
 *
 *  - Olay önce PROPOSED oluşur (admin/LLM önerisi) — onaylanmadan fiyata yansımaz.
 *  - Fiyat her gece için ORİJİNAL taban fiyattan (Property.basePrice) yeniden hesaplanır:
 *      çarpan = mevsim × hafta günü × (1 + Σ onaylı olay etkisi × EVENT_FACTOR_PER_POINT)
 *      çarpan ∈ [PRICE_FLOOR_MULTIPLIER, PRICE_CEILING_MULTIPLIER]
 *    Mevcut (zaten şişmiş) fiyat hiç girdi olmadığı için bileşik artış yoktur ve aynı
 *    olayı 10 kez uygulamak 1 kez uygulamakla aynıdır (idempotent).
 *  - Yalnızca boş (satılmamış, kilitsiz) geceler yeniden fiyatlanır; her geceye faktör
 *    kırılımı `priceExplanation` olarak yazılır ("Bu fiyat neden?").
 *  - Tek işlem, tek toplu UPDATE (N+1 yok).
 *  - "Hedge" kaldırıldı; yerine onaylı ve geri alınabilir yield hold (oda payı ≤
 *    YIELD_HOLD_MAX_SHARE).
 *
 * Tek gecelik fiyat motoru budur (v3#9, ADR 0016): eski float "prediktif motor"
 * (`pricing/engine.ts`, sabit 0.6–3.0 kırpma + sabit doluluk 0.5) buraya birleştirildi;
 * worker fiyat işi ve canlı ısı haritası da `priceNights` kullanır.
 */

/** Mevsim çarpanı: Haziran–Eylül yüksek sezon, Aralık–Ocak yılbaşı (UTC ay, yerel değil). */
export function getSeasonalFactor(date: Date): number {
  const month = monthOf(fromDate(date));
  if (month >= 6 && month <= 9) return 1.3;
  if (month === 12 || month === 1) return 1.15;
  return 1.0;
}

/** Hafta günü çarpanı: Cuma / Cumartesi geceleri yoğun, Pazar hafif yüksek (UTC). */
function getWeekdayFactor(date: Date): number {
  const day = dayOfWeek(fromDate(date));
  if (day === 5) return 1.15;
  if (day === 6) return 1.18;
  if (day === 0) return 1.05;
  return 1.0;
}

export interface PriceExplanation {
  base: number;
  currency: string;
  factors: { season: number; weekday: number; event: number };
  events: Array<{ id: string; title: string; impact: number }>;
  rawMultiplier: number;
  multiplier: number;
  clamped: "floor" | "ceiling" | null;
  price: number;
}

/** Saf: bir gece için fiyat ve açıklama (minor-unit). */
export function explainNightPrice(input: {
  date: IsoDate;
  baseMinor: number;
  currency: string;
  events: Array<{ id: string; title: string; impact: number }>;
}): PriceExplanation {
  const cfg = getConfig();
  const d = toDbDate(input.date);
  const season = getSeasonalFactor(d);
  const weekday = getWeekdayFactor(d);
  const event = 1 + input.events.reduce((s, e) => s + e.impact, 0) * cfg.EVENT_FACTOR_PER_POINT;
  const raw = season * weekday * event;
  const multiplier = Math.min(
    cfg.PRICE_CEILING_MULTIPLIER,
    Math.max(cfg.PRICE_FLOOR_MULTIPLIER, raw)
  );
  const r4 = (v: number) => Math.round(v * 10_000) / 10_000;
  const currency = assertCurrency(input.currency);
  return {
    base: input.baseMinor,
    currency,
    factors: { season: r4(season), weekday: r4(weekday), event: r4(event) },
    events: input.events,
    rawMultiplier: r4(raw),
    multiplier: r4(multiplier),
    clamped:
      raw > cfg.PRICE_CEILING_MULTIPLIER
        ? "ceiling"
        : raw < cfg.PRICE_FLOOR_MULTIPLIER
          ? "floor"
          : null,
    price: multiplyRate(money(input.baseMinor, currency), r4(multiplier)).amount,
  };
}

type SignalEvent = { id: string; title: string; impact: number; startsAt: Date; endsAt: Date };

function activeOn(events: SignalEvent[], date: IsoDate) {
  return events
    .filter((e) => windowOf(e).includes(date))
    .map((e) => ({ id: e.id, title: e.title, impact: e.impact }));
}

async function approvedEvents(locationId: string, first: Date, last: Date) {
  return prisma.demandEvent.findMany({
    where: {
      locationId,
      status: "APPROVED",
      startsAt: { lte: last },
      endsAt: { gte: addDaysDate(first, -2) },
    },
    select: { id: true, title: true, impact: true, startsAt: true, endsAt: true },
  });
}

/**
 * Verilen geceleri konumdaki onaylı olaylarla fiyatlar (salt okunur). Olay sorgusu devre
 * kesiciden geçer; DB/kesici hatasında olaysız (mevsim × hafta günü) fiyata düşer.
 */
export async function priceNights(input: {
  locationId: string | null;
  /** YYYY-MM-DD geceler (doğrulanır). */
  nights: readonly string[];
  baseMinor: number;
  currency: string;
}): Promise<Map<string, PriceExplanation>> {
  const out = new Map<string, PriceExplanation>();
  if (input.nights.length === 0) return out;
  const sorted = input.nights.map((n) => parseIsoDate(n)).sort();
  const locationId = input.locationId;
  const events: SignalEvent[] = locationId
    ? await breakers.pricing.call(
        () => approvedEvents(locationId, toDbDate(sorted[0]), toDbDate(sorted[sorted.length - 1])),
        async () => []
      )
    : [];
  for (const date of sorted) {
    out.set(
      date,
      explainNightPrice({
        date,
        baseMinor: input.baseMinor,
        currency: input.currency,
        events: activeOn(events, date),
      })
    );
  }
  return out;
}

/** Olay kaynaklı talep sinyali 0..1: olay çarpanının tavana göre konumu. */
export function eventSignal(exp: PriceExplanation): number {
  const headroom = getConfig().PRICE_CEILING_MULTIPLIER - 1;
  if (headroom <= 0) return 0;
  return Math.min(1, Math.max(0, (exp.factors.event - 1) / headroom));
}

function windowOf(event: { startsAt: Date; endsAt: Date }): IsoDate[] {
  // Etki penceresi: olaydan bir gece önce → bittiği geceyi de kapsayacak şekilde
  return nightsBetween(addDays(fromDate(event.startsAt), -1), addDays(fromDate(event.endsAt), 2));
}

/** Konumdaki geceleri onaylı TÜM olaylara göre orijinal tabandan yeniden fiyatlar. */
async function repriceLocation(locationId: string, nights: IsoDate[]): Promise<number> {
  if (nights.length === 0) return 0;
  const first = toDbDate(nights[0]);
  const last = toDbDate(nights[nights.length - 1]);
  return prisma.$transaction(async (tx) => {
    const events = await tx.demandEvent.findMany({
      where: {
        locationId,
        status: "APPROVED",
        startsAt: { lte: last },
        endsAt: { gte: addDaysDate(first, -2) },
      },
      select: { id: true, title: true, impact: true, startsAt: true, endsAt: true },
    });
    // Satılmış gecelerin fiyatı rezervasyon snapshot'ında dondurulmuştur; sayaçlı envanterde
    // satırın kendisi yeniden fiyatlanır (kalan odalar için geçerli fiyat).
    const rows = await tx.inventoryDay.findMany({
      where: {
        date: { gte: first, lte: last },
        // Ev sahibinin sabitlediği (kabul edilen öneri) geceler motor tarafından ezilmez (P1-5).
        priceOverride: false,
        roomType: { property: { locationId, isActive: true }, available: true },
      },
      select: {
        id: true,
        date: true,
        roomType: { select: { property: { select: { basePriceMinor: true, currency: true } } } },
      },
    });
    if (rows.length === 0) return 0;
    const values = rows.map((row) => {
      const date = fromDate(row.date);
      const active = activeOn(events, date);
      const currency = row.roomType.property.currency;
      const exp = explainNightPrice({
        date,
        baseMinor: minorFromDb(row.roomType.property.basePriceMinor),
        currency,
        events: active,
      });
      return Prisma.sql`(${row.id}, ${minorToDb(exp.price)}::bigint, ${JSON.stringify(exp)}::jsonb)`;
    });
    const updated = await tx.$executeRaw`
      UPDATE "InventoryDay" AS a
      SET "priceMinor" = v.price_minor, "priceExplanation" = v.explanation
      FROM (VALUES ${Prisma.join(values)}) AS v(id, price_minor, explanation)
      WHERE a.id = v.id`;
    return updated;
  });
}

function addDaysDate(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}

async function setStatus(
  id: string,
  from: DemandEventStatus[],
  to: DemandEventStatus,
  actorId?: string
) {
  const res = await prisma.demandEvent.updateMany({
    where: { id, status: { in: from } },
    data: {
      status: to,
      ...(to === "APPROVED" ? { approvedBy: actorId, approvedAt: new Date() } : {}),
    },
  });
  if (res.count !== 1) {
    const exists = await prisma.demandEvent.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundError("Olay bulunamadı");
    throw new ConflictError("Olay bu durumdan geçirilemez", "INVALID_STATE");
  }
  return prisma.demandEvent.findUniqueOrThrow({ where: { id } });
}

export async function proposeEvent(input: {
  locationId: string;
  title: string;
  startsOn: string;
  endsOn: string;
  impact: number;
  category?: string;
  rationale?: string;
  source?: string;
  proposedBy?: string;
}) {
  const startsAt = toDbDate(parseIsoDate(input.startsOn));
  const endsAt = toDbDate(parseIsoDate(input.endsOn));
  if (startsAt > endsAt) throw new ValidationError("Bitiş başlangıçtan önce olamaz");
  return prisma.demandEvent.create({
    data: {
      locationId: input.locationId,
      title: input.title.slice(0, 200),
      startsAt,
      endsAt,
      impact: Math.min(10, Math.max(1, Math.round(input.impact))),
      status: "PROPOSED",
      category: input.category,
      rationale: input.rationale?.slice(0, 1000),
      source: input.source,
      proposedBy: input.proposedBy,
    },
  });
}

/** Onay → fiyatlar yeniden hesaplanır (idempotent: tekrar çağrı aynı sonucu verir). */
export async function approveEvent(id: string, adminId: string) {
  const event = await setStatus(id, ["PROPOSED", "APPROVED"], "APPROVED", adminId);
  const repriced = await repriceLocation(event.locationId, windowOf(event));
  await invalidateSearchCache();
  return { event, repriced };
}

export async function applyEvent(id: string) {
  const event = await prisma.demandEvent.findUnique({ where: { id } });
  if (!event) throw new NotFoundError("Olay bulunamadı");
  return repriceLocation(event.locationId, windowOf(event));
}

export async function rejectEvent(id: string) {
  return setStatus(id, ["PROPOSED"], "REJECTED");
}

/** Geri alma: olay devre dışı + pencere onsuz yeniden fiyatlanır + yield hold serbest. */
export async function rollbackEvent(id: string) {
  const event = await setStatus(id, ["APPROVED"], "ROLLED_BACK");
  await releaseYieldHold(id);
  const repriced = await repriceLocation(event.locationId, windowOf(event));
  await invalidateSearchCache();
  return { event, repriced };
}

/**
 * Yield hold: onaylı olay penceresinde her oda tipinin gecelik odalarının en fazla
 * YIELD_HOLD_MAX_SHARE kadarını satıştan geçici olarak çeker. Çekilen birimler
 * `ExternalBlock(source = "yield:<id>")` satırlarıyla izlenir ve `sold`'a sayılır (koşullu
 * sayaç — asla fazla satış yazmaz); `releaseYieldHold` aynı birimleri iade eder.
 */
export async function createYieldHold(id: string, share: number) {
  const cfg = getConfig();
  if (share <= 0 || share > cfg.YIELD_HOLD_MAX_SHARE) {
    throw new ValidationError(`Pay 0 ile ${cfg.YIELD_HOLD_MAX_SHARE} arasında olmalı`);
  }
  const event = await prisma.demandEvent.findUnique({ where: { id } });
  if (!event || event.status !== "APPROVED")
    throw new ConflictError("Yalnızca onaylı olaylar için", "INVALID_STATE");
  const source = `yield:${id}`;
  let held = 0;
  for (const night of windowOf(event)) {
    const date = toDbDate(night);
    const rows = await prisma.inventoryDay.findMany({
      where: { date, roomType: { property: { locationId: event.locationId } } },
      select: { roomTypeId: true, total: true, sold: true, held: true },
      orderBy: { roomTypeId: "asc" },
    });
    for (const row of rows) {
      held += await prisma.$transaction(async (tx) => {
        const existing = await tx.externalBlock.count({
          where: { roomTypeId: row.roomTypeId, source, date },
        });
        const want = Math.min(
          Math.floor(row.total * share) - existing,
          row.total - row.sold - row.held
        );
        if (want <= 0) return 0;
        const updated = await tx.$executeRaw`
          UPDATE "InventoryDay" SET sold = sold + ${want}
          WHERE "roomTypeId" = ${row.roomTypeId} AND date = ${date}
            AND sold + held + ${want} <= total`;
        if (updated !== 1) return 0;
        await tx.externalBlock.createMany({
          data: Array.from({ length: want }, (_, k) => ({
            roomTypeId: row.roomTypeId,
            source,
            uid: `unit-${existing + k + 1}`,
            date,
          })),
        });
        return want;
      });
    }
  }
  return held;
}

export async function releaseYieldHold(id: string): Promise<number> {
  const source = `yield:${id}`;
  return prisma.$transaction(async (tx) => {
    const groups = await tx.externalBlock.groupBy({
      by: ["roomTypeId", "date"],
      where: { source },
      _count: { _all: true },
    });
    let released = 0;
    for (const g of groups) {
      await tx.$executeRaw`
        UPDATE "InventoryDay" SET sold = sold - ${g._count._all}
        WHERE "roomTypeId" = ${g.roomTypeId} AND date = ${g.date} AND sold >= ${g._count._all}`;
      released += g._count._all;
    }
    await tx.externalBlock.deleteMany({ where: { source } });
    return released;
  });
}
