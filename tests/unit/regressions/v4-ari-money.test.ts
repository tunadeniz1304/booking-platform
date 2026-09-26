import { describe, it, expect } from "vitest";
import { MoneyError, parseMoney } from "@/lib/money/money";
import { ariMessageSchema, ariUpdateSchema } from "@/lib/channel/channel";

describe("regression: v4#19 ARI fiyatı float değil string/minor-unit", () => {
  it("parseMoney: ondalık string → minor-unit, float'a düşmeden", () => {
    expect(parseMoney("1234", "TRY")).toEqual({ amount: 123_400, currency: "TRY" });
    expect(parseMoney("1234.5", "TRY").amount).toBe(123_450);
    expect(parseMoney(" 0.10 ", "USD").amount).toBe(10);
    // 0.1 + 0.2 float hatası string girişte oluşamaz.
    expect(parseMoney("0.3", "EUR").amount).toBe(30);
  });

  it("parseMoney: float artığı, üs, işaret, ayırıcı ve fazla basamak reddedilir", () => {
    for (const bad of [
      String(0.1 + 0.2),
      "1e3",
      "-5",
      "1,234.00",
      "12.345",
      "",
      "abc",
      "1.",
      ".5",
    ]) {
      expect(() => parseMoney(bad, "TRY"), bad).toThrow(MoneyError);
    }
    expect(() => parseMoney(12.5 as unknown as string, "TRY")).toThrow(MoneyError);
  });

  it("ariUpdateSchema: number fiyat reddedilir; string veya priceMinor kabul", () => {
    expect(ariUpdateSchema.safeParse({ date: "2026-10-01", price: 1234.5 }).success).toBe(false);
    expect(ariUpdateSchema.safeParse({ date: "2026-10-01", price: "1234.50" }).success).toBe(true);
    expect(ariUpdateSchema.safeParse({ date: "2026-10-01", priceMinor: 123_450 }).success).toBe(
      true
    );
    expect(ariUpdateSchema.safeParse({ date: "2026-10-01", priceMinor: 1.5 }).success).toBe(false);
    expect(
      ariUpdateSchema.safeParse({ date: "2026-10-01", price: "1", priceMinor: 100 }).success
    ).toBe(false);
    expect(ariUpdateSchema.safeParse({ date: "2026-10-01" }).success).toBe(false);
    expect(ariUpdateSchema.safeParse({ date: "2026-10-01", available: false }).success).toBe(true);
    expect(ariUpdateSchema.safeParse({ date: "2026-10-01", price: "1", extra: true }).success).toBe(
      false
    );
  });

  it("ariMessageSchema: sıra tamsayı, boş güncelleme listesi yok", () => {
    const base = { roomId: "r1", sequence: 1, idempotencyKey: "k", updates: [] };
    expect(ariMessageSchema.safeParse(base).success).toBe(false);
    expect(
      ariMessageSchema.safeParse({
        ...base,
        sequence: 1.5,
        updates: [{ date: "2026-10-01", available: true }],
      }).success
    ).toBe(false);
  });
});
