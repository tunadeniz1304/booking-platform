import { createHash, createHmac, timingSafeEqual } from "crypto";
import ical from "ical-generator";
import * as nodeIcal from "node-ical";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import {
  ConflictError,
  NotFoundError,
  ServiceUnavailableError,
  ValidationError,
} from "@/lib/http/errors";
import { MoneyError, assertCurrency, money, parseMoney, toDecimalString } from "@/lib/money/money";
import {
  addDays,
  clockOf,
  fromDate,
  localDateOf,
  nightsBetween,
  todayIn,
  toDbDate,
  type IsoDate,
} from "@/lib/time/nights";
import { invalidatePropertySearchCache } from "@/lib/search";

/**
 * Kanal yöneticisi (P1-9): iCal dışa/içe aktarım ve sıra numaralı ARI mesajları.
 * iCal akışı oda tipi başına imzalı token ile korunur (HMAC, CHANNEL_FEED_SECRET).
 *
 * Sayaçlı envanterde (ADR 0010) harici kanaldan gelen dolu aralıklar BAŞKA KANALDA SATILMIŞ
 * birimlerdir: her (uid, gece) bir `ExternalBlock` satırı olarak izlenir ve `sold`'u artırır.
 * İçe aktarma bir UZLAŞTIRMADIR: kaynakta artık olmayan bloklar serbest bırakılır (`sold−`),
 * yeniler eklenir (`sold+`, yalnızca yer varsa). Tarihler TESİSİN saat diliminde
 * çözümlenir (v3#6): `DATE` değerleri takvim günü, `DATE-TIME` (UTC / TZID) değerleri
 * tesisin yerel gününe çevrilir.
 */

function feedSecret(): string {
  const s = process.env.CHANNEL_FEED_SECRET ?? "";
  if (s.length < 32) throw new ServiceUnavailableError("Takvim akışı yapılandırılmamış");
  return s;
}

/**
 * İmzalı akış tokenı. Sürüm 0 eski biçimi korur (yayınlanmış URL'ler kırılmaz); host tokenı
 * döndürdüğünde (`rotateFeedToken`) sürüm artar ve önceki URL'ler 403 alır (v3#21).
 */
export function feedToken(roomId: string, version = 0): string {
  const payload = version === 0 ? `ical:${roomId}` : `ical:${roomId}:v${version}`;
  return createHmac("sha256", feedSecret()).update(payload).digest("base64url");
}

async function feedVersion(roomId: string): Promise<number> {
  const row = await prisma.channelFeed.findUnique({
    where: { roomTypeId: roomId },
    select: { tokenVersion: true },
  });
  return row?.tokenVersion ?? 0;
}

/** Odanın GÜNCEL akış tokenı. */
export async function currentFeedToken(roomId: string): Promise<string> {
  return feedToken(roomId, await feedVersion(roomId));
}

