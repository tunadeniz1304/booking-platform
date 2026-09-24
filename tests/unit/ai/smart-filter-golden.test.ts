import { describe, it, expect } from "vitest";
import { parseSmartQuery, type SmartFilters } from "@/lib/ai/smart-filter-parser";

const vocab = {
  cities: [
    "İstanbul",
    "Antalya",
    "Bodrum",
    "İzmir",
    "Trabzon",
    "Kapadokya",
    "Ankara",
    "Muğla",
    "Alanya",
    "Çeşme",
    "Kuşadası",
    "Paris",
    "Roma",
    "Barselona",
    "Londra",
  ],
  amenities: [
    "Ücretsiz WiFi",
    "Havuz",
    "Klima",
    "Otopark",
    "Kahvaltı Dahil",
    "Spa & Sauna",
    "Fitness Merkezi",
    "Deniz Manzarası",
    "Evcil Hayvan Dostu",
    "7/24 Resepsiyon",
    "Şehir Merkezi",
    "Oda Servisi",
  ],
};
const today = new Date("2026-09-24T10:00:00Z");

type Expect = Partial<SmartFilters>;
const GOLDEN: Array<[string, Expect]> = [
  [
    "Kadıköy'de denize yakın, kahvaltılı, 2 kişi, gecesi 3000 TL altı",
    {
      city: "İstanbul",
      query: "Kadıköy",
      guests: 2,
      maxPrice: 3000,
      amenities: ["Kahvaltı Dahil", "Deniz Manzarası"],
    },
  ],
  [
    "Antalya'da havuzlu villa, 6 kişi",
    { city: "Antalya", propertyType: "VILLA", guests: 6, amenities: ["Havuz"] },
  ],
  [
    "İzmir'de en ucuz otel",
    { city: "İzmir", propertyType: "HOTEL", sort: "price_asc", amenities: [] },
  ],
  [
    "Bodrum'da deniz manzaralı, spa olan bir yer, en fazla 5000 TL",
    { city: "Bodrum", maxPrice: 5000, amenities: ["Spa & Sauna", "Deniz Manzarası"] },
  ],
  [
    "kapadokyada balayı için 12 temmuz 3 gece",
    { city: "Kapadokya", guests: 2, checkIn: "2027-07-12", checkOut: "2027-07-15", amenities: [] },
  ],
  [
    "Ankara merkezde otoparklı otel 1 kişi",
    { city: "Ankara", guests: 1, propertyType: "HOTEL", amenities: ["Otopark"] },
  ],
  [
    "Paris'te 2 yetişkin wifi ve klima",
    { city: "Paris", guests: 2, amenities: ["Ücretsiz WiFi", "Klima"] },
  ],
  [
    "köpeğimle kalabileceğim bir daire, Çeşme",
    { city: "Çeşme", propertyType: "APARTMENT", amenities: ["Evcil Hayvan Dostu"] },
  ],
  [
    "Roma'da 2 bin TL altı hostel",
    { city: "Roma", maxPrice: 2000, propertyType: "HOSTEL", amenities: [] },
  ],
  [
    "Alanya sahil, 4 kişi, havuz",
    { city: "Alanya", guests: 4, amenities: ["Havuz", "Deniz Manzarası"] },
  ],
  [
    "Trabzon'da pansiyon kahvaltı dahil",
    { city: "Trabzon", propertyType: "BED_AND_BREAKFAST", amenities: ["Kahvaltı Dahil"] },
  ],
  [
    "londra en iyi puanlı otel",
    { city: "Londra", propertyType: "HOTEL", sort: "rating", amenities: [] },
  ],
  [
    "Sultanahmet yakınında 3 kişilik oda, gecesi 4.500 TL'den az",
    { city: "İstanbul", query: "Sultanahmet", guests: 3, maxPrice: 4500, amenities: [] },
  ],
  [
    "Kuşadası fitness ve spa, iki kişi",
    { city: "Kuşadası", guests: 2, amenities: ["Spa & Sauna", "Fitness Merkezi"] },
  ],
  [
    "Barselona'da 5 gece 1 ağustos",
    { city: "Barselona", checkIn: "2027-08-01", checkOut: "2027-08-06", amenities: [] },
  ],
  [
    "Muğla villa en az 10000 TL",
    { city: "Muğla", propertyType: "VILLA", minPrice: 10000, amenities: [] },
  ],
  [
    "İstanbul'da 24 saat resepsiyonlu, oda servisi olan otel",
    { city: "İstanbul", propertyType: "HOTEL", amenities: ["7/24 Resepsiyon", "Oda Servisi"] },
  ],
  [
    "Alsancak'ta tek başıma, uygun fiyatlı",
    { city: "İzmir", query: "Alsancak", guests: 1, sort: "price_asc", amenities: [] },
  ],
  [
    "göreme de 2 kişi 15 ekim 2 gece",
    {
      city: "Kapadokya",
      query: "Göreme",
      guests: 2,
      checkIn: "2026-10-15",
      checkOut: "2026-10-17",
      amenities: [],
    },
  ],
  [
    "Bodrum'da ailece 5 kişi deniz kenarı villa 8 bin TL altında",
    {
      city: "Bodrum",
      guests: 5,
      propertyType: "VILLA",
      maxPrice: 8000,
      amenities: ["Deniz Manzarası"],
    },
  ],
];

function matches(actual: SmartFilters, expected: Expect): boolean {
  for (const [k, v] of Object.entries(expected)) {
    const a = (actual as unknown as Record<string, unknown>)[k];
    if (Array.isArray(v)) {
      if (!Array.isArray(a) || [...a].sort().join("|") !== [...v].sort().join("|")) return false;
    } else if (a !== v) return false;
  }
  return true;
}

describe("P1-1 Smart Filter golden set (demo modu)", () => {
  it("20 cümlelik golden set'te en az 18 doğru", () => {
    const results = GOLDEN.map(([q, e]) => ({
      q,
      ok: matches(parseSmartQuery(q, vocab, today), e),
      got: parseSmartQuery(q, vocab, today),
    }));
    const failed = results.filter((r) => !r.ok);
    if (failed.length > 0) console.warn(JSON.stringify(failed, null, 1));
    expect(results.filter((r) => r.ok).length).toBeGreaterThanOrEqual(18);
  });

  it("bilinmeyen şehir/amenity asla üretilmez", () => {
    const f = parseSmartQuery("Mars'ta jakuzili saray", vocab, today);
    expect(f.city).toBeUndefined();
    expect(f.amenities).toEqual([]);
  });
});
