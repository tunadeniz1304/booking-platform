import { describe, it, expect, vi, afterEach } from "vitest";
import fc from "fast-check";
import { priceStay } from "@/lib/pricing/quote";
import { TaxRuleSchema, taxRulesFor, type TaxRule } from "@/lib/pricing/tax";
import {
  buildMonthGrid,
  cheapestNight,
  daysInclusive,
  parseMonth,
  type CalendarRoomInput,
} from "@/lib/pricing/price-calendar";
import {
  PRICE_CALENDAR_FULL_JOB,
  PRICE_CALENDAR_REFRESH_JOB,
  calendarJobKey,
  enqueueCalendarRefresh,
  processPriceCalendarJob,
  schedulePriceCalendarRefresh,
} from "@/lib/pricing/price-calendar-jobs";
import { estimateShift, pickFlexCandidates, type FlexRow } from "@/lib/search/flex";
import { SearchParamsSchema, searchParamsFromUrl } from "@/lib/search/params";
import { addDays, type IsoDate } from "@/lib/time/nights";
import { resetConfigForTests } from "@/lib/config/app-config";

const DATE = "2026-11-10" as IsoDate;

/** Rastgele vergi/ücret seti: yüzde (dahil/hariç), gecelik/kişi başı sabit. */
const taxRulesArb: fc.Arbitrary<TaxRule[]> = fc.oneof(
  fc.constant(taxRulesFor("Türkiye")),
  fc.constant([] as TaxRule[]),
  fc
    .record({
      rateBps: fc.integer({ min: 0, max: 3000 }),
      inclusive: fc.boolean(),
      flat: fc.integer({ min: 0, max: 5000 }),
      perGuest: fc.boolean(),
    })
    .map(({ rateBps, inclusive, flat, perGuest }) => [
      TaxRuleSchema.parse({
        code: "VAT",
        country: "*",
        kind: "VAT",
        label: "KDV",
        rateBps,
        inclusive,
      }),
      TaxRuleSchema.parse({
        code: "CITY",
        country: "*",
        kind: "CITY",
        label: "Şehir vergisi",
        flatMinor: flat,
        perNight: true,
        perGuest,
      }),
    ])
);

const roomArb = (i: number): fc.Arbitrary<CalendarRoomInput> =>
  fc.record({
    roomTypeId: fc.constant(`room-${i}`),
    modifierMinor: fc.integer({ min: -5_000, max: 50_000 }),
    plans: fc.array(
      fc.record({
        id: fc.uuid(),
        priceModifierBps: fc.integer({ min: -3000, max: 3000 }),
      }),
      { minLength: 0, maxLength: 3 }
    ),
    inventory: fc.option(
      fc.record({
        priceMinor: fc.bigInt({ min: 0n, max: 2_000_000n }),
        total: fc.integer({ min: 0, max: 3 }),
        sold: fc.integer({ min: 0, max: 3 }),
        held: fc.integer({ min: 0, max: 1 }),
      }),
      { nil: null }
    ),
    restriction: fc.option(
      fc.record({
        date: fc.constant(DATE),
        minStay: fc.constant(null),
        maxStay: fc.constant(null),
        closedToArrival: fc.constant(false),
        closedToDeparture: fc.constant(false),
        stopSell: fc.boolean(),
      }),
      { nil: null }
    ),
  });

const roomsArb = fc
  .integer({ min: 0, max: 4 })
  .chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => roomArb(i))));

