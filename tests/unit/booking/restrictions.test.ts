import { describe, it, expect } from "vitest";
import {
  checkRestrictions,
  describeViolation,
  type RestrictionRow,
} from "@/lib/booking/restrictions";
import { nightsBetween, type IsoDate } from "@/lib/time/nights";

const d = (s: string) => s as IsoDate;
const stay = (ci: string, co: string) => ({
  checkIn: d(ci),
  checkOut: d(co),
  nights: nightsBetween(d(ci), d(co)),
});
const row = (date: string, over: Partial<RestrictionRow> = {}): RestrictionRow => ({
  date: d(date),
  minStay: null,
  maxStay: null,
  closedToArrival: false,
  closedToDeparture: false,
  stopSell: false,
  ...over,
});

describe("P0-2 satış kısıtları (LOS / CTA / CTD / stop-sell)", () => {
  it("kısıt yoksa null", () => {
    expect(checkRestrictions(stay("2026-10-01", "2026-10-03"), [])).toBeNull();
  });

  it("stop-sell konaklamanın herhangi bir gecesinde engeller; çıkış günü gece değildir", () => {
    const rows = [row("2026-10-02", { stopSell: true })];
    expect(checkRestrictions(stay("2026-10-01", "2026-10-03"), rows)).toEqual({
      code: "STOP_SELL",
      date: "2026-10-02",
    });
    expect(checkRestrictions(stay("2026-10-01", "2026-10-02"), rows)).toBeNull();
  });

  it("min/max konaklama varış gecesinin kısıtına göre", () => {
    const rows = [row("2026-10-09", { minStay: 2, maxStay: 5 }), row("2026-10-10", { minStay: 7 })];
    expect(checkRestrictions(stay("2026-10-09", "2026-10-10"), rows)).toEqual({
      code: "MIN_STAY",
      minStay: 2,
    });
    expect(checkRestrictions(stay("2026-10-09", "2026-10-11"), rows)).toBeNull(); // 10'unun minStay'i etkisiz
    expect(checkRestrictions(stay("2026-10-09", "2026-10-16"), rows)).toEqual({
      code: "MAX_STAY",
      maxStay: 5,
    });
  });

  it("CTA giriş gününde, CTD çıkış gününde", () => {
    expect(
      checkRestrictions(stay("2026-10-01", "2026-10-03"), [
        row("2026-10-01", { closedToArrival: true }),
      ])
    ).toEqual({ code: "CLOSED_TO_ARRIVAL", date: "2026-10-01" });
    expect(
      checkRestrictions(stay("2026-10-01", "2026-10-03"), [
        row("2026-10-03", { closedToDeparture: true }),
      ])
    ).toEqual({ code: "CLOSED_TO_DEPARTURE", date: "2026-10-03" });
    // Aradaki gecenin CTA/CTD'si konaklamayı etkilemez.
    expect(
      checkRestrictions(stay("2026-10-01", "2026-10-04"), [
        row("2026-10-02", { closedToArrival: true, closedToDeparture: true }),
      ])
    ).toBeNull();
  });

  it("Date satırları da kabul edilir; açıklamalar Türkçe", () => {
    const v = checkRestrictions(stay("2026-10-01", "2026-10-02"), [
      { ...row("2026-10-01"), date: new Date("2026-10-01T00:00:00Z"), minStay: 3 },
    ]);
    expect(v).toEqual({ code: "MIN_STAY", minStay: 3 });
    expect(describeViolation(v!)).toContain("en az 3 gece");
    expect(describeViolation({ code: "STOP_SELL", date: d("2026-10-01") })).toContain(
      "satış kapalı"
    );
    expect(describeViolation({ code: "MAX_STAY", maxStay: 2 })).toContain("en fazla 2");
    expect(describeViolation({ code: "CLOSED_TO_ARRIVAL", date: d("2026-10-01") })).toContain(
      "giriş"
    );
    expect(describeViolation({ code: "CLOSED_TO_DEPARTURE", date: d("2026-10-01") })).toContain(
      "çıkış"
    );
  });
});
