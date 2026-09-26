import { it, expect, beforeAll, afterAll } from "vitest";
import fc from "fast-check";
import { NextRequest } from "next/server";
import { PrismaClient } from "@prisma/client";
import { describeInt, iso, utcDay } from "./helpers";
import { createStayFixture, type StayFixture } from "./fixtures";
import { computeTotal } from "@/lib/pricing/quote";
import { refreshPropertyCalendar, refreshAllCalendars } from "@/lib/pricing/price-calendar";
import {
  PRICE_CALENDAR_REFRESH_JOB,
  processPriceCalendarJob,
  type PriceCalendarJobData,
} from "@/lib/pricing/price-calendar-jobs";
import { bulkUpdateAvailability } from "@/lib/host/host-service";
import { relayOutbox } from "@/lib/cqrs/outbox";
import { registerEventHandlers } from "@/lib/events/register";
import { QUEUE_NAMES, getQueue } from "@/lib/queue";
import { searchProperties } from "@/lib/search";
import { GET as calendarGET } from "@/app/api/properties/[id]/calendar-prices/route";
import type { AccessClaims } from "@/lib/auth";
import type { IsoDate } from "@/lib/time/nights";

/**
 * v4 P1-3 (integration): takvim fiyatı = teklif motoru (`computeTotal`, /api/quote'un
 * fonksiyonu) 1 gecelik vergiler dahil toplamı; outbox olaylarıyla artımlı yenileme;
 * calendar-prices API doğrulama/sahiplik; arama ±3 gün önerisi.
 */
const BASE = "http://localhost";
const req = (path: string) => new NextRequest(`${BASE}${path}`);
const claims = (userId: string): AccessClaims => ({
  userId,
  role: "HOST",
  jti: "j",
  exp: 0,
  tv: 0,
});
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const monthOf = (d: Date) => iso(d).slice(0, 7);

async function calendarRow(prisma: PrismaClient, propertyId: string, date: Date) {
  return prisma.minPriceByDate.findUnique({
    where: { propertyId_date: { propertyId, date } },
  });
}

/** Tüm oda × aktif plan 1 gecelik tekliflerinin en ucuzu (teklif motoru). */
async function cheapestQuote(prisma: PrismaClient, propertyId: string, night: number) {
  const rooms = await prisma.roomType.findMany({
    where: { propertyId },
    select: { id: true, ratePlans: { where: { active: true }, select: { id: true } } },
  });
  let best: { total: number; subtotal: number } | null = null;
  for (const room of rooms) {
    for (const plan of room.ratePlans) {
      const q = await computeTotal({
        roomId: room.id,
        ratePlanId: plan.id,
        checkIn: iso(utcDay(night)),
        checkOut: iso(utcDay(night + 1)),
        guests: 1,
      }).catch(() => null);
      if (q && (!best || q.total < best.total)) best = { total: q.total, subtotal: q.subtotal };
    }
  }
  return best;
}

/** Kuyruktaki (gecikmeli/bekleyen) takvim işini bulup doğrudan işler. */
async function drainCalendarJobs(propertyId: string): Promise<number> {
  const queue = getQueue(QUEUE_NAMES.priceCalendar);
  const jobs = (await queue.getJobs(["delayed", "waiting", "prioritized"])).filter(
    (j) => (j?.data as PriceCalendarJobData | undefined)?.propertyId === propertyId
  );
  for (const job of jobs) {
    expect(job.name).toBe(PRICE_CALENDAR_REFRESH_JOB);
    await processPriceCalendarJob(job);
    await job.remove().catch(() => undefined);
  }
  return jobs.length;
}

