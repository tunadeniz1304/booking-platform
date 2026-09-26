import { describe, it, expect } from "vitest";
import {
  buildCompareDiff,
  compareFacts,
  demoCommentary,
  freeCancellationHours,
  validateCompareIds,
  type CompareListing,
} from "@/lib/ai/listing-compare";
import { findUngroundedNumbers } from "@/lib/llm/guards";

/** v4 P1-9 karşılaştırma: saf fark hesabı + şablon yorum + sayı guard'ı. */
function listing(over: Partial<CompareListing> & { id: string }): CompareListing {
  return {
    title: `İlan ${over.id}`,
    city: "İstanbul",
    country: "TR",
    propertyType: "HOTEL",
    rating: { avg: 4.2, count: 10 },
    amenities: ["WiFi"],
    cancellation: { kind: "MODERATE", freeCancellationHours: 120 },
    price: {
      available: true,
      total: 250000,
      currency: "TRY",
      nights: 2,
      roomId: "r",
      ratePlanId: "p",
      quoteId: "q",
    },
    ...over,
  };
}

const listings = [
  listing({ id: "a", amenities: ["WiFi", "Havuz"], rating: { avg: 4.6, count: 3 } }),
  listing({
    id: "b",
    amenities: ["WiFi", "Otopark"],
    price: { ...listing({ id: "x" }).price, total: 199900 },
    cancellation: { kind: "FLEXIBLE", freeCancellationHours: 24 },
  }),
  listing({
    id: "c",
    rating: { avg: 4.6, count: 8 },
    price: { ...listing({ id: "x" }).price, available: false, total: null, reason: "UNAVAILABLE" },
  }),
];

describe("buildCompareDiff", () => {
  it("ortak/benzersiz olanaklar, en ucuz, en iyi puan (eşitlikte yorum sayısı), en esnek", () => {
    const diff = buildCompareDiff(listings);
    expect(diff.commonAmenities).toEqual(["WiFi"]);
    expect(diff.uniqueAmenities).toEqual({ a: ["Havuz"], b: ["Otopark"], c: [] });
    expect(diff.cheapestId).toBe("b");
    expect(diff.bestRatedId).toBe("c");
    expect(diff.mostFlexibleId).toBe("b");
  });

  it("farklı para birimlerinde en ucuz seçilmez; puansız ilan en iyi sayılmaz", () => {
    const mixed = [
      listing({ id: "a", rating: { avg: 0, count: 0 } }),
      listing({
        id: "b",
        rating: { avg: 0, count: 0 },
        price: { ...listing({ id: "x" }).price, currency: "EUR" },
      }),
    ];
    const diff = buildCompareDiff(mixed);
    expect(diff.cheapestId).toBeNull();
    expect(diff.bestRatedId).toBeNull();
  });
});

describe("şablon yorum + sayı guard'ı", () => {
  const structured = {
    checkIn: "2026-10-01",
    checkOut: "2026-10-03",
    guests: 2,
    listings,
    diff: buildCompareDiff(listings),
  };

  it("demo yorumu yalnızca yapılandırılmış veriden sayı içerir (TR/EN)", () => {
    const facts = compareFacts(structured);
    for (const locale of ["tr", "en"] as const) {
      const text = demoCommentary(structured, locale);
      expect(text.length).toBeGreaterThan(20);
      expect(findUngroundedNumbers(text, facts)).toEqual([]);
    }
    expect(demoCommentary(structured, "tr")).toContain("İlan b");
    expect(demoCommentary(structured, "tr")).toContain("Havuz");
  });

  it("uydurma sayı yakalanır", () => {
    const facts = compareFacts(structured);
    expect(findUngroundedNumbers("İlan a 1.750 TL daha pahalı", facts)).toEqual(["1.750"]);
    expect(findUngroundedNumbers("İlan b toplam 1.999,00 TL", facts)).toEqual([]);
  });

  it("tarihsiz karşılaştırmada tarih seçme önerisi", () => {
    const noDates = { ...structured, checkIn: null, checkOut: null };
    const unpriced = noDates.listings.map((l) => ({
      ...l,
      price: { ...l.price, available: false, total: null },
    }));
    const s = { ...noDates, listings: unpriced, diff: buildCompareDiff(unpriced) };
    expect(demoCommentary(s, "en")).toContain("Pick check-in");
  });
});

describe("yardımcılar", () => {
  it("tam iadeli en geç iptal saati", () => {
    expect(
      freeCancellationHours([
        { hoursBefore: 120, refundPercent: 100 },
        { hoursBefore: 24, refundPercent: 50 },
      ])
    ).toBe(120);
    expect(freeCancellationHours([{ hoursBefore: 0, refundPercent: 0 }])).toBeNull();
  });

  it("2–4 farklı ilan", () => {
    expect(validateCompareIds(["a", "b", "a"])).toEqual(["a", "b"]);
    expect(() => validateCompareIds(["a", "a"])).toThrow();
    expect(() => validateCompareIds(["a", "b", "c", "d", "e"])).toThrow();
  });
});

describe("rate-limit kategorisi", () => {
  it("karşılaştırma ve öne çıkanlar `ai` kovasında", async () => {
    const { categorize } = await import("@/lib/security/rate-limit");
    expect(categorize("/api/compare")).toBe("ai");
    expect(categorize("/api/properties/p1/review-highlights")).toBe("ai");
    expect(categorize("/api/properties/p1/reviews")).toBe("search");
  });
});
