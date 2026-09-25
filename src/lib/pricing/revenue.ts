import "server-only";
import { Prisma, type PriceSuggestion } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getConfig } from "@/lib/config/app-config";
import { ConflictError, NotFoundError } from "@/lib/http/errors";
import { getLlmClient } from "@/lib/llm/client";
import { assertNumbersGrounded, buildFactSet } from "@/lib/llm/guards";
import { logger } from "@/lib/observability/logger";
import { money, toDecimalString, toMinor } from "@/lib/money/money";
import { addDays, diffDays, fromDate, toDbDate, todayIn, type IsoDate } from "@/lib/time/nights";
import { assertPropertyAccess, assertRoomAccess } from "@/lib/host/host-service";
import { invalidatePriceCache } from "@/lib/pricing-service";
import { invalidatePropertySearchCache } from "@/lib/search";
import type { AccessClaims } from "@/lib/auth";
import {
  demoRevenueExplanation,
  majorString,
  suggestPrice,
  type Contribution,
  type Suggestion,
} from "./revenue-engine";
import { trHolidayOn } from "./tr-holidays";

/**
 * Host gelir paneli (P1-5): KPI'lar (doluluk, ADR, RevPAR), pickup serisi ve fiyat önerileri.
 *
 * - Öneri motoru saftır (`revenue-engine.ts`); öneri her zaman [taban, tavan] içindedir.
 * - LLM yalnızca Türkçe açıklama cümlesini yazar; sayılar olgu kümesine bağlı olmak zorundadır,
 *   aksi hâlde deterministik demo cümlesine düşülür.
 * - Kabul → `InventoryDay.price` + `priceOverride=true` (motor artık bu geceyi ezmez);
 *   ret → yalnız öneri durumu değişir, hiçbir fiyat değişmez.
 * - Tüm uçlar sahiplik kontrollüdür (başkasının mülkü/odası 404).
 */

export const generateSchema = z.object({ roomId: z.string().min(1).max(64) });

const REVENUE_STATUSES = ["CONFIRMED", "COMPLETED"] as const;

export interface RevenueKpis {
  currency: string;
  from: IsoDate;
  to: IsoDate;
  availableRoomNights: number;
  soldRoomNights: number;
  revenueMinor: number;
  /** 0..1 */
  occupancy: number;
  adrMinor: number;
  revparMinor: number;
}

export interface PickupPoint {
  date: IsoDate;
  /** O gün girilen (pencereye düşen) oda-gece. */
  pickup: number;
  /** Gün sonunda penceredeki toplam oda-gece. */
  onBooks: number;
}

export interface SuggestionView {
  id: string;
  roomId: string;
  roomName: string;
  date: IsoDate;
  currency: string;
  currentMinor: number;
  suggestedMinor: number;
  floorMinor: number;
  ceilingMinor: number;
  contributions: Contribution[];
  explanation: string;
  llmMode: string;
  status: PriceSuggestion["status"];
}

function overlapNights(checkIn: IsoDate, checkOut: IsoDate, from: IsoDate, to: IsoDate): number {
  const start = checkIn > from ? checkIn : from;
  const end = checkOut < to ? checkOut : to;
  return Math.max(0, diffDays(start, end));
}

/** Saf KPI hesabı (test edilebilir): rezervasyon başına gelir, pencereye düşen gece oranında. */
export function computeKpis(input: {
  currency: string;
  from: IsoDate;
  to: IsoDate;
  availableRoomNights: number;
  bookings: ReadonlyArray<{ checkIn: IsoDate; checkOut: IsoDate; totalMinor: number }>;
}): RevenueKpis {
  let sold = 0;
  let revenue = 0;
  for (const b of input.bookings) {
    const nights = diffDays(b.checkIn, b.checkOut);
    const inWindow = overlapNights(b.checkIn, b.checkOut, input.from, input.to);
    if (nights <= 0 || inWindow === 0) continue;
    sold += inWindow;
    revenue += Math.round((b.totalMinor * inWindow) / nights);
  }
  const available = Math.max(0, input.availableRoomNights);
  return {
    currency: input.currency,
    from: input.from,
    to: input.to,
    availableRoomNights: available,
    soldRoomNights: sold,
    revenueMinor: revenue,
    occupancy: available > 0 ? Math.min(1, sold / available) : 0,
    adrMinor: sold > 0 ? Math.round(revenue / sold) : 0,
    revparMinor: available > 0 ? Math.round(revenue / available) : 0,
  };
}

