import { describe, it, expect } from "vitest";
import {
  assertCitationsGrounded,
  assertNumbersGrounded,
  buildFactSet,
  extractCitations,
  findUngroundedNumbers,
  GuardError,
  stripUngroundedSentences,
} from "@/lib/llm/guards";

describe("sayı guard'ı", () => {
  const facts = buildFactSet([3250, 4.37, "2026-05-01", "2 kişi 3 gece"]);

  it("olgulardaki sayılar (TR/EN biçimleri, yuvarlama) kabul edilir", () => {
    expect(findUngroundedNumbers("Toplam 3.250 TL, puan 4,4; 2 kişi 3 gece.", facts)).toEqual([]);
    expect(findUngroundedNumbers("Toplam 3250 TL ve puan 4.37", facts)).toEqual([]);
    expect(findUngroundedNumbers("Giriş 2026-05-01 veya 01.05.2026", facts)).toEqual([]);
  });

  it("uydurma fiyat/tarih yakalanır", () => {
    expect(findUngroundedNumbers("Toplam 2.999 TL", facts)).toEqual(["2.999"]);
    expect(findUngroundedNumbers("Giriş 2026-06-01", facts)).toEqual(["2026-06-01"]);
    expect(() => assertNumbersGrounded("Gecelik 999 TL", facts)).toThrow(GuardError);
  });

  it("takma ad etiketleri ve atıflar sayı sayılmaz", () => {
    expect(findUngroundedNumbers("<KISI_7> dedi [r:abc123]", facts)).toEqual([]);
  });

  it("olgusuz cümleler çıkarılır", () => {
    const res = stripUngroundedSentences("Toplam 3250 TL. İndirim 500 TL. Keyifli!", facts);
    expect(res.text).toBe("Toplam 3250 TL. Keyifli!");
    expect(res.removed).toBe(1);
  });
});

describe("atıf guard'ı", () => {
  it("atıflar çıkarılır ve doğrulanır", () => {
    const cites = extractCitations("Temiz [r:r1], gürültülü [r:r2].");
    expect(cites).toEqual(["r1", "r2"]);
    expect(() => assertCitationsGrounded(cites, ["r1", "r2", "r3"])).not.toThrow();
    expect(() => assertCitationsGrounded(["r9"], ["r1"])).toThrow(GuardError);
  });
});