/** Yalnızca güncel sürümün tokenı geçerlidir (sabit zamanlı karşılaştırma). */
export async function verifyFeedToken(roomId: string, token: string | null): Promise<boolean> {
  if (!token) return false;
  const a = Buffer.from(feedToken(roomId, await feedVersion(roomId)));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Tokenı döndürür: sürümü atomik artırır, yeni tokenı verir; eski URL'ler anında geçersiz. */
export async function rotateFeedToken(roomId: string): Promise<{ token: string; version: number }> {
  const row = await prisma.channelFeed.upsert({
    where: { roomTypeId: roomId },
    create: { roomTypeId: roomId, tokenVersion: 1 },
    update: { tokenVersion: { increment: 1 } },
    select: { tokenVersion: true },
  });
  return { token: feedToken(roomId, row.tokenVersion), version: row.tokenVersion };
}

/** Satılabilir oda kalmamış veya satışa kapalı gelecek geceleri tam gün VEVENT olarak verir. */
export async function exportRoomCalendar(roomId: string): Promise<string> {
  const room = await prisma.roomType.findUnique({
    where: { id: roomId },
    select: { property: { select: { timeZone: true } } },
  });
  if (!room) throw new NotFoundError("Oda bulunamadı");
  const today = toDbDate(todayIn(clockOf(room.property).timeZone));
  const [days, closed] = await Promise.all([
    prisma.$queryRaw<Array<{ date: Date }>>`
      SELECT date FROM "InventoryDay"
      WHERE "roomTypeId" = ${roomId} AND date >= ${today} AND sold + held >= total
      ORDER BY date`,
    prisma.restriction.findMany({
      where: { roomTypeId: roomId, stopSell: true, date: { gte: today } },
      select: { date: true },
    }),
  ]);
  const nights = [...new Set([...days, ...closed].map((r) => fromDate(r.date)))].sort();
  const cal = ical({
    name: `booking-platform oda ${roomId}`,
    prodId: { company: "booking-platform", product: "channel-manager" },
  });
  for (const night of nights) {
    const start = toDbDate(night);
    cal.createEvent({
      id: `${roomId}-${night}@booking-platform`,
      start,
      end: new Date(start.getTime() + 86_400_000),
      allDay: true,
      summary: "Dolu",
    });
  }
  return cal.toString();
}

export interface IcsNight {
  uid: string;
  date: IsoDate;
}

function dateOnlyToIso(d: Date): IsoDate {
  // node-ical DATE değerlerini yerel gece yarısı olarak kurar → yerel bileşenler doğru gündür.
  return fromDate(new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())));
}

/**
 * iCal metnini tesisin saat diliminde (uid, gece) çiftlerine çevirir. Saf fonksiyon.
 * `[DTSTART, DTEND)` yarı açıktır; DTEND yoksa tek gece.
 */
export function parseIcsNights(icsText: string, timeZone: string): IcsNight[] {
  const parsed = nodeIcal.sync.parseICS(icsText);
  const out = new Map<string, IcsNight>();
  for (const [key, item] of Object.entries(parsed)) {
    if (!item || item.type !== "VEVENT") continue;
    const ev = item as nodeIcal.VEvent;
    if (!ev.start) continue;
    const dateOnly =
      ev.datetype === "date" || (ev.start as nodeIcal.DateWithTimeZone).dateOnly === true;
    const toIso = (d: Date) => (dateOnly ? dateOnlyToIso(d) : localDateOf(d, timeZone));
    const start = toIso(ev.start);
    const end = ev.end ? toIso(ev.end) : addDays(start, 1);
    const uid =
      (typeof ev.uid === "string" && ev.uid) ||
      createHash("sha1").update(`${key}|${start}`).digest("hex").slice(0, 16);
    const nights = nightsBetween(start, end > start ? end : addDays(start, 1));
    for (const date of nights) out.set(`${uid}|${date}`, { uid: uid.slice(0, 200), date });
  }
  return [...out.values()];
}

export interface ImportResult {
  nights: number;
  added: number;
  removed: number;
  /** Yer olmadığı için (zaten dolu) işlenemeyen geceler — host'a çakışma uyarısı. */
  conflicts: IsoDate[];
}

/**
 * Harici takvimi `source` için uzlaştırır: yeni bloklar `sold`'a eklenir, kaynaktan kalkan
 * bloklar serbest bırakılır. Geçmiş geceler yok sayılır. Tek işlemde; idempotent.
 */
