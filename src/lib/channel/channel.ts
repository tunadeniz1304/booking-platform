import { createHash, createHmac, timingSafeEqual } from "crypto";
import ical from "ical-generator";
import * as nodeIcal from "node-ical";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ConflictError, NotFoundError, ServiceUnavailableError } from "@/lib/http/errors";
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

export function feedToken(roomId: string): string {
  return createHmac("sha256", feedSecret()).update(`ical:${roomId}`).digest("base64url");
}

export function verifyFeedToken(roomId: string, token: string | null): boolean {
  if (!token) return false;
  const a = Buffer.from(feedToken(roomId));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
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

export interface AriUpdate {
  date: string;
  price?: number;
  available?: boolean;
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
export async function applyAriMessage(msg: {
  roomId: string;
  sequence: number;
  idempotencyKey: string;
  updates: AriUpdate[];
}) {
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`INSERT INTO "ChannelSequence" ("roomId", "lastSequence", "updatedAt") VALUES (${msg.roomId}, 0, now()) ON CONFLICT DO NOTHING`;
    const [seq] = await tx.$queryRaw<Array<{ lastSequence: number; lastKey: string | null }>>`
      SELECT "lastSequence", "lastKey" FROM "ChannelSequence" WHERE "roomId" = ${msg.roomId} FOR UPDATE`;
    if (seq.lastKey === msg.idempotencyKey) return { status: "duplicate" as const, applied: 0 };
    if (msg.sequence <= seq.lastSequence) throw new StaleSequenceError(seq.lastSequence);
    let applied = 0;
    for (const u of msg.updates) {
      const date = toDbDate(u.date as IsoDate);
      if (u.price !== undefined) {
        const r = await tx.inventoryDay.updateMany({
          where: { roomTypeId: msg.roomId, date },
          data: { price: new Prisma.Decimal(u.price) },
        });
        applied += r.count;
      }
      if (u.available !== undefined) {
        await tx.restriction.upsert({
          where: { roomTypeId_date: { roomTypeId: msg.roomId, date } },
          update: { stopSell: !u.available },
          create: { roomTypeId: msg.roomId, date, stopSell: !u.available },
        });
        if (u.price === undefined) applied += 1;
      }
    }
    await tx.channelSequence.update({
      where: { roomId: msg.roomId },
      data: { lastSequence: msg.sequence, lastKey: msg.idempotencyKey },
    });
    return { status: "applied" as const, applied };
  });
  if (result.status === "applied") {
    const room = await prisma.roomType.findUnique({
      where: { id: msg.roomId },
      select: { propertyId: true },
    });
    if (room) await invalidatePropertySearchCache(room.propertyId);
  }
  return result;
}