/** Saf pickup serisi: son `days` günde girilen rezervasyonların penceredeki oda-geceleri. */
export function computePickup(input: {
  today: IsoDate;
  days: number;
  from: IsoDate;
  to: IsoDate;
  bookings: ReadonlyArray<{ checkIn: IsoDate; checkOut: IsoDate; createdOn: IsoDate }>;
}): PickupPoint[] {
  const start = addDays(input.today, -(input.days - 1));
  const perDay = new Map<string, number>();
  let onBooks = 0;
  for (const b of input.bookings) {
    const n = overlapNights(b.checkIn, b.checkOut, input.from, input.to);
    if (n === 0) continue;
    if (b.createdOn < start) onBooks += n;
    else if (b.createdOn <= input.today) {
      perDay.set(b.createdOn, (perDay.get(b.createdOn) ?? 0) + n);
    }
  }
  const out: PickupPoint[] = [];
  for (let i = 0; i < input.days; i++) {
    const date = addDays(start, i);
    const pickup = perDay.get(date) ?? 0;
    onBooks += pickup;
    out.push({ date, pickup, onBooks });
  }
  return out;
}

function toView(s: PriceSuggestion & { roomType: { name: string } }): SuggestionView {
  return {
    id: s.id,
    roomId: s.roomTypeId,
    roomName: s.roomType.name,
    date: fromDate(s.date),
    currency: s.currency,
    currentMinor: s.currentMinor,
    suggestedMinor: s.suggestedMinor,
    floorMinor: s.floorMinor,
    ceilingMinor: s.ceilingMinor,
    contributions: s.contributions as unknown as Contribution[],
    explanation: s.explanation,
    llmMode: s.llmMode,
    status: s.status,
  };
}

/** Mülk özeti: KPI + pickup + bekleyen öneriler. */
export async function getRevenueOverview(
  actor: AccessClaims,
  propertyId: string,
  now: Date = new Date()
) {
  await assertPropertyAccess(actor, propertyId);
  const cfg = getConfig();
  const property = await prisma.property.findUniqueOrThrow({
    where: { id: propertyId },
    select: {
      id: true,
      title: true,
      currency: true,
      timeZone: true,
      rooms: { select: { id: true, name: true }, orderBy: { name: "asc" } },
    },
  });
  const today = todayIn(property.timeZone, now);
  const from = today;
  const to = addDays(today, cfg.REVENUE_WINDOW_DAYS);
  const roomIds = property.rooms.map((r) => r.id);

  const [capacity, bookings, pending] = await Promise.all([
    prisma.inventoryDay.aggregate({
      where: { roomTypeId: { in: roomIds }, date: { gte: toDbDate(from), lt: toDbDate(to) } },
      _sum: { total: true },
    }),
    prisma.booking.findMany({
      where: {
        propertyId,
        status: { in: [...REVENUE_STATUSES] },
        checkIn: { lt: toDbDate(to) },
        checkOut: { gt: toDbDate(from) },
      },
      select: { checkIn: true, checkOut: true, totalPrice: true, currency: true, createdAt: true },
    }),
    prisma.priceSuggestion.findMany({
      where: { roomTypeId: { in: roomIds }, status: "PENDING", date: { gte: toDbDate(today) } },
      include: { roomType: { select: { name: true } } },
      orderBy: [{ date: "asc" }, { roomTypeId: "asc" }],
    }),
  ]);

  // Gelir tesis para biriminde raporlanır; farklı para birimli kayıt (FX) KPI'ya katılmaz.
  const sameCurrency = bookings.filter((b) => b.currency === property.currency);
  if (sameCurrency.length !== bookings.length) {
    logger.warn(
      { propertyId, skipped: bookings.length - sameCurrency.length },
      "Gelir KPI: farklı para birimli rezervasyonlar hariç tutuldu"
    );
  }
  const stays = sameCurrency.map((b) => ({
    checkIn: fromDate(b.checkIn),
    checkOut: fromDate(b.checkOut),
    totalMinor: toMinor(b.totalPrice.toString(), b.currency),
    createdOn: fromDate(b.createdAt),
  }));

  return {
    property: { id: property.id, title: property.title, currency: property.currency },
    rooms: property.rooms,
    kpis: computeKpis({
      currency: property.currency,
      from,
      to,
      availableRoomNights: capacity._sum.total ?? 0,
      bookings: stays,
    }),
    pickup: computePickup({ today, days: cfg.REVENUE_PICKUP_DAYS, from, to, bookings: stays }),
    suggestions: pending.map(toView),
  };
}