export async function importCalendar(
  roomId: string,
  icsText: string,
  source: string
): Promise<ImportResult> {
  const room = await prisma.roomType.findUnique({
    where: { id: roomId },
    select: { propertyId: true, property: { select: { timeZone: true } } },
  });
  if (!room) throw new NotFoundError("Oda bulunamadı");
  const tz = clockOf(room.property).timeZone;
  const today = todayIn(tz);
  const src = `ical:${source.slice(0, 40)}`;
  const wanted = parseIcsNights(icsText, tz).filter((n) => n.date >= today);

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.externalBlock.findMany({
      where: { roomTypeId: roomId, source: src, date: { gte: toDbDate(today) } },
      select: { id: true, uid: true, date: true },
    });
    const key = (uid: string, date: IsoDate) => `${uid}|${date}`;
    const have = new Map(existing.map((b) => [key(b.uid, fromDate(b.date)), b]));
    const want = new Set(wanted.map((n) => key(n.uid, n.date)));

    let removed = 0;
    for (const [k, block] of have) {
      if (want.has(k)) continue;
      await tx.$executeRaw`
        UPDATE "InventoryDay" SET sold = sold - 1
        WHERE "roomTypeId" = ${roomId} AND date = ${block.date} AND sold >= 1`;
      await tx.externalBlock.delete({ where: { id: block.id } });
      removed += 1;
    }
    let added = 0;
    const conflicts: IsoDate[] = [];
    for (const night of wanted) {
      if (have.has(key(night.uid, night.date))) continue;
      const date = toDbDate(night.date);
      const updated = await tx.$executeRaw`
        UPDATE "InventoryDay" SET sold = sold + 1
        WHERE "roomTypeId" = ${roomId} AND date = ${date} AND sold + held + 1 <= total`;
      if (updated !== 1) {
        conflicts.push(night.date);
        continue;
      }
      await tx.externalBlock.create({
        data: { roomTypeId: roomId, source: src, uid: night.uid, date },
      });
      added += 1;
    }
    return { nights: wanted.length, added, removed, conflicts };
  });
  if (result.added + result.removed > 0) await invalidatePropertySearchCache(room.propertyId);
  return result;
}

/**
 * `InventoryDay.price` kolonunun (Decimal(10,2)) taşıyabildiği en büyük tutar (minor-unit);
 * iş eşiği değil, şema sınırı.
 */
const ARI_PRICE_MAX_MINOR = 9_999_999_999;

/**
 * ARI gece güncellemesi (v4#19): fiyat float DEĞİL — ya ondalık string (`price: "1234.50"`,
 * mülkün para biriminde) ya da minor-unit tamsayı (`priceMinor: 123450`); ikisi birden olmaz.
 */
export const ariUpdateSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    price: z
      .string()
      .trim()
      .regex(/^\d{1,12}(\.\d{1,4})?$/, 'Fiyat ondalık string olmalı (ör. "1234.50")')
      .optional(),
    priceMinor: z.number().int().positive().max(ARI_PRICE_MAX_MINOR).optional(),
    available: z.boolean().optional(),
  })
  .strict()
  .refine((u) => !(u.price !== undefined && u.priceMinor !== undefined), {
    message: "price ve priceMinor birlikte verilemez",
  })
  .refine((u) => u.price !== undefined || u.priceMinor !== undefined || u.available !== undefined, {
    message: "En az bir alan (price, priceMinor, available) gerekli",
  });

export type AriUpdate = z.input<typeof ariUpdateSchema>;

export const ariMessageSchema = z.object({
  roomId: z.string().min(1).max(64),
  sequence: z.number().int().nonnegative(),
  idempotencyKey: z.string().min(1).max(128),
  updates: z.array(ariUpdateSchema).min(1).max(366),
});

export type AriMessage = z.input<typeof ariMessageSchema>;

/** Gece fiyatı → minor-unit; para birimi basamağına uymayan tutar 400. */
function ariPriceMinor(u: z.output<typeof ariUpdateSchema>, currency: string): number | null {
  if (u.priceMinor !== undefined) return u.priceMinor;
  if (u.price === undefined) return null;
  try {
    const minor = parseMoney(u.price, currency).amount;
    if (minor <= 0 || minor > ARI_PRICE_MAX_MINOR) throw new MoneyError("Fiyat aralık dışında");
    return minor;
  } catch (error) {
    if (error instanceof MoneyError) {
      throw new ValidationError(`Geçersiz fiyat (${u.date}): ${error.message}`);
    }
    throw error;
  }
}

export class StaleSequenceError extends ConflictError {
  constructor(last: number) {
    super(`Eski sıra numarası (son uygulanan: ${last})`, "STALE_SEQUENCE");
  }
}

