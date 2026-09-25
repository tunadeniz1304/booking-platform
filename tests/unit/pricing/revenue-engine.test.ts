import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  demoRevenueExplanation,
  majorString,
  suggestPrice,
  type RevenueParams,
} from "@/lib/pricing/revenue-engine";
import { trHolidayOn } from "@/lib/pricing/tr-holidays";
import { computeKpis, computePickup } from "@/lib/pricing/revenue";
import { assertNumbersGrounded, buildFactSet } from "@/lib/llm/guards";
import { parseIsoDate } from "@/lib/time/nights";

const d = parseIsoDate;

const PARAMS: RevenueParams = {
  floorMultiplier: 0.6,
  ceilingMultiplier: 2,
  occupancyTarget: 0.7,
  occupancyWeight: 0.5,
  lastMinuteDays: 3,
  lastMinuteDiscountBps: 1000,
  holidayUpliftBps: 1500,
  eventFactorPerPoint: 0.1,
};

const sum = (xs: ReadonlyArray<{ amountMinor: number }>) =>
  xs.reduce((s, c) => s + c.amountMinor, 0);

describe("regression: v3#5 gelir paneli öneri motoru", () => {
  it("regression: v3#5 öneri her zaman [taban, tavan] içinde ve katkılar toplamı = öneri − taban", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.double({ min: -1, max: 2, noNaN: false }),
        fc.integer({ min: -5, max: 400 }),
        fc.option(fc.constantFrom("Yılbaşı", "Kurban Bayramı"), { nil: null }),
        fc.array(
          fc.record({
            title: fc.string({ maxLength: 8 }),
            impact: fc.double({ min: -5, max: 50, noNaN: false }),
          }),
          { maxLength: 6 }
        ),
        fc.record({
          floorMultiplier: fc.double({ min: 0, max: 1.5, noNaN: true }),
          ceilingMultiplier: fc.double({ min: 0.5, max: 4, noNaN: true }),
          occupancyWeight: fc.double({ min: 0, max: 5, noNaN: true }),
          lastMinuteDiscountBps: fc.integer({ min: 0, max: 9000 }),
          holidayUpliftBps: fc.integer({ min: 0, max: 20_000 }),
          eventFactorPerPoint: fc.double({ min: 0, max: 1, noNaN: true }),
        }),
        (baseMinor, occupancy, leadDays, holiday, events, p) => {
          const s = suggestPrice(
            { baseMinor, occupancy, leadDays, holiday, events },
            { ...PARAMS, ...p }
          );
          expect(Number.isInteger(s.suggestedMinor)).toBe(true);
          expect(s.floorMinor).toBeLessThanOrEqual(s.baseMinor);
          expect(s.ceilingMinor).toBeGreaterThanOrEqual(s.baseMinor);
          expect(s.suggestedMinor).toBeGreaterThanOrEqual(s.floorMinor);
          expect(s.suggestedMinor).toBeLessThanOrEqual(s.ceilingMinor);
          expect(sum(s.contributions)).toBe(s.suggestedMinor - s.baseMinor);
        }
      ),
      { numRuns: 500 }
    );
  });

  it("hedef dolulukta, tatil/etkinlik yokken fiyat tabanda kalır", () => {
    const s = suggestPrice(
      { baseMinor: 100_000, occupancy: 0.7, leadDays: 30, holiday: null, events: [] },
      PARAMS
    );
    expect(s.suggestedMinor).toBe(100_000);
    expect(s.clamped).toBeNull();
    expect(s.contributions.every((c) => c.amountMinor === 0)).toBe(true);
  });

  it("son dakika indirimi yalnız düşük dolulukta uygulanır", () => {
    const low = suggestPrice(
      { baseMinor: 100_000, occupancy: 0.7, leadDays: 2, holiday: null, events: [] },
      { ...PARAMS, occupancyTarget: 0.8, occupancyWeight: 0 }
    );
    expect(low.contributions.find((c) => c.factor === "lead_time")?.amountMinor).toBe(-10_000);
    const high = suggestPrice(
      { baseMinor: 100_000, occupancy: 0.9, leadDays: 2, holiday: null, events: [] },
      { ...PARAMS, occupancyWeight: 0 }
    );
    expect(high.contributions.find((c) => c.factor === "lead_time")?.amountMinor).toBe(0);
  });

  it("tatil ve onaylı etkinlik katkıları sırayla uygulanır", () => {
    const s = suggestPrice(
      {
        baseMinor: 100_000,
        occupancy: 0.7,
        leadDays: 30,
        holiday: "Cumhuriyet Bayramı",
        events: [{ title: "Konser", impact: 2 }],
      },
      PARAMS
    );
    const by = Object.fromEntries(s.contributions.map((c) => [c.factor, c.amountMinor]));
    expect(by.holiday).toBe(15_000);
    expect(by.event).toBe(23_000); // 115000 × 0.2
    expect(s.suggestedMinor).toBe(138_000);
  });

  it("tavanı aşan öneri kırpılır ve kırpma satırı farkı taşır", () => {
    const s = suggestPrice(
      {
        baseMinor: 100_000,
        occupancy: 1,
        leadDays: 30,
        holiday: "Yılbaşı",
        events: [{ title: "Festival", impact: 20 }],
      },
      PARAMS
    );
    expect(s.clamped).toBe("ceiling");
    expect(s.suggestedMinor).toBe(200_000);
    const clamp = s.contributions.find((c) => c.factor === "clamp")!;
    expect(clamp.amountMinor).toBe(200_000 - s.rawMinor);
  });

  it("trHolidayOn sabit ve dini tatilleri tanır", () => {
    expect(trHolidayOn("2026-10-29")).toBe("Cumhuriyet Bayramı");
    expect(trHolidayOn("2027-01-01")).toBe("Yılbaşı");
    expect(trHolidayOn("2026-05-28")).toBe("Kurban Bayramı");
    expect(trHolidayOn("2026-05-26")).toBeNull();
    expect(trHolidayOn("2026-09-25")).toBeNull();
  });

  it("demo açıklaması yalnız olgulardaki sayıları kullanır", () => {
    const suggestion = suggestPrice(
      {
        baseMinor: 123_456,
        occupancy: 0.83,
        leadDays: 12,
        holiday: "Zafer Bayramı",
        events: [{ title: "Maraton", impact: 1 }],
      },
      PARAMS
    );
    const text = demoRevenueExplanation({
      date: "2026-08-30",
      currency: "TRY",
      currentMinor: 123_456,
      suggestion,
      occupancy: 0.83,
      leadDays: 12,
      holiday: "Zafer Bayramı",
      eventCount: 1,
    });
    expect(text).toContain(majorString(suggestion.suggestedMinor));
    expect(text).toContain("artırılması");
    const facts = buildFactSet([
      "2026-08-30",
      majorString(suggestion.suggestedMinor),
      Math.round(0.83 * 100),
      12,
      1,
    ]);
    expect(() => assertNumbersGrounded(text, facts)).not.toThrow();
  });
});

