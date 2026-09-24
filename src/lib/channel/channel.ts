import { createHmac, timingSafeEqual } from "crypto";
import ical from "ical-generator";
import * as nodeIcal from "node-ical";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ConflictError, ServiceUnavailableError } from "@/lib/http/errors";
import { fromDate, nightsBetween, toDbDate, type IsoDate } from "@/lib/time/nights";

/**
 * Kanal simülatörü (P1-9): iCal dışa/içe aktarım ve sıra numaralı ARI mesajları.
 * iCal akışı oda başına imzalı token ile korunur (HMAC, CHANNEL_FEED_SECRET).
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

/** Dolu/kapalı geceleri tam gün VEVENT olarak dışa aktarır (kişisel veri içermez). */
export async function exportRoomCalendar(roomId: string): Promise<string> {
  const rows = await prisma.availability.findMany({
    where: { roomId, isAvailable: false, date: { gte: toDbDate(fromDate(new Date())) } },
    orderBy: { date: "asc" },
    select: { date: true },
  });
  const cal = ical({
    name: `booking-platform oda ${roomId}`,
    prodId: { company: "booking-platform", product: "channel-sim" },
  });
  for (const r of rows) {
    const start = r.date;
    cal.createEvent({
      id: `${roomId}-${fromDate(start)}@booking-platform`,
      start,
      end: new Date(start.getTime() + 86_400_000),
      allDay: true,
      summary: "Dolu",
    });
  }
  return cal.toString();
}

/** Harici takvimdeki dolu aralıkları boş gecelere `ical:<source>` kilidi olarak uygular. */
export async function importCalendar(roomId: string, icsText: string, source: string) {
  const parsed = nodeIcal.sync.parseICS(icsText);
  const nights = new Set<IsoDate>();
  for (const item of Object.values(parsed)) {
    if (!item || item.type !== "VEVENT") continue;
    const ev = item as nodeIcal.VEvent;
    const start = fromDate(
      new Date(Date.UTC(ev.start.getFullYear(), ev.start.getMonth(), ev.start.getDate()))
    );
    const endRaw = ev.end ?? new Date(ev.start.getTime() + 86_400_000);
    const end = fromDate(
      new Date(Date.UTC(endRaw.getFullYear(), endRaw.getMonth(), endRaw.getDate()))
    );
    for (const n of nightsBetween(start, end)) nights.add(n);
  }
  const res = await prisma.availability.updateMany({
    where: { roomId, date: { in: [...nights].map(toDbDate) }, isAvailable: true, lockedBy: null },
    data: { isAvailable: false, lockedBy: `ical:${source.slice(0, 40)}` },
  });
  return { nights: nights.size, blocked: res.count };
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
 * numarası reddedilir. Rezervasyonlu geceler ezilmez. Tek işlemde.
 */
export async function applyAriMessage(msg: {
  roomId: string;
  sequence: number;
  idempotencyKey: string;
  updates: AriUpdate[];
}) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`INSERT INTO "ChannelSequence" ("roomId", "lastSequence", "updatedAt") VALUES (${msg.roomId}, 0, now()) ON CONFLICT DO NOTHING`;
    const [seq] = await tx.$queryRaw<Array<{ lastSequence: number; lastKey: string | null }>>`
      SELECT "lastSequence", "lastKey" FROM "ChannelSequence" WHERE "roomId" = ${msg.roomId} FOR UPDATE`;
    if (seq.lastKey === msg.idempotencyKey) return { status: "duplicate" as const, applied: 0 };
    if (msg.sequence <= seq.lastSequence) throw new StaleSequenceError(seq.lastSequence);
    let applied = 0;
    for (const u of msg.updates) {
      const data: Prisma.AvailabilityUpdateManyMutationInput = {};
      if (u.price !== undefined) data.price = new Prisma.Decimal(u.price);
      if (u.available !== undefined) data.isAvailable = u.available;
      const r = await tx.availability.updateMany({
        where: { roomId: msg.roomId, date: toDbDate(u.date as IsoDate), lockedBy: null },
        data,
      });
      applied += r.count;
    }
    await tx.channelSequence.update({
      where: { roomId: msg.roomId },
      data: { lastSequence: msg.sequence, lastKey: msg.idempotencyKey },
    });
    return { status: "applied" as const, applied };
  });
}
