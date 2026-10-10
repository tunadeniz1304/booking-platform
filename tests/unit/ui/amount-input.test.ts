import { describe, it, expect } from "vitest";
import { parseAmountToMinor } from "@/lib/ui/amount-input";

describe("parseAmountToMinor — tutar girişi ayrıştırma", () => {
  it.each([
    ["1.250", 125000],
    ["1,250", 125000],
    ["1.250,50", 125050],
    ["1,250.50", 125050],
    ["1250.5", 125050],
    ["1,5", 150],
    ["0,99", 99],
    ["12", 1200],
    ["1.250.000", 125000000],
    ["1.250.000,75", 125000075],
  ])("%s → %d", (input, expected) => {
    expect(parseAmountToMinor(input)).toBe(expected);
  });

  it("para birimi simgelerini ve boşlukları temizler", () => {
    expect(parseAmountToMinor(" 1.250,50 ₺")).toBe(125050);
    expect(parseAmountToMinor("1.250 TL")).toBe(125000);
    expect(parseAmountToMinor("TRY 99")).toBe(9900);
    expect(parseAmountToMinor("$1,250.50")).toBe(125050);
    expect(parseAmountToMinor("€ 12,5")).toBe(1250);
    expect(parseAmountToMinor("12 usd")).toBe(1200);
    expect(parseAmountToMinor("EUR 3")).toBe(300);
  });

  it.each([
    "1.2.3",
    "1.25.0",
    "abc",
    "",
    "   ",
    "-5",
    "12a",
    "1,250.50,5",
    "1.2345,5",
    "12,",
    ",5",
  ])("geçersiz girdi %j → null", (input) => {
    expect(parseAmountToMinor(input)).toBeNull();
  });

  it("fractionDigits'ten fazla ondalık hane → null", () => {
    expect(parseAmountToMinor("1,505")).toBe(150500); // 3 hane → binlik
    expect(parseAmountToMinor("1,5055")).toBeNull();
    expect(parseAmountToMinor("1.25", 0)).toBeNull();
  });

  it("fractionDigits = 3 iken tek ayırıcı + 3 hane ondalık sayılır", () => {
    expect(parseAmountToMinor("1.250", 3)).toBe(1250);
    expect(parseAmountToMinor("1,5", 3)).toBe(1500);
  });

  it("fractionDigits = 0 iken tamsayı birim döner", () => {
    expect(parseAmountToMinor("1.250", 0)).toBe(1250);
    expect(parseAmountToMinor("42", 0)).toBe(42);
  });

  it("baştaki sıfırlar sonucu bozmaz", () => {
    expect(parseAmountToMinor("0,05")).toBe(5);
    expect(parseAmountToMinor("007")).toBe(700);
  });
});
