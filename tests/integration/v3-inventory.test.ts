import { beforeAll, afterAll, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { PrismaClient } from "@prisma/client";
import fc from "fast-check";
import { describeInt, iso, utcDay } from "./helpers";
import { createStayFixture, type StayFixture } from "./fixtures";
import { cancelBooking, createBooking, expireHolds } from "@/lib/booking-service";
import { payForBooking } from "@/lib/payment/payment-service";
import { computeTotal } from "@/lib/pricing/quote";
import { searchProperties } from "@/lib/search";
import { GET as searchGet } from "@/app/api/search/route";
import { checkInInstant, computeRefund, DEFAULT_POLICIES } from "@/lib/booking/cancellation";
import { completeStays } from "@/lib/booking/complete-stays";
import { pruneInventory } from "@/lib/booking/availability-rollover";
import { importCalendar } from "@/lib/channel/channel";
import { clockOf, type IsoDate } from "@/lib/time/nights";
import { redis } from "@/lib/redis";

/**
 * v3 envanter modeli (ADR 0010/0011) entegrasyon testleri: sayaçlı oda tipi envanteri,
 * satış kısıtları + fiyat planları, tesis saat dilimi, arama doğruluğu, yaşam döngüsü
 * işleri ve iCal uzlaştırması — gerçek Postgres + Redis üzerinde.
 */

const HOUR = 3_600_000;

/** 409 SOLD_OUT / ROOM_BUSY / RESTRICTED gibi beklenen iş hatası mı? */
function httpStatus(error: unknown): number | undefined {
  return (error as { status?: number })?.status;
}

async function inventoryRows(prisma: PrismaClient, roomTypeId: string) {
  return prisma.inventoryDay.findMany({
    where: { roomTypeId },
    select: { date: true, total: true, sold: true, held: true },
    orderBy: { date: "asc" },
  });
}

async function overbookedRows(prisma: PrismaClient): Promise<number> {
  const r = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*)::bigint AS n FROM "InventoryDay" WHERE sold + held > total`;
  return Number(r[0].n);
}

describeInt("v3 envanter, kısıtlar, saat dilimi ve arama (integration)", () => {
  const prisma = new PrismaClient();

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // --- a) P0-2 eşzamanlılık ---------------------------------------------------------

  it("P0-2: units=3 oda tipine 100 paralel rezervasyon → tam 3 başarılı, kalanlar 409 SOLD_OUT/ROOM_BUSY", async () => {
    const fx = await createStayFixture(prisma, { tag: "inv100", units: 3 });
    const checkIn = iso(utcDay(10));
    const checkOut = iso(utcDay(12));
    const results = await Promise.allSettled(
      Array.from({ length: 100 }, (_, i) =>
        createBooking({
          userId: fx.userId,
          propertyId: fx.propertyId,
          roomId: fx.roomId,
          checkIn,
          checkOut,
          guestCount: 1,
          idempotencyKey: `inv100-${i}`,
        })
      )
    );
    const ok = results.filter((r) => r.status === "fulfilled");
    expect(ok).toHaveLength(3);
    for (const r of results) {
      if (r.status === "rejected") {
        expect(r.reason).toMatchObject({ status: 409 });
        expect(["SOLD_OUT", "ROOM_BUSY"]).toContain((r.reason as { code: string }).code);
      }
    }
    expect(await overbookedRows(prisma)).toBe(0);
    const nights = await prisma.inventoryDay.findMany({
      where: { roomTypeId: fx.roomId, date: { gte: utcDay(10), lt: utcDay(12) } },
    });
    expect(nights).toHaveLength(2);
    for (const n of nights)
      expect({ held: n.held, sold: n.sold, total: n.total }).toEqual({
        held: 3,
        sold: 0,
        total: 3,
      });
    expect(await prisma.booking.count({ where: { roomId: fx.roomId, status: "HELD" } })).toBe(3);
  });

  // --- b) P0-2 özellik testi ----------------------------------------------------------

  it("P0-2 (fast-check): rastgele tut/iptal/süre dolumu/öde dizilerinde sayaçlar rezervasyon durumlarıyla tutarlı", async () => {
    type Cmd =
      | { kind: "hold"; start: number; nights: number }
      | { kind: "cancel" | "expire" | "pay"; target: number };
    const cmd: fc.Arbitrary<Cmd> = fc.oneof(
      fc.record({
        kind: fc.constant("hold" as const),
        start: fc.integer({ min: 0, max: 3 }),
        nights: fc.integer({ min: 1, max: 2 }),
      }),
      fc.record({
        kind: fc.constantFrom("cancel" as const, "expire" as const, "pay" as const),
        target: fc.nat({ max: 9 }),
      })
    );

    let run = 0;
    await fc.assert(
      fc.asyncProperty(fc.array(cmd, { minLength: 1, maxLength: 8 }), async (cmds) => {
        run += 1;
        const fx = await createStayFixture(prisma, { tag: `fc${run}`, units: 2, days: 20 });
        const ids: string[] = [];

        const check = async () => {
          const rows = await inventoryRows(prisma, fx.roomId);
          const bookings = await prisma.booking.findMany({
            where: { roomId: fx.roomId },
            select: { status: true, checkIn: true, checkOut: true, units: true },
          });
          for (const row of rows) {
            expect(row.sold + row.held).toBeLessThanOrEqual(row.total);
            const covering = bookings.filter((b) => b.checkIn <= row.date && row.date < b.checkOut);
            const sum = (status: string) =>
              covering.filter((b) => b.status === status).reduce((s, b) => s + b.units, 0);
            expect({ date: iso(row.date), held: row.held, sold: row.sold }).toEqual({
              date: iso(row.date),
              held: sum("HELD"),
              sold: sum("CONFIRMED"),
            });
          }
        };

        for (const [step, c] of cmds.entries()) {
          try {
            if (c.kind === "hold") {
              const b = await fx.hold({ startInDays: 5 + c.start, nights: c.nights });
              ids.push(b.id);
            } else if (ids.length > 0) {
              const id = ids[c.target % ids.length];
              if (c.kind === "cancel") {
                await cancelBooking(id, fx.userId);
              } else if (c.kind === "expire") {
                await prisma.booking.updateMany({
                  where: { id, status: "HELD" },
                  data: { holdExpiresAt: new Date(Date.now() - 60_000) },
                });
                await expireHolds(new Date());
              } else {
                await payForBooking({
                  bookingId: id,
                  userId: fx.userId,
                  cardToken: "tok_mock_ok_4242",
                  idempotencyKey: `fc-${run}-${step}`,
                });
              }
            }
          } catch (error) {
            // Beklenen iş hataları (dolu, geçersiz durum) 4xx'tir; başka her hata testi düşürür.
            const status = httpStatus(error);
            if (status === undefined || status >= 500) throw error;
          }
          await check();
        }
      }),
      { numRuns: 25 }
    );
    expect(await overbookedRows(prisma)).toBe(0);
  });

  // --- c) Kısıtlar ve fiyat planları ---------------------------------------------------

  it("minStay ihlali → 409 RESTRICTED", async () => {
    const fx = await createStayFixture(prisma, { tag: "minstay" });
    await prisma.restriction.create({
      data: { roomTypeId: fx.roomId, date: utcDay(20), minStay: 3 },
    });
    await expect(
      createBooking({
        userId: fx.userId,
        propertyId: fx.propertyId,
        roomId: fx.roomId,
        checkIn: iso(utcDay(20)),
        checkOut: iso(utcDay(22)),
        guestCount: 1,
      })
    ).rejects.toMatchObject({ status: 409, code: "RESTRICTED" });
    // Yeterli uzunlukta konaklama kabul edilir.
    const ok = await createBooking({
      userId: fx.userId,
      propertyId: fx.propertyId,
      roomId: fx.roomId,
      checkIn: iso(utcDay(20)),
      checkOut: iso(utcDay(23)),
      guestCount: 1,
    });
    expect(ok.booking.status).toBe("HELD");
  });

  it("stopSell gecesi → rezerve edilemez ve aramada çıkmaz", async () => {
    const country = `SS-${Date.now()}`;
    const fx = await createStayFixture(prisma, { tag: "stopsell", country });
    await prisma.restriction.create({
      data: { roomTypeId: fx.roomId, date: utcDay(31), stopSell: true },
    });
    const checkIn = iso(utcDay(30));
    const checkOut = iso(utcDay(33));
    await expect(
      createBooking({
        userId: fx.userId,
        propertyId: fx.propertyId,
        roomId: fx.roomId,
        checkIn,
        checkOut,
        guestCount: 1,
      })
    ).rejects.toMatchObject({ status: 409, code: "RESTRICTED" });
    const hit = await searchProperties({ country, checkIn, checkOut });
    expect(hit.results.map((r) => r.id)).not.toContain(fx.propertyId);
    // Kısıtın dışındaki tarihlerde bulunur (filtre gerçekten kısıttan kaynaklanıyor).
    const other = await searchProperties({
      country,
      checkIn: iso(utcDay(40)),
      checkOut: iso(utcDay(42)),
    });
    expect(other.results.map((r) => r.id)).toContain(fx.propertyId);
  });

  it("iade edilemez plan → NON_REFUNDABLE politika anlık görüntüsü ve %10 ucuz toplam", async () => {
    const fx = await createStayFixture(prisma, { tag: "nonref", units: 2 });
    const nonref = await prisma.ratePlan.findFirstOrThrow({
      where: { roomTypeId: fx.roomId, code: "NONREF" },
    });
    const base = {
      userId: fx.userId,
      propertyId: fx.propertyId,
      roomId: fx.roomId,
      checkIn: iso(utcDay(25)),
      checkOut: iso(utcDay(27)),
      guestCount: 1,
    };
    const std = await createBooking(base);
    const nr = await createBooking({ ...base, ratePlanId: nonref.id });
    expect(nr.booking.ratePlanId).toBe(nonref.id);
    expect(nr.booking.totalMinor).toBe(Math.round(std.booking.totalMinor * 0.9));
    const rows = await prisma.booking.findMany({
      where: { id: { in: [std.booking.id, nr.booking.id] } },
      select: { id: true, policySnapshot: true },
    });
    const snap = (id: string) => rows.find((r) => r.id === id)!.policySnapshot as { kind: string };
    expect(snap(nr.booking.id).kind).toBe("NON_REFUNDABLE");
    expect(snap(std.booking.id).kind).not.toBe("NON_REFUNDABLE");
  });

  // --- d) Saat dilimi ----------------------------------------------------------------

  it("regression: v3#6 Tokyo tesisinde 'bugün' tesisin yerel tarihidir (computeTotal now)", async () => {
    const tokyo = await createStayFixture(prisma, { tag: "tokyo", timeZone: "Asia/Tokyo" });
    const istanbul = await createStayFixture(prisma, { tag: "ist" });
    for (const fx of [tokyo, istanbul]) {
      await prisma.inventoryDay.create({
        data: { roomTypeId: fx.roomId, date: utcDay(0), priceMinor: 100000n, total: 1 },
      });
    }
    const today = iso(utcDay(0));
    const tomorrow = iso(utcDay(1));
    const req = (roomId: string, checkIn: string, checkOut: string) => ({
      roomId,
      checkIn,
      checkOut,
      guests: 1,
    });
    // UTC 20:00 → Tokyo'da ertesi gün 05:00: UTC "bugün" Tokyo için geçmiştir.
    const lateUtc = new Date(utcDay(0).getTime() + 20 * HOUR);
    await expect(computeTotal(req(tokyo.roomId, today, tomorrow), lateUtc)).rejects.toMatchObject({
      status: 400,
    });
    const q = await computeTotal(req(tokyo.roomId, tomorrow, iso(utcDay(2))), lateUtc);
    expect(q.checkIn).toBe(tomorrow);
    // Aynı anda İstanbul'da saat 23:00 → bugün hâlâ bugündür.
    const ist = await computeTotal(req(istanbul.roomId, today, tomorrow), lateUtc);
    expect(ist.checkIn).toBe(today);
    // UTC 10:00 → Tokyo 19:00: aynı gün, "bugün" girişi kabul.
    const earlyUtc = new Date(utcDay(0).getTime() + 10 * HOUR);
    const q2 = await computeTotal(req(tokyo.roomId, today, tomorrow), earlyUtc);
    expect(q2.nights).toHaveLength(1);
  });

  it("regression: v3#6 iade penceresi Tokyo yerel 15:00 girişine göre hesaplanır", async () => {
    const fx = await createStayFixture(prisma, { tag: "tokyorefund", timeZone: "Asia/Tokyo" });
    const property = await prisma.property.findUniqueOrThrow({
      where: { id: fx.propertyId },
      select: { timeZone: true, checkInTime: true, checkOutTime: true },
    });
    const clock = clockOf(property);
    const checkIn = iso(utcDay(10)) as IsoDate;
    const start = checkInInstant(checkIn, clock);
    // Tokyo 15:00 = UTC 06:00 (JST DST uygulamaz).
    expect(start.toISOString()).toBe(`${checkIn}T06:00:00.000Z`);
    const booking = {
      checkIn,
      createdAt: new Date(start.getTime() - 30 * 24 * HOUR),
      paidMinor: 100_000,
      currency: "TRY" as const,
    };
    const before = computeRefund(
      DEFAULT_POLICIES.FLEXIBLE,
      booking,
      new Date(start.getTime() - 60_000),
      clock
    );
    expect(before.reason).not.toBe("no_show");
    expect(before.hoursBeforeCheckIn).toBeGreaterThan(0);
    const after = computeRefund(
      DEFAULT_POLICIES.FLEXIBLE,
      booking,
      new Date(start.getTime() + 60_000),
      clock
    );
    expect(after).toMatchObject({ reason: "no_show", refundMinor: 0 });
    // UTC 15:00 (Tokyo'da gece yarısı) çoktan geçmiş: iade yok.
    const utcThree = computeRefund(
      DEFAULT_POLICIES.FLEXIBLE,
      booking,
      new Date(`${checkIn}T14:00:00.000Z`),
      clock
    );
    expect(utcThree.reason).toBe("no_show");
  });

  // --- e) Arama -------------------------------------------------------------------------

  it("regression: v3#7 GET /api/search geçersiz parametre → 400", async () => {
    const bad = [`/api/search?checkIn=abc&checkOut=${iso(utcDay(5))}`, `/api/search?guests=x`];
    for (const path of bad) {
      const res = await searchGet(new NextRequest(`http://localhost${path}`), undefined);
      expect(res.status, path).toBe(400);
    }
    const good = await searchGet(
      new NextRequest(
        `http://localhost/api/search?guests=2&checkIn=${iso(utcDay(5))}&checkOut=${iso(utcDay(6))}`
      ),
      undefined
    );
    expect(good.status).toBe(200);
  });

  it("regression: v3#7 dolu gece dışlanır, total = tüm sayfaların birleşimi, fiyat filtresi EUR, sürüm yalnız o mülkte artar", async () => {
    const country = `SR-${Date.now()}`;
    const fxs: StayFixture[] = [];
    for (let i = 0; i < 5; i++) {
      fxs.push(
        await createStayFixture(prisma, {
          tag: `sr${i}`,
          country,
          nightlyPrice: 1000 + i * 2000,
        })
      );
    }
    const checkIn = iso(utcDay(50));
    const checkOut = iso(utcDay(53));
    // Mülk 4'ün tek gecesi dolu → aralık için uygun değil.
    const full = fxs[4];
    await prisma.inventoryDay.update({
      where: { roomTypeId_date: { roomTypeId: full.roomId, date: utcDay(51) } },
      data: { sold: 1 },
    });

    const params = { country, checkIn, checkOut, pageSize: 2 };
    const first = await searchProperties(params);
    expect(first.total).toBe(4);
    expect(first.totalPages).toBe(2);
    const all: string[] = [];
    for (let page = 1; page <= first.totalPages; page++) {
      const res = await searchProperties({ ...params, page });
      all.push(...res.results.map((r) => r.id));
    }
    expect(all).toHaveLength(first.total);
    expect(new Set(all).size).toBe(first.total);
    expect(all).not.toContain(full.propertyId);
    expect(new Set(all)).toEqual(new Set(fxs.slice(0, 4).map((f) => f.propertyId)));

    // Fiyat filtresi görüntü para birimindeki (EUR) toplam üzerinden.
    const eur = await searchProperties({
      country,
      checkIn,
      checkOut,
      currency: "EUR",
      pageSize: 50,
    });
    const byId = new Map(eur.results.map((r) => [r.id, r]));
    const cheap = byId.get(fxs[0].propertyId)!;
    const next = byId.get(fxs[1].propertyId)!;
    expect(cheap.display?.currency).toBe("EUR");
    expect(cheap.quote?.currency).toBe("TRY");
    const cheapTry = cheap.quote!.total / 100;
    expect(cheap.display!.amount).toBeLessThan(cheapTry);
    const threshold = (cheap.display!.amount + next.display!.amount) / 2;
    // Eşik TRY toplamlarının hepsinden küçük: filtre TRY'ye uygulansaydı hiçbiri kalmazdı.
    expect(threshold).toBeLessThan(cheapTry);
    const filtered = await searchProperties({
      country,
      checkIn,
      checkOut,
      currency: "EUR",
      maxPrice: threshold,
      pageSize: 50,
    });
    expect(filtered.results.map((r) => r.id)).toEqual([fxs[0].propertyId]);

    // Rezervasyon yalnızca o mülkün `search:pv:` sürümünü artırır.
    const pv = async (id: string) => Number((await redis.get(`search:pv:${id}`)) ?? "0");
    const [a0, b0] = [await pv(fxs[0].propertyId), await pv(fxs[1].propertyId)];
    await fxs[0].hold({ startInDays: 60 });
    expect(await pv(fxs[0].propertyId)).toBe(a0 + 1);
    expect(await pv(fxs[1].propertyId)).toBe(b0);
  });

  // --- f) complete-stays -------------------------------------------------------------

  it("regression: v3#18 completeStays tesisin yerel çıkış saatine göre COMPLETED yapar", async () => {
    const tokyo = await createStayFixture(prisma, { tag: "cstk", timeZone: "Asia/Tokyo" });
    const ny = await createStayFixture(prisma, { tag: "csny", timeZone: "America/New_York" });
    const mk = (fx: StayFixture) =>
      prisma.booking.create({
        data: {
          userId: fx.userId,
          propertyId: fx.propertyId,
          roomId: fx.roomId,
          checkIn: new Date("2026-01-08T00:00:00Z"),
          checkOut: new Date("2026-01-10T00:00:00Z"),
          guestCount: 1,
          totalPriceMinor: 200000n,
          currency: "TRY",
          status: "CONFIRMED",
        },
      });
    const [bt, bn] = [await mk(tokyo), await mk(ny)];
    // 2026-01-10 03:00Z: Tokyo 12:00 (çıkış 11:00 geçti), New York 22:00 önceki gün.
    const done = await completeStays(new Date("2026-01-10T03:00:00Z"));
    expect(done).toBeGreaterThanOrEqual(1);
    const status = async (id: string) =>
      (await prisma.booking.findUniqueOrThrow({ where: { id } })).status;
    expect(await status(bt.id)).toBe("COMPLETED");
    expect(await status(bn.id)).toBe("CONFIRMED");
    // New York 11:00 EST = 16:00Z sonrasında o da tamamlanır; tekrar çalıştırmak idempotent.
    await completeStays(new Date("2026-01-10T16:30:00Z"));
    expect(await status(bn.id)).toBe("COMPLETED");
    expect(await completeStays(new Date("2026-01-10T16:30:00Z"))).toBe(0);
  });

  // --- g) Veri yaşam döngüsü ---------------------------------------------------------

  it("regression: v3#15 pruneInventory saklama süresinden eski envanteri siler, yenisini korur", async () => {
    const fx = await createStayFixture(prisma, { tag: "prune", days: 3 });
    const old = utcDay(-401);
    const kept = utcDay(-399);
    const edge = utcDay(-400);
    await prisma.inventoryDay.createMany({
      data: [old, edge, kept].map((date) => ({
        roomTypeId: fx.roomId,
        date,
        priceMinor: 100000n,
        total: 1,
      })),
    });
    await prisma.restriction.create({ data: { roomTypeId: fx.roomId, date: old, stopSell: true } });
    const deleted = await pruneInventory();
    expect(deleted).toBeGreaterThanOrEqual(1);
    const dates = (await inventoryRows(prisma, fx.roomId)).map((r) => iso(r.date));
    expect(dates).not.toContain(iso(old));
    expect(dates).toContain(iso(edge));
    expect(dates).toContain(iso(kept));
    expect(dates).toContain(iso(utcDay(1)));
    expect(await prisma.restriction.count({ where: { roomTypeId: fx.roomId } })).toBe(0);
  });

  // --- h) iCal içe aktarma --------------------------------------------------------------

  describeInt("iCal içe aktarma (Tokyo)", () => {
    let fx: StayFixture;
    const ymd = (d: Date) => iso(d).replace(/-/g, "");
    const d = (n: number) => utcDay(n);

    const eventUtc = [
      "BEGIN:VEVENT",
      "UID:utc-1@ext",
      `DTSTART:${ymd(d(30))}T160000Z`,
      `DTEND:${ymd(d(31))}T160000Z`,
      "END:VEVENT",
    ];
    const eventTzid = [
      "BEGIN:VEVENT",
      "UID:tzid-1@ext",
      `DTSTART;TZID=Asia/Tokyo:${ymd(d(40))}T150000`,
      `DTEND;TZID=Asia/Tokyo:${ymd(d(42))}T110000`,
      "END:VEVENT",
    ];
    const eventDate = [
      "BEGIN:VEVENT",
      "UID:date-1@ext",
      `DTSTART;VALUE=DATE:${ymd(d(50))}`,
      `DTEND;VALUE=DATE:${ymd(d(51))}`,
      "END:VEVENT",
    ];
    const feed = (...events: string[][]) =>
      [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//test//EN",
        ...events.flat(),
        "END:VCALENDAR",
      ].join("\r\n");

    beforeAll(async () => {
      fx = await createStayFixture(prisma, { tag: "ical", timeZone: "Asia/Tokyo" });
    });

    const soldBy = async () =>
      new Map((await inventoryRows(prisma, fx.roomId)).map((r) => [iso(r.date), r.sold]));

    it("regression: v3#6 UTC DATE-TIME, TZID DATE-TIME ve DATE olayları doğru yerel gecelere eşlenir; tekrar içe aktarma idempotent", async () => {
      const full = feed(eventUtc, eventTzid, eventDate);
      const first = await importCalendar(fx.roomId, full, "airbnb");
      expect(first).toMatchObject({ nights: 4, added: 4, removed: 0, conflicts: [] });
      const expected = [iso(d(31)), iso(d(40)), iso(d(41)), iso(d(50))];
      const blocks = await prisma.externalBlock.findMany({
        where: { roomTypeId: fx.roomId },
        orderBy: { date: "asc" },
      });
      expect(blocks.map((b) => iso(b.date))).toEqual(expected);
      const sold = await soldBy();
      for (const date of expected) expect(sold.get(date), date).toBe(1);
      // UTC günü (Tokyo'da önceki gün değil) ve TZID çıkış günü gece sayılmaz.
      expect(sold.get(iso(d(30)))).toBe(0);
      expect(sold.get(iso(d(42)))).toBe(0);

      const again = await importCalendar(fx.roomId, full, "airbnb");
      expect(again).toMatchObject({ nights: 4, added: 0, removed: 0, conflicts: [] });
      const soldAgain = await soldBy();
      for (const date of expected) expect(soldAgain.get(date)).toBe(1);
    });

    it("olayı kaldırılan akış yeniden içe aktarılınca blok serbest kalır (sold azalır)", async () => {
      const res = await importCalendar(fx.roomId, feed(eventUtc, eventTzid), "airbnb");
      expect(res).toMatchObject({ added: 0, removed: 1 });
      const sold = await soldBy();
      expect(sold.get(iso(d(50)))).toBe(0);
      expect(sold.get(iso(d(31)))).toBe(1);
      expect(
        await prisma.externalBlock.count({ where: { roomTypeId: fx.roomId, uid: "date-1@ext" } })
      ).toBe(0);
      expect(await overbookedRows(prisma)).toBe(0);
    });
  });
});