describe("P1-3 fiyat takvimi — takvim fiyatı = teklif motoru toplamı", () => {
  it("property: vergiler dahil en ucuz gece = satılabilir tüm (oda, plan) 1 gecelik priceStay toplamlarının minimumu", () => {
    fc.assert(
      fc.property(
        roomsArb,
        taxRulesArb,
        fc.integer({ min: 1, max: 4 }),
        (rooms, taxRules, guests) => {
          const day = cheapestNight({ date: DATE, currency: "TRY", taxRules, guests, rooms });
          // Bağımsız kaba kuvvet: teklif motorunun seçebileceği her (oda, plan) çifti.
          const totals: Array<{ total: number; nightly: number }> = [];
          let sellableRooms = 0;
          for (const r of rooms) {
            const inv = r.inventory;
            if (!inv || inv.total - inv.sold - inv.held < 1 || r.restriction?.stopSell) continue;
            let any = false;
            for (const p of r.plans) {
              let q;
              try {
                q = priceStay({
                  nights: [{ date: DATE, baseMinor: Number(inv.priceMinor) }],
                  modifierMinor: r.modifierMinor,
                  planModifierBps: p.priceModifierBps,
                  currency: "TRY",
                  taxRules,
                  guests,
                });
              } catch {
                continue; // negatif gece: teklif motoru da satamaz
              }
              totals.push({ total: q.total, nightly: q.subtotal });
              any = true;
            }
            if (any) sellableRooms += 1;
          }
          expect(day.availableRoomTypes).toBe(sellableRooms);
          if (totals.length === 0) {
            expect(day.minTotalMinor).toBeNull();
            expect(day.minNightlyMinor).toBeNull();
            return;
          }
          const min = Math.min(...totals.map((t) => t.total));
          expect(day.minTotalMinor).toBe(min);
          // Seçilen seçeneğin vergisiz gece fiyatı da aynı seçeneğe ait olmalı.
          expect(totals.some((t) => t.total === min && t.nightly === day.minNightlyMinor)).toBe(
            true
          );
          expect(day.closedToArrival).toBe(false);
        }
      ),
      { numRuns: 300 }
    );
  });

  it("girişe açık seçenek, daha ucuz ama girişe kapalı seçeneğe tercih edilir; hepsi kapalıysa işaretlenir", () => {
    const rules = taxRulesFor("Türkiye");
    const room = (id: string, price: bigint, cta: boolean, minStay: number | null = null) => ({
      roomTypeId: id,
      modifierMinor: 0,
      plans: [{ id: `${id}-p`, priceModifierBps: 0 }],
      inventory: { priceMinor: price, total: 1, sold: 0, held: 0 },
      restriction: {
        date: DATE,
        minStay,
        maxStay: null,
        closedToArrival: cta,
        closedToDeparture: false,
        stopSell: false,
      },
    });
    const mixed = cheapestNight({
      date: DATE,
      currency: "TRY",
      taxRules: rules,
      guests: 1,
      rooms: [room("a", 10_000n, true), room("b", 20_000n, false, 3)],
    });
    expect(mixed.roomTypeId).toBe("b");
    expect(mixed.closedToArrival).toBe(false);
    expect(mixed.minStay).toBe(3);
    expect(mixed.availableRoomTypes).toBe(2);

    const allClosed = cheapestNight({
      date: DATE,
      currency: "TRY",
      taxRules: rules,
      guests: 1,
      rooms: [room("a", 10_000n, true)],
    });
    expect(allClosed.roomTypeId).toBe("a");
    expect(allClosed.closedToArrival).toBe(true);
    expect(allClosed.minNightlyMinor).toBe(10_000);
  });

  it("negatif gece fiyatlı plan atlanır (teklif motoru da satamaz)", () => {
    const day = cheapestNight({
      date: DATE,
      currency: "TRY",
      taxRules: [],
      guests: 1,
      rooms: [
        {
          roomTypeId: "neg",
          modifierMinor: -50_000,
          plans: [{ id: "p", priceModifierBps: 0 }],
          inventory: { priceMinor: 1_000n, total: 1, sold: 0, held: 0 },
        },
      ],
    });
    expect(day.minTotalMinor).toBeNull();
    expect(day.availableRoomTypes).toBe(0);
  });
});