describeInt("v4 P1-3 esnek tarih fiyat takvimi (integration)", () => {
  const prisma = new PrismaClient();
  let tr: StayFixture;

  beforeAll(async () => {
    registerEventHandlers();
    tr = await createStayFixture(prisma, { tag: "cal-tr", nightlyPrice: 1500, country: "Türkiye" });
    // İkinci oda tipi: farklı oda farkı + planlar → en ucuz seçenek arama gerektirir.
    await prisma.roomType.create({
      data: {
        propertyId: tr.propertyId,
        name: "Suit",
        maxOccupancy: 3,
        units: 2,
        bedType: "Çift",
        priceModifierMinor: 25_000n,
        ratePlans: {
          create: [
            { code: "STANDARD", name: "Standart", isDefault: true },
            { code: "PROMO", name: "Kampanya", priceModifierBps: -1500 },
          ],
        },
        inventory: {
          create: Array.from({ length: 40 }, (_, i) => ({
            date: utcDay(i + 1),
            priceMinor: 140_000n,
            total: 2,
          })),
        },
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("property: takvim fiyatı = teklif motoru 1 gecelik vergiler dahil en ucuz toplamı", async () => {
    const suite = await prisma.roomType.findFirstOrThrow({
      where: { propertyId: tr.propertyId, name: "Suit" },
    });
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 30 }),
        fc.integer({ min: 1_000, max: 900_000 }),
        fc.integer({ min: 1_000, max: 900_000 }),
        fc.integer({ min: -3000, max: 3000 }),
        fc.integer({ min: 0, max: 60_000 }),
        async (night, priceA, priceB, promoBps, suiteModifier) => {
          await prisma.inventoryDay.update({
            where: { roomTypeId_date: { roomTypeId: tr.roomId, date: utcDay(night) } },
            data: { priceMinor: BigInt(priceA) },
          });
          await prisma.inventoryDay.update({
            where: { roomTypeId_date: { roomTypeId: suite.id, date: utcDay(night) } },
            data: { priceMinor: BigInt(priceB) },
          });
          await prisma.ratePlan.updateMany({
            where: { roomTypeId: suite.id, code: "PROMO" },
            data: { priceModifierBps: promoBps },
          });
          await prisma.roomType.update({
            where: { id: suite.id },
            data: { priceModifierMinor: BigInt(suiteModifier) },
          });
          await refreshPropertyCalendar(tr.propertyId, {
            from: iso(utcDay(night)) as IsoDate,
            to: iso(utcDay(night)) as IsoDate,
          });
          const row = await calendarRow(prisma, tr.propertyId, utcDay(night));
          const expected = await cheapestQuote(prisma, tr.propertyId, night);
          expect(expected).not.toBeNull();
          expect(row).not.toBeNull();
          expect(Number(row!.minTotalMinor)).toBe(expected!.total);
          expect(Number(row!.minNightlyMinor)).toBe(expected!.subtotal);
          // Türkiye kuralları: konaklama vergisi hariç → vergiler dahil tutar daha büyük.
          expect(Number(row!.minTotalMinor)).toBeGreaterThan(Number(row!.minNightlyMinor));
          expect(row!.availableRoomTypes).toBe(2);
        }
      ),
      { numRuns: 8 }
    );
  });

  it("incremental: ev sahibi fiyat/stop-sell ve rezervasyon olayları outbox → iş → satır günceller", async () => {
    const f = await createStayFixture(prisma, { tag: "cal-inc", nightlyPrice: 1000 });
    await refreshPropertyCalendar(f.propertyId);
    const night = utcDay(6);
    // En ucuz: iade edilemez plan (−%10).
    expect(Number((await calendarRow(prisma, f.propertyId, night))!.minNightlyMinor)).toBe(90_000);

    // 1) Ev sahibi ARI: fiyat değişimi → property.availability_changed
    await bulkUpdateAvailability(claims(f.hostId), f.roomId, {
      from: iso(utcDay(5)),
      to: iso(utcDay(7)),
      price: 800,
    });
    const msg = await prisma.outboxMessage.findFirst({
      where: { eventType: "property.availability_changed", aggregateId: f.propertyId },
      orderBy: { createdAt: "desc" },
    });
    expect(msg?.payload).toMatchObject({
      propertyId: f.propertyId,
      roomId: f.roomId,
      from: iso(utcDay(5)),
      to: iso(utcDay(7)),
      reason: "host_ari",
    });
    // Olay yayınlanmadan satır eski fiyatta (materyalize görünüm).
    expect(Number((await calendarRow(prisma, f.propertyId, night))!.minNightlyMinor)).toBe(90_000);
    await relayOutbox(500);
    expect(await drainCalendarJobs(f.propertyId)).toBeGreaterThanOrEqual(1);
    const updated = await calendarRow(prisma, f.propertyId, night);
    expect(Number(updated!.minNightlyMinor)).toBe(72_000);
    // Aralık dışı gece dokunulmadı.
    expect(Number((await calendarRow(prisma, f.propertyId, utcDay(9)))!.minNightlyMinor)).toBe(
      90_000
    );

    // 2) Rezervasyon (tek birim) → gece satılamaz.
    const hold = await f.hold({ startInDays: 12, nights: 1 });
    await relayOutbox(500);
    expect(await drainCalendarJobs(f.propertyId)).toBeGreaterThanOrEqual(1);
    const booked = await calendarRow(prisma, f.propertyId, utcDay(12));
    expect(booked).toMatchObject({ availableRoomTypes: 0, minTotalMinor: null });
    expect(hold.checkIn).toBe(iso(utcDay(12)));

    // 3) Stop-sell → müsait değil.
    await bulkUpdateAvailability(claims(f.hostId), f.roomId, {
      from: iso(utcDay(20)),
      to: iso(utcDay(20)),
      isAvailable: false,
    });
    await relayOutbox(500);
    await drainCalendarJobs(f.propertyId);
    expect((await calendarRow(prisma, f.propertyId, utcDay(20)))!.availableRoomTypes).toBe(0);

    // 4) İlan pasife → tam yeniden hesaplama satırları temizler.
    await prisma.property.update({ where: { id: f.propertyId }, data: { isActive: false } });
    const full = await refreshAllCalendars();
    expect(full.failed).toBe(0);
    expect(await prisma.minPriceByDate.count({ where: { propertyId: f.propertyId } })).toBe(0);
  });

  it("API: ay ızgarası, en ucuz işareti, vergi modu; doğrulama 400, listelenemeyen 404", async () => {
    const f = await createStayFixture(prisma, {
      tag: "cal-api",
      nightlyPrice: 1000,
      country: "Türkiye",
      days: 60,
    });
    const cheapNight = utcDay(15);
    await prisma.inventoryDay.update({
      where: { roomTypeId_date: { roomTypeId: f.roomId, date: cheapNight } },
      data: { priceMinor: 50_000n },
    });
    const month = monthOf(cheapNight);
    // Satır yokken istek anında hesaplanır.
    const res = await calendarGET(
      req(`/api/properties/${f.propertyId}/calendar-prices?month=${month}`),
      ctx(f.propertyId)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ propertyId: f.propertyId, month, taxMode: "included" });
    const day = body.days.find((d: { date: string }) => d.date === iso(cheapNight));
    expect(day).toMatchObject({ available: true, cheapest: true, band: 0 });
    const quote = await cheapestQuote(prisma, f.propertyId, 15);
    expect(day.priceMinor).toBe(quote!.total);
    expect(body.minPriceMinor).toBe(quote!.total);

    const excl = await (
      await calendarGET(
        req(`/api/properties/${f.propertyId}/calendar-prices?month=${month}&taxes=excluded`),
        ctx(f.propertyId)
      )
    ).json();
    expect(excl.days.find((d: { date: string }) => d.date === iso(cheapNight)).priceMinor).toBe(
      quote!.subtotal
    );

    for (const bad of ["", "?month=2026-13", "?month=26-01", `?month=${month}&taxes=maybe`]) {
      const r = await calendarGET(
        req(`/api/properties/${f.propertyId}/calendar-prices${bad}`),
        ctx(f.propertyId)
      );
      expect(r.status).toBe(400);
    }
    const missing = await calendarGET(
      req(`/api/properties/nope/calendar-prices?month=${month}`),
      ctx("nope")
    );
    expect(missing.status).toBe(404);
    // Pasif / doğrulanmamış ilanın fiyatları sızdırılmaz.
    await prisma.property.update({
      where: { id: f.propertyId },
      data: { licenseStatus: "PENDING" },
    });
    const hidden = await calendarGET(
      req(`/api/properties/${f.propertyId}/calendar-prices?month=${month}`),
      ctx(f.propertyId)
    );
    expect(hidden.status).toBe(404);
  });

  it("arama ±3 gün: kesin teklifle daha ucuz kaydırma önerir; flexDays yoksa yanıt değişmez", async () => {
    const f = await createStayFixture(prisma, { tag: "cal-flex", nightlyPrice: 2000, days: 40 });
    const city = (
      await prisma.property.findUniqueOrThrow({
        where: { id: f.propertyId },
        select: { location: { select: { city: true } } },
      })
    ).location.city;
    // 20–21. geceler 2000, 22–23. geceler 1200 → +2 gün kaydırma daha ucuz.
    for (const n of [22, 23]) {
      await prisma.inventoryDay.update({
        where: { roomTypeId_date: { roomTypeId: f.roomId, date: utcDay(n) } },
        data: { priceMinor: 120_000n },
      });
    }
    await refreshPropertyCalendar(f.propertyId);
    const base = { city, checkIn: iso(utcDay(20)), checkOut: iso(utcDay(22)), guests: 1 };
    const plain = await searchProperties(base);
    expect(plain.flex).toBeUndefined();
    expect(plain.results[0].flexSuggestion).toBeUndefined();

    const flex = await searchProperties({ ...base, flexDays: 3 });
    expect(flex.flex).toEqual({ days: 3 });
    expect(flex.results.map((r) => r.id)).toEqual(plain.results.map((r) => r.id));
    const s = flex.results[0].flexSuggestion!;
    expect(s).toMatchObject({
      checkIn: iso(utcDay(22)),
      checkOut: iso(utcDay(24)),
      shiftDays: 2,
      currency: "TRY",
    });
    const exact = await computeTotal({
      roomId: s.roomId,
      ratePlanId: s.ratePlanId,
      checkIn: s.checkIn,
      checkOut: s.checkOut,
      guests: 1,
    });
    expect(s.total).toBe(exact.total);
    expect(s.savings).toBe(flex.results[0].quote!.total - exact.total);
    expect(s.savings).toBeGreaterThan(0);

    // ±1 penceresi: en iyi (+2) dışarıda kalır → +1 önerilir.
    const narrow = await searchProperties({ ...base, flexDays: 1 });
    expect(narrow.results[0].flexSuggestion?.shiftDays).toBe(1);
    // Daha ucuz tarih yoksa öneri yok (−3…+3 geceler aynı fiyat).
    const same = await searchProperties({
      ...base,
      checkIn: iso(utcDay(8)),
      checkOut: iso(utcDay(10)),
      flexDays: 3,
    });
    expect(same.results[0].flexSuggestion).toBeUndefined();
    // Sınır: 7'nin üstü 400 (zod), config sınırı 3'e kırpar.
    await expect(searchProperties({ ...base, flexDays: 8 })).rejects.toThrow();
    expect((await searchProperties({ ...base, flexDays: 7 })).flex).toEqual({ days: 3 });
  });
});