/** LLM yalnızca açıklama cümlesini yazar; sayı guard'ı geçmezse demo cümlesi. */
async function explainSuggestion(input: {
  date: IsoDate;
  currency: string;
  currentMinor: number;
  suggestion: Suggestion;
  occupancy: number;
  leadDays: number;
  holiday: string | null;
  events: ReadonlyArray<{ title: string; impact: number }>;
}): Promise<{ text: string; llmMode: string }> {
  const s = input.suggestion;
  const facts = {
    date: input.date,
    currency: input.currency,
    current: majorString(input.currentMinor),
    suggested: majorString(s.suggestedMinor),
    base: majorString(s.baseMinor),
    floor: majorString(s.floorMinor),
    ceiling: majorString(s.ceilingMinor),
    occupancyPercent: Math.round(input.occupancy * 100),
    leadDays: input.leadDays,
    holiday: input.holiday,
    events: input.events,
    contributions: s.contributions.map((c) => ({
      factor: c.factor,
      label: c.label,
      multiplier: c.multiplier,
      amount: majorString(c.amountMinor),
    })),
  };
  const factSet = buildFactSet([JSON.stringify(facts), input.events.length]);
  const demo = () =>
    demoRevenueExplanation({
      date: input.date,
      currency: input.currency,
      currentMinor: input.currentMinor,
      suggestion: s,
      occupancy: input.occupancy,
      leadDays: input.leadDays,
      holiday: input.holiday,
      eventCount: input.events.length,
    });
  const res = await getLlmClient().completeText(
    "revenue_explain",
    [
      {
        role: "system",
        content:
          "Ev sahibine fiyat önerisini TEK Türkçe cümleyle açıkla. Öneriyi değiştirme, yeni sayı uydurma; yalnızca verilen olgulardaki sayıları kullan. Karar ev sahibine aittir.",
      },
      { role: "user", content: JSON.stringify(facts) },
    ],
    {
      demo,
      maxTokens: 160,
      validate: (text) => {
        assertNumbersGrounded(text, factSet);
        return text.trim();
      },
    }
  );
  return { text: res.data, llmMode: res.llmMode };
}

/** Odanın önümüzdeki gecelerine öneri üretir; aynı aralıktaki eski bekleyen öneriler silinir. */
export async function generateSuggestions(
  actor: AccessClaims,
  roomId: string,
  now: Date = new Date()
): Promise<SuggestionView[]> {
  await assertRoomAccess(actor, roomId);
  const cfg = getConfig();
  const room = await prisma.roomType.findUniqueOrThrow({
    where: { id: roomId },
    select: {
      id: true,
      name: true,
      property: {
        select: { basePrice: true, currency: true, locationId: true, timeZone: true },
      },
    },
  });
  const { currency, timeZone, locationId } = room.property;
  const today = todayIn(timeZone, now);
  const first = addDays(today, 1);
  const last = addDays(today, cfg.REVENUE_SUGGESTION_DAYS);
  const baseMinor = toMinor(room.property.basePrice.toString(), currency);

  const [rows, events] = await Promise.all([
    prisma.inventoryDay.findMany({
      where: { roomTypeId: roomId, date: { gte: toDbDate(first), lte: toDbDate(last) } },
      select: { date: true, total: true, sold: true, held: true, price: true },
      orderBy: { date: "asc" },
    }),
    prisma.demandEvent.findMany({
      where: {
        locationId,
        status: "APPROVED",
        startsAt: { lte: toDbDate(last) },
        endsAt: { gte: toDbDate(first) },
      },
      select: { title: true, impact: true, startsAt: true, endsAt: true },
    }),
  ]);

  const drafts = await Promise.all(
    rows
      .filter((row) => row.total > 0)
      .map(async (row) => {
        const date = fromDate(row.date);
        const occupancy = Math.min(1, (row.sold + row.held) / row.total);
        const leadDays = diffDays(today, date);
        const holiday = trHolidayOn(date);
        const active = events
          .filter((e) => fromDate(e.startsAt) <= date && date <= fromDate(e.endsAt))
          .map((e) => ({ title: e.title, impact: e.impact }));
        const suggestion = suggestPrice({
          baseMinor,
          occupancy,
          leadDays,
          holiday,
          events: active,
        });
        const currentMinor = toMinor(row.price.toString(), currency);
        const explained = await explainSuggestion({
          date,
          currency,
          currentMinor,
          suggestion,
          occupancy,
          leadDays,
          holiday,
          events: active,
        });
        return { date, currentMinor, suggestion, explained };
      })
  );

  const created = await prisma.$transaction(async (tx) => {
    await tx.priceSuggestion.deleteMany({
      where: {
        roomTypeId: roomId,
        status: "PENDING",
        date: { gte: toDbDate(first), lte: toDbDate(last) },
      },
    });
    const out: Array<PriceSuggestion & { roomType: { name: string } }> = [];
    for (const d of drafts) {
      out.push(
        await tx.priceSuggestion.create({
          data: {
            roomTypeId: roomId,
            date: toDbDate(d.date),
            currency,
            currentMinor: d.currentMinor,
            suggestedMinor: d.suggestion.suggestedMinor,
            floorMinor: d.suggestion.floorMinor,
            ceilingMinor: d.suggestion.ceilingMinor,
            contributions: d.suggestion.contributions as unknown as Prisma.InputJsonValue,
            explanation: d.explained.text,
            llmMode: d.explained.llmMode,
          },
          include: { roomType: { select: { name: true } } },
        })
      );
    }
    return out;
  });
  logger.info({ roomId, count: created.length }, "Gelir önerileri üretildi");
  return created.map(toView);
}