describe("P1-3 ay ızgarası", () => {
  it("parseMonth: geçerli ay sınırları, geçersiz biçim 400", () => {
    expect(parseMonth("2026-02")).toEqual({ first: "2026-02-01", last: "2026-02-28" });
    expect(parseMonth("2028-02").last).toBe("2028-02-29");
    expect(parseMonth("2026-12").last).toBe("2026-12-31");
    for (const bad of ["2026-13", "2026-1", "26-01", "", null, "2026-01-01"]) {
      expect(() => parseMonth(bad)).toThrow(/YYYY-AA/);
    }
  });

  it("bantlar, en ucuz işareti, geçmiş/müsait değil günler ve vergi modu", () => {
    const { first, last } = parseMonth("2026-11");
    const rows = daysInclusive(first, last)
      .filter((d) => d !== "2026-11-20")
      .map((date, i) => ({
        date,
        minNightlyMinor: 10_000 + (i % 5) * 1_000,
        minTotalMinor: 11_000 + (i % 5) * 1_000,
        minStay: date === "2026-11-12" ? 2 : null,
        closedToArrival: false,
      }));
    const grid = buildMonthGrid({
      first,
      last,
      today: "2026-11-05" as IsoDate,
      taxMode: "included",
      cheapBandBps: 1000,
      rows,
    });
    expect(grid.days).toHaveLength(30);
    const byDate = new Map<string, (typeof grid.days)[number]>(grid.days.map((d) => [d.date, d]));
    expect(byDate.get("2026-11-01")).toMatchObject({ past: true, available: false, band: null });
    expect(byDate.get("2026-11-20")).toMatchObject({ available: false, priceMinor: null });
    expect(byDate.get("2026-11-12")?.minStay).toBe(2);
    expect(grid.min).toBe(11_000);
    expect(grid.max).toBe(15_000);
    const cheapest = grid.days.filter((d) => d.cheapest);
    expect(cheapest.length).toBeGreaterThan(0);
    for (const d of cheapest) expect(d).toMatchObject({ priceMinor: 11_000, band: 0, cheap: true });
    for (const d of grid.days.filter((x) => x.available)) {
      expect(d.band).toBeGreaterThanOrEqual(0);
      expect(d.band).toBeLessThanOrEqual(4);
    }
    expect(grid.days.find((d) => d.priceMinor === 15_000)?.band).toBe(4);

    const excl = buildMonthGrid({
      first,
      last,
      today: "2026-11-05" as IsoDate,
      taxMode: "excluded",
      cheapBandBps: 0,
      rows,
    });
    expect(excl.min).toBe(10_000);
  });

  it("tek fiyatlı ay: tüm müsait günler bant 0 ve en ucuz", () => {
    const { first, last } = parseMonth("2026-12");
    const grid = buildMonthGrid({
      first,
      last,
      today: "2026-01-01" as IsoDate,
      taxMode: "included",
      cheapBandBps: 0,
      rows: [
        {
          date: "2026-12-03" as IsoDate,
          minNightlyMinor: 5,
          minTotalMinor: 5,
          minStay: null,
          closedToArrival: false,
        },
      ],
    });
    expect(grid.days.filter((d) => d.available)).toEqual([
      expect.objectContaining({ date: "2026-12-03", band: 0, cheapest: true }),
    ]);
  });
});