/**
 * ARI mesajı: aynı idempotency anahtarı → tek etki ("duplicate"); daha küçük/eşit sıra
 * numarası reddedilir. Fiyat gece satırına, `available` satış durdurma kısıtına yazılır;
 * mevcut rezervasyonlar (sayaçlar) hiçbir koşulda değişmez. Tek işlemde.
 */
export async function applyAriMessage(input: AriMessage) {
  const parsed = ariMessageSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError("Geçersiz ARI mesajı", parsed.error.flatten());
  }
  const msg = parsed.data;
  const room = await prisma.roomType.findUnique({
    where: { id: msg.roomId },
    select: { propertyId: true, property: { select: { currency: true } } },
  });
  if (!room) throw new NotFoundError("Oda bulunamadı");
  const currency = assertCurrency(room.property.currency);
  // Tüm fiyatlar işlemden ÖNCE doğrulanır: tek geçersiz gece → hiçbir şey yazılmaz.
  const prices = msg.updates.map((u) => ariPriceMinor(u, currency));

  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`INSERT INTO "ChannelSequence" ("roomId", "lastSequence", "updatedAt") VALUES (${msg.roomId}, 0, now()) ON CONFLICT DO NOTHING`;
    const [seq] = await tx.$queryRaw<Array<{ lastSequence: number; lastKey: string | null }>>`
      SELECT "lastSequence", "lastKey" FROM "ChannelSequence" WHERE "roomId" = ${msg.roomId} FOR UPDATE`;
    if (seq.lastKey === msg.idempotencyKey) return { status: "duplicate" as const, applied: 0 };
    if (msg.sequence <= seq.lastSequence) throw new StaleSequenceError(seq.lastSequence);
    let applied = 0;
    for (const [i, u] of msg.updates.entries()) {
      const date = toDbDate(u.date as IsoDate);
      const priceMinor = prices[i];
      if (priceMinor !== null) {
        const r = await tx.inventoryDay.updateMany({
          where: { roomTypeId: msg.roomId, date },
          data: { price: new Prisma.Decimal(toDecimalString(money(priceMinor, currency))) },
        });
        applied += r.count;
      }
      if (u.available !== undefined) {
        await tx.restriction.upsert({
          where: { roomTypeId_date: { roomTypeId: msg.roomId, date } },
          update: { stopSell: !u.available },
          create: { roomTypeId: msg.roomId, date, stopSell: !u.available },
        });
        if (priceMinor === null) applied += 1;
      }
    }
    await tx.channelSequence.update({
      where: { roomId: msg.roomId },
      data: { lastSequence: msg.sequence, lastKey: msg.idempotencyKey },
    });
    return { status: "applied" as const, applied };
  });
  if (result.status === "applied") await invalidatePropertySearchCache(room.propertyId);
  return result;
}

export interface ParityRate {
  date: IsoDate;
  /** Minor-unit. */
  amount: number;
}

export interface ParityWarning {
  date: IsoDate;
  ours: number;
  theirs: number;
  /** (harici − bizim) / bizim, baz puan. */
  diffBps: number;
  direction: "cheaper_elsewhere" | "pricier_elsewhere";
}

/**
 * Parite kontrolü (P1-9): YALNIZCA host'a uyarı üretir. DMA gereği fiyat eşitliği
 * zorlanmaz; bu fonksiyon hiçbir fiyatı değiştirmez. Saf fonksiyon.
 */
export function checkRateParity(
  ours: readonly ParityRate[],
  theirs: readonly ParityRate[],
  toleranceBps: number
): ParityWarning[] {
  const mine = new Map(ours.map((r) => [r.date, r.amount]));
  const out: ParityWarning[] = [];
  for (const t of theirs) {
    const o = mine.get(t.date);
    if (o === undefined || o <= 0) continue;
    const diffBps = Math.round(((t.amount - o) * 10_000) / o);
    if (Math.abs(diffBps) <= toleranceBps) continue;
    out.push({
      date: t.date,
      ours: o,
      theirs: t.amount,
      diffBps,
      direction: diffBps < 0 ? "cheaper_elsewhere" : "pricier_elsewhere",
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