async function loadOwnedSuggestion(actor: AccessClaims, id: string) {
  const suggestion = await prisma.priceSuggestion.findUnique({ where: { id } });
  if (!suggestion) throw new NotFoundError("Öneri bulunamadı");
  // Başkasının odası: assertRoomAccess 404 döner (varlık sızdırılmaz).
  const room = await assertRoomAccess(actor, suggestion.roomTypeId);
  return { suggestion, propertyId: room.propertyId };
}

function alreadyDecided(): ConflictError {
  return new ConflictError("Öneri zaten karara bağlanmış", "INVALID_STATE");
}

/** Kabul: fiyatı yazar ve geceyi sabitler (motor artık ezmez). */
export async function acceptSuggestion(actor: AccessClaims, id: string): Promise<SuggestionView> {
  const { suggestion, propertyId } = await loadOwnedSuggestion(actor, id);
  const price = new Prisma.Decimal(
    toDecimalString(money(suggestion.suggestedMinor, suggestion.currency))
  );
  await prisma.$transaction(async (tx) => {
    const res = await tx.priceSuggestion.updateMany({
      where: { id, status: "PENDING" },
      data: { status: "ACCEPTED", decidedBy: actor.userId, decidedAt: new Date() },
    });
    if (res.count !== 1) throw alreadyDecided();
    const day = await tx.inventoryDay.updateMany({
      where: { roomTypeId: suggestion.roomTypeId, date: suggestion.date },
      data: {
        price,
        priceOverride: true,
        priceExplanation: {
          source: "host_override",
          suggestionId: id,
          currency: suggestion.currency,
          price: suggestion.suggestedMinor,
          previous: suggestion.currentMinor,
          contributions: suggestion.contributions,
        } as Prisma.InputJsonValue,
      },
    });
    if (day.count !== 1) throw new NotFoundError("Gece envanteri bulunamadı");
  });
  const date = fromDate(suggestion.date);
  await invalidatePriceCache(suggestion.roomTypeId, date);
  await invalidatePropertySearchCache(propertyId);
  logger.info(
    { suggestionId: id, roomId: suggestion.roomTypeId, date },
    "Fiyat önerisi kabul edildi"
  );
  return toView(
    await prisma.priceSuggestion.findUniqueOrThrow({
      where: { id },
      include: { roomType: { select: { name: true } } },
    })
  );
}

/** Ret: yalnızca öneri durumu değişir; hiçbir fiyat yazılmaz. */
export async function rejectSuggestion(actor: AccessClaims, id: string): Promise<SuggestionView> {
  await loadOwnedSuggestion(actor, id);
  const res = await prisma.priceSuggestion.updateMany({
    where: { id, status: "PENDING" },
    data: { status: "REJECTED", decidedBy: actor.userId, decidedAt: new Date() },
  });
  if (res.count !== 1) throw alreadyDecided();
  return toView(
    await prisma.priceSuggestion.findUniqueOrThrow({
      where: { id },
      include: { roomType: { select: { name: true } } },
    })
  );
}
