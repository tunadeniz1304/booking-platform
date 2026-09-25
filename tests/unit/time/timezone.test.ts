import { describe, it, expect } from "vitest";
import {
  checkInAt,
  checkOutAt,
  clockOf,
  isValidTimeZone,
  localDateOf,
  localInstant,
  todayIn,
  type IsoDate,
} from "@/lib/time/nights";

const d = (s: string) => s as IsoDate;
const hoursBetween = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 3_600_000;

describe("regression: v3#6 tesis saat dilimi (Temporal)", () => {
  it("Tokyo: UTC gün sınırı yerel 09:00 — 'bugün' tesisin takvimine göre", () => {
    // 2026-09-30 23:30 UTC = Tokyo'da 1 Ekim 08:30
    const now = new Date("2026-09-30T23:30:00Z");
    expect(todayIn("Asia/Tokyo", now)).toBe("2026-10-01");
    expect(todayIn("Europe/Istanbul", now)).toBe("2026-10-01"); // 02:30 TR
    expect(todayIn("America/New_York", now)).toBe("2026-09-30"); // 19:30 NY
  });

  it("giriş anı tesis saatinde: İstanbul 15:00 = 12:00Z, Tokyo 15:00 = 06:00Z", () => {
    expect(checkInAt(d("2026-10-10"), clockOf({ timeZone: "Europe/Istanbul" })).toISOString()).toBe(
      "2026-10-10T12:00:00.000Z"
    );
    expect(checkInAt(d("2026-10-10"), clockOf({ timeZone: "Asia/Tokyo" })).toISOString()).toBe(
      "2026-10-10T06:00:00.000Z"
    );
    expect(
      checkOutAt(d("2026-10-12"), clockOf({ timeZone: "America/New_York" })).toISOString()
    ).toBe("2026-10-12T15:00:00.000Z"); // EDT (UTC−4), 11:00 yerel
  });

  it("America/New_York DST başlangıcı (8 Mart 2026): o 'gün' 23 saat sürer", () => {
    const tz = "America/New_York";
    const a = localInstant(d("2026-03-08"), "00:00", tz);
    const b = localInstant(d("2026-03-09"), "00:00", tz);
    expect(hoursBetween(a, b)).toBe(23);
    // Var olmayan 02:30 → "compatible": ileri kaydırılır (03:30 EDT = 07:30Z).
    expect(localInstant(d("2026-03-08"), "02:30", tz).toISOString()).toBe(
      "2026-03-08T07:30:00.000Z"
    );
  });

  it("America/New_York DST bitişi (1 Kasım 2026): o 'gün' 25 saat; belirsiz 01:30 ilk anı seçer", () => {
    const tz = "America/New_York";
    const a = localInstant(d("2026-11-01"), "00:00", tz);
    const b = localInstant(d("2026-11-02"), "00:00", tz);
    expect(hoursBetween(a, b)).toBe(25);
    expect(localInstant(d("2026-11-01"), "01:30", tz).toISOString()).toBe(
      "2026-11-01T05:30:00.000Z" // EDT
    );
  });

  it("iadenin '24 saat kala' penceresi DST geçişinde gerçek saatle ölçülür", () => {
    const clock = clockOf({ timeZone: "America/New_York", checkInTime: "15:00" });
    const checkIn = checkInAt(d("2026-03-08"), clock); // 15:00 EDT = 19:00Z
    const dayBefore = localInstant(d("2026-03-07"), "15:00", clock.timeZone); // 15:00 EST = 20:00Z
    expect(hoursBetween(dayBefore, checkIn)).toBe(23);
  });

  it("localDateOf: bir anın tesis takvimindeki günü", () => {
    const instant = new Date("2026-06-01T20:00:00Z");
    expect(localDateOf(instant, "Asia/Tokyo")).toBe("2026-06-02");
    expect(localDateOf(instant, "America/Los_Angeles")).toBe("2026-06-01");
  });

  it("geçersiz saat dilimi/saat reddedilir; eksik alanlar varsayılana döner", () => {
    expect(isValidTimeZone("Europe/Istanbul")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(() => localInstant(d("2026-01-01"), "25:00", "UTC")).toThrow();
    expect(clockOf({})).toEqual({
      timeZone: "Europe/Istanbul",
      checkInTime: "15:00",
      checkOutTime: "11:00",
    });
  });
});