describe("P1-3 arama ±N gün adayı", () => {
  const row = (date: IsoDate, total: number | null, extra: Partial<FlexRow> = {}): FlexRow => ({
    propertyId: "p1",
    date,
    minTotalMinor: total,
    availableRoomTypes: total === null ? 0 : 1,
    minStay: null,
    closedToArrival: false,
    ...extra,
  });
  const nights = ["2026-11-10", "2026-11-11"] as IsoDate[];

  it("en ucuz kaydırmayı seçer; asıl tarihten ucuz değilse öneri yok", () => {
    const prices: Record<string, number> = {
      "2026-11-07": 900,
      "2026-11-08": 1100,
      "2026-11-09": 1000,
      "2026-11-10": 1000,
      "2026-11-11": 1000,
      "2026-11-12": 1100,
      "2026-11-13": 700,
      "2026-11-14": 700,
    };
    const rows = Object.entries(prices).map(([d, p]) => row(d as IsoDate, p));
    const got = pickFlexCandidates({ rows, nights, flexDays: 3 }).get("p1");
    expect(got).toMatchObject({
      shiftDays: 3,
      checkIn: "2026-11-13",
      checkOut: "2026-11-15",
      estimatedTotalMinor: 1400,
    });
    expect(pickFlexCandidates({ rows, nights, flexDays: 1 }).get("p1")).toBeUndefined();
  });

  it("müsait değil / girişe kapalı / min konaklama ihlali kaydırmalar elenir", () => {
    const byDate = new Map<IsoDate, FlexRow>([
      ["2026-11-10" as IsoDate, row("2026-11-10" as IsoDate, 500, { closedToArrival: true })],
      ["2026-11-11" as IsoDate, row("2026-11-11" as IsoDate, 500, { minStay: 3 })],
      ["2026-11-12" as IsoDate, row("2026-11-12" as IsoDate, null)],
    ]);
    expect(estimateShift(byDate, nights, 0)).toBeNull();
    expect(estimateShift(byDate, nights, 1)).toBeNull();
    expect(estimateShift(byDate, nights, 5)).toBeNull();
  });

  it("property: aday her zaman ±N içinde, süreyi korur ve tahmini asıl tarihten ucuzdur", () => {
    fc.assert(
      fc.property(
        fc.array(fc.option(fc.integer({ min: 1, max: 10_000 }), { nil: null }), {
          minLength: 12,
          maxLength: 12,
        }),
        fc.integer({ min: 1, max: 3 }),
        fc.integer({ min: 1, max: 3 }),
        (prices, flexDays, los) => {
          const start = "2026-11-01" as IsoDate;
          const rows = prices.map((p, i) => row(addDays(start, i), p));
          const stay = Array.from({ length: los }, (_, i) => addDays(start, 4 + i));
          const c = pickFlexCandidates({ rows, nights: stay, flexDays }).get("p1");
          if (!c) return;
          expect(Math.abs(c.shiftDays)).toBeGreaterThanOrEqual(1);
          expect(Math.abs(c.shiftDays)).toBeLessThanOrEqual(flexDays);
          expect(c.checkIn).toBe(addDays(stay[0], c.shiftDays));
          expect(c.checkOut).toBe(addDays(stay[0], c.shiftDays + los));
          const byDate = new Map(rows.map((r) => [r.date, r]));
          const base = estimateShift(byDate, stay, 0);
          if (base !== null) expect(c.estimatedTotalMinor).toBeLessThan(base);
        }
      )
    );
  });

  it("flexDays parametresi: URL'den okunur, 0..7 dışı 400", () => {
    const sp = new URLSearchParams("checkIn=2026-11-10&checkOut=2026-11-12&flexDays=3");
    expect(SearchParamsSchema.parse(searchParamsFromUrl(sp)).flexDays).toBe(3);
    expect(SearchParamsSchema.parse({}).flexDays).toBeUndefined();
    expect(() => SearchParamsSchema.parse({ flexDays: 8 })).toThrow();
    expect(() => SearchParamsSchema.parse({ flexDays: -1 })).toThrow();
    expect(() => SearchParamsSchema.parse({ flexDays: "1.5" })).toThrow();
  });
});

describe("P1-3 fiyat takvimi işleri", () => {
  afterEach(() => {
    delete process.env.PRICE_CALENDAR_DEBOUNCE_MS;
    resetConfigForTests();
  });

  it("deduplication kimliği ':' içermez ve aralığa göre ayrışır", () => {
    const a = calendarJobKey({ propertyId: "p1", from: "2026-11-10" as IsoDate });
    expect(a).not.toContain(":");
    expect(a).not.toBe(calendarJobKey({ propertyId: "p1", from: "2026-11-11" as IsoDate }));
  });

  it("artımlı iş gecikmeli ve deduplication ile eklenir; tam iş zamanlanır", async () => {
    process.env.PRICE_CALENDAR_DEBOUNCE_MS = "1500";
    resetConfigForTests();
    const add = vi.fn().mockResolvedValue({ id: "j1" });
    const upsertJobScheduler = vi.fn().mockResolvedValue(undefined);
    const queue = { add, upsertJobScheduler } as never;
    await expect(
      enqueueCalendarRefresh({ propertyId: "p1", from: "2026-11-10" as IsoDate }, queue)
    ).resolves.toBe("j1");
    expect(add).toHaveBeenCalledWith(
      PRICE_CALENDAR_REFRESH_JOB,
      { propertyId: "p1", from: "2026-11-10" },
      expect.objectContaining({
        delay: 1500,
        deduplication: { id: "mpbd-p1-2026-11-10-end", keepLastIfActive: true },
      })
    );
    await schedulePriceCalendarRefresh(queue);
    expect(upsertJobScheduler).toHaveBeenCalledWith(
      PRICE_CALENDAR_FULL_JOB,
      expect.objectContaining({ tz: "UTC" }),
      expect.objectContaining({ name: PRICE_CALENDAR_FULL_JOB })
    );
  });

  it("bilinmeyen iş ve eksik propertyId reddedilir", async () => {
    await expect(processPriceCalendarJob({ name: "x", data: {} })).rejects.toThrow(/Bilinmeyen/);
    await expect(
      processPriceCalendarJob({ name: PRICE_CALENDAR_REFRESH_JOB, data: {} })
    ).rejects.toThrow(/propertyId/);
  });
});
