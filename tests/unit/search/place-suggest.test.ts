// F2-21: yazım hatalı yer adı için "Bunu mu demek istediniz?" önerisi.
import { describe, it, expect } from "vitest";
import { closestPlace, levenshtein } from "@/lib/search/place-suggest";
import { POPULAR_DESTINATIONS } from "@/lib/popular-destinations";

const names = (p: { city: string }) => [p.city];

describe("levenshtein", () => {
  it("temel mesafeleri hesaplar", () => {
    expect(levenshtein("", "abc")).toBe(3);
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(levenshtein("istnbul", "istanbul")).toBe(1);
    expect(levenshtein("roma", "roma")).toBe(0);
  });
});

describe("closestPlace", () => {
  it("Istnbul → İstanbul önerir", () => {
    expect(closestPlace("Istnbul", POPULAR_DESTINATIONS, names)?.city).toBe("İstanbul");
  });

  it("harf yer değişimi: Antalay → Antalya", () => {
    expect(closestPlace("Antalay", POPULAR_DESTINATIONS, names)?.city).toBe("Antalya");
  });

  it("çevrilmiş adla da eşleşir", () => {
    const withLabel = (p: { city: string }) =>
      p.city === "Barselona" ? [p.city, "Barcelona"] : [p.city];
    expect(closestPlace("Barcelna", POPULAR_DESTINATIONS, withLabel)?.city).toBe("Barselona");
  });

  it("tam eşleşmede ve uzak sorguda null döner", () => {
    expect(closestPlace("istanbul", POPULAR_DESTINATIONS, names)).toBeNull();
    expect(closestPlace("Tokyo", POPULAR_DESTINATIONS, names)).toBeNull();
  });

  it("çok kısa sorguda öneri yapmaz", () => {
    expect(closestPlace("Ro", POPULAR_DESTINATIONS, names)).toBeNull();
  });
});
