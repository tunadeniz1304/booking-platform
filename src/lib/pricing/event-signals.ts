import { Prisma, type DemandEventStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getConfig } from "@/lib/config/app-config";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/http/errors";
import { getSeasonalFactor, getWeekdayFactor } from "./engine";
import { money, multiplyRate, toDecimalString, toMinor, assertCurrency } from "@/lib/money/money";
import {
  addDays,
  fromDate,
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
 */

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

function windowOf(event: { startsAt: Date; endsAt: Date }): IsoDate[] {
  // Etki penceresi: olaydan bir gece önce → bittiği geceyi de kapsayacak şekilde
  return nightsBetween(addDays(fromDate(event.startsAt), -1), addDays(fromDate(event.endsAt), 2));
}

/** Konumdaki geceleri onaylı TÜM olaylara göre orijinal tabandan yeniden fiyatlar. */
export async function repriceLocation(locationId: string, nights: IsoDate[]): Promise<number> {
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
    const rows = await tx.availability.findMany({
      where: {
        date: { gte: first, lte: last },
        isAvailable: true,
        lockedBy: null,
        room: { property: { locationId, isActive: true }, available: true },
      },
      select: {
        id: true,
        date: true,
        room: { select: { property: { select: { basePrice: true, currency: true } } } },
      },
    });
    if (rows.length === 0) return 0;
    const values = rows.map((row) => {
      const date = fromDate(row.date);
      const active = events
        .filter((e) => windowOf(e).includes(date))
        .map((e) => ({ id: e.id, title: e.title, impact: e.impact }));
      const currency = row.room.property.currency;
      const exp = explainNightPrice({
        date,
        baseMinor: toMinor(row.room.property.basePrice.toString(), currency),
        currency,
        events: active,
      });
      return Prisma.sql`(${row.id}, ${toDecimalString(money(exp.price, currency))}::numeric, ${JSON.stringify(exp)}::jsonb)`;
    });
    const updated = await tx.$executeRaw`
      UPDATE "Availability" AS a
      SET price = v.price, "priceExplanation" = v.explanation
      FROM (VALUES ${Prisma.join(values)}) AS v(id, price, explanation)
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
 * Yield hold: onaylı olay penceresinde gece başına oda payının en fazla
 * YIELD_HOLD_MAX_SHARE kadarını satıştan geçici olarak çeker (`lockedBy=yield:<id>`).
 */
export async function createYieldHold(id: string, share: number) {
  const cfg = getConfig();
  if (share <= 0 || share > cfg.YIELD_HOLD_MAX_SHARE) {
    throw new ValidationError(`Pay 0 ile ${cfg.YIELD_HOLD_MAX_SHARE} arasında olmalı`);
  }
  const event = await prisma.demandEvent.findUnique({ where: { id } });
  if (!event || event.status !== "APPROVED")
    throw new ConflictError("Yalnızca onaylı olaylar için", "INVALID_STATE");
  let held = 0;
  for (const night of windowOf(event)) {
    const rows = await prisma.availability.findMany({
      where: { date: toDbDate(night), room: { property: { locationId: event.locationId } } },
      select: { id: true, isAvailable: true, lockedBy: true },
      orderBy: { id: "asc" },
    });
    const quota =
      Math.floor(rows.length * share) - rows.filter((r) => r.lockedBy === `yield:${id}`).length;
    const free = rows.filter((r) => r.isAvailable && !r.lockedBy).slice(0, Math.max(0, quota));
    if (free.length > 0) {
      const res = await prisma.availability.updateMany({
        where: { id: { in: free.map((r) => r.id) }, isAvailable: true, lockedBy: null },
        data: { isAvailable: false, lockedBy: `yield:${id}` },
      });
      held += res.count;
    }
  }
  return held;
}

export async function releaseYieldHold(id: string): Promise<number> {
  const res = await prisma.availability.updateMany({
    where: { lockedBy: `yield:${id}` },
    data: { isAvailable: true, lockedBy: null },
  });
  return res.count;
}