describe("regression: v3#5 gelir KPI ve pickup", () => {
  it("KPI: pencereye düşen gece oranında gelir, doluluk/ADR/RevPAR", () => {
    const k = computeKpis({
      currency: "TRY",
      from: d("2026-10-01"),
      to: d("2026-10-11"),
      availableRoomNights: 20,
      bookings: [
        // 4 gece, 2'si pencere içinde → 40000'in yarısı
        { checkIn: d("2026-09-29"), checkOut: d("2026-10-03"), totalMinor: 40_000 },
        { checkIn: d("2026-10-05"), checkOut: d("2026-10-08"), totalMinor: 30_000 },
        // pencere dışı
        { checkIn: d("2026-10-20"), checkOut: d("2026-10-22"), totalMinor: 99_999 },
      ],
    });
    expect(k.soldRoomNights).toBe(5);
    expect(k.revenueMinor).toBe(50_000);
    expect(k.occupancy).toBeCloseTo(0.25);
    expect(k.adrMinor).toBe(10_000);
    expect(k.revparMinor).toBe(2_500);
  });

  it("KPI: boş envanterde sıfıra bölme yok", () => {
    const k = computeKpis({
      currency: "TRY",
      from: d("2026-10-01"),
      to: d("2026-10-11"),
      availableRoomNights: 0,
      bookings: [],
    });
    expect(k).toMatchObject({ occupancy: 0, adrMinor: 0, revparMinor: 0 });
  });

  it("pickup: günlük giriş ve kümülatif oda-gece", () => {
    const p = computePickup({
      today: d("2026-09-25"),
      days: 3,
      from: d("2026-09-25"),
      to: d("2026-10-25"),
      bookings: [
        { checkIn: d("2026-10-01"), checkOut: d("2026-10-03"), createdOn: d("2026-09-01") },
        { checkIn: d("2026-10-05"), checkOut: d("2026-10-06"), createdOn: d("2026-09-24") },
        { checkIn: d("2026-10-07"), checkOut: d("2026-10-10"), createdOn: d("2026-09-25") },
      ],
    });
    expect(p).toEqual([
      { date: "2026-09-23", pickup: 0, onBooks: 2 },
      { date: "2026-09-24", pickup: 1, onBooks: 3 },
      { date: "2026-09-25", pickup: 3, onBooks: 6 },
    ]);
  });
});
