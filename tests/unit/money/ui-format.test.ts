import { describe, it, expect } from "vitest";
import { formatDate, formatDecimal, formatMinor, isoDay, newIdempotencyKey } from "@/lib/ui/format";
import { formatMoney, money } from "@/lib/money/money";

describe("UI biçimleyicileri (ui/format)", () => {
  it("formatMinor minor-unit tamsayıyı formatMoney ile aynı biçimde gösterir", () => {
    expect(formatMinor(123456, "TRY")).toBe(formatMoney(money(123456, "TRY")));
    expect(formatMinor(123456, "TRY")).toContain("1.234,56");
  });

  it("formatMinor bilinmeyen para biriminde veya tamsayı olmayan tutarda düz metne düşer", () => {
    expect(formatMinor(100, "XYZ")).toBe("100 XYZ");
    expect(formatMinor(1.5, "TRY")).toBe("1.5 TRY");
  });

  it("formatDecimal Prisma Decimal JSON'unu (string/number) biçimler; geçersizde düz metin", () => {
    expect(formatDecimal("1500.00", "TRY")).toBe(formatMoney(money(150000, "TRY")));
    expect(formatDecimal(1500, "TRY")).toBe(formatMoney(money(150000, "TRY")));
    expect(formatDecimal("abc", "TRY")).toBe("abc TRY");
    expect(formatDecimal("10", "XYZ")).toBe("10 XYZ");
  });

  it("formatDate UTC gününü tr-TR biçiminde verir; geçersiz girdiyi aynen döndürür", () => {
    expect(formatDate("2026-09-24T23:30:00.000Z")).toBe("24.09.2026");
    expect(formatDate("geçersiz")).toBe("geçersiz");
  });

  it("isoDay verilen günden ofsetli UTC tarihi üretir (ay/yıl taşması dahil)", () => {
    const from = new Date("2026-12-31T22:00:00.000Z");
    expect(isoDay(0, from)).toBe("2026-12-31");
    expect(isoDay(1, from)).toBe("2027-01-01");
    expect(isoDay(-31, from)).toBe("2026-11-30");
    expect(isoDay()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("newIdempotencyKey her çağrıda benzersiz anahtar üretir", () => {
    const keys = new Set(Array.from({ length: 50 }, () => newIdempotencyKey()));
    expect(keys.size).toBe(50);
  });
});
