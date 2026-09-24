import { describe, it, expect, afterEach } from "vitest";
import {
  addDays,
  dayOfWeek,
  DateRangeError,
  monthOf,
  nightsBetween,
  parseIsoDate,
  parseStay,
  type IsoDate,
} from "@/lib/time/nights";
import { daysUntil, getSeasonalFactor } from "@/lib/pricing/engine";

const d = (s: string) => parseIsoDate(s);
const originalTz = process.env.TZ;

afterEach(() => {
  process.env.TZ = originalTz;
});

describe("regression: #20 UTC gece tipi", () => {
  it("gece listesi yarı açık aralık [checkIn, checkOut)", () => {
    expect(nightsBetween(d("2026-12-30"), d("2027-01-02"))).toEqual([
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
    ]);
    expect(addDays(d("2028-02-28"), 1)).toBe("2028-02-29");
  });

  it("geçersiz tarih reddedilir (2026-02-30, biçim hatası)", () => {
    expect(() => parseIsoDate("2026-02-30")).toThrow(DateRangeError);
    expect(() => parseIsoDate("30.01.2026")).toThrow(DateRangeError);
  });

  it("parseStay: geçmiş, ters aralık ve azami gece kuralları", () => {
    const today = d("2026-09-24") as IsoDate;
    expect(parseStay("2026-10-01", "2026-10-03", { maxNights: 30, today }).nights).toHaveLength(2);
    expect(() => parseStay("2026-09-01", "2026-09-03", { maxNights: 30, today })).toThrow(
      /geçmişte/
    );
    expect(() => parseStay("2026-10-03", "2026-10-01", { maxNights: 30, today })).toThrow(/sonra/);
    expect(() => parseStay("2026-10-01", "2026-11-15", { maxNights: 30, today })).toThrow(/30/);
  });

  it("gün/ay UTC'dir (1–12)", () => {
    expect(monthOf(d("2026-06-01"))).toBe(6);
    expect(dayOfWeek(d("2026-09-25"))).toBe(5); // Cuma
  });

  it("fiyat motoru yerel saat diliminden etkilenmez (mevsim ayı)", () => {
    process.env.TZ = "America/Los_Angeles";
    // Yerel getMonth() burada 31 Mayıs derdi (düşük sezon 1.0); UTC ile Haziran → 1.3
    expect(getSeasonalFactor(new Date("2026-06-01T00:00:00.000Z"))).toBe(1.3);
  });

  it("daysUntil UTC takvim günü farkıdır", () => {
    const now = new Date("2026-09-24T23:30:00.000Z");
    expect(daysUntil(new Date("2026-09-25T00:00:00.000Z"), now)).toBe(1);
  });
});
