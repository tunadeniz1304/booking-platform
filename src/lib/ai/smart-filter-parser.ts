/**
 * Smart Filter — deterministik Türkçe ayrıştırıcı (DEMO modu ve LLM fallback'i).
 *
 * "Kadıköy'de denize yakın, kahvaltılı, 2 kişi, gecesi 3000 TL altı" →
 * { city: "İstanbul", query: "Kadıköy", amenities: ["Deniz Manzarası", "Kahvaltı Dahil"],
 *   guests: 2, maxPrice: 3000 }
 *
 * Yalnızca izinli facet'ler üretilir: şehir `Location` tablosundan, amenity'ler
 * veritabanındaki adlardan, konaklama tipi enum'dan.
 */

export const PROPERTY_TYPES = [
  "HOTEL",
  "APARTMENT",
  "VILLA",
  "HOSTEL",
  "BED_AND_BREAKFAST",
] as const;
export type PropertyTypeCode = (typeof PROPERTY_TYPES)[number];
export const SORTS = ["recommended", "price_asc", "price_desc", "rating"] as const;

export interface SmartFilters {
  city?: string;
  /** İlçe/semt gibi serbest metin (başlık/açıklamada aranır). */
  query?: string;
  guests?: number;
  minPrice?: number;
  maxPrice?: number;
  amenities: string[];
  propertyType?: PropertyTypeCode;
  checkIn?: string;
  checkOut?: string;
  sort?: (typeof SORTS)[number];
}

export interface FacetVocabulary {
  cities: string[];
  amenities: string[];
}

const norm = (s: string) =>
  s.toLocaleLowerCase("tr-TR").replace(/[’'`]/g, "'").replace(/\s+/g, " ").trim();

/** İlçe/semt → şehir (Location tablosunda şehir düzeyi tutulur). */
export const DISTRICTS: Record<string, string> = {
  kadıköy: "İstanbul",
  beşiktaş: "İstanbul",
  beyoğlu: "İstanbul",
  sultanahmet: "İstanbul",
  taksim: "İstanbul",
  üsküdar: "İstanbul",
  şişli: "İstanbul",
  karaköy: "İstanbul",
  alsancak: "İzmir",
  karşıyaka: "İzmir",
  kaleiçi: "Antalya",
  lara: "Antalya",
  konyaaltı: "Antalya",
  göreme: "Kapadokya",
  ürgüp: "Kapadokya",
  yalıkavak: "Bodrum",
  gümbet: "Bodrum",
};

const CITY_ALIASES: Record<string, string> = {
  istanbul: "İstanbul",
  izmir: "İzmir",
  kapadokya: "Kapadokya",
  cappadocia: "Kapadokya",
  barcelona: "Barselona",
  rome: "Roma",
  london: "Londra",
};

const AMENITY_SYNONYMS: Array<[RegExp, string]> = [
  [/kahvalt/, "Kahvaltı Dahil"],
  [/havuz/, "Havuz"],
  [/deniz(e)? (yakın|kenar|manzara|sıfır)|sahil|denize nazır|deniz manzaralı/, "Deniz Manzarası"],
  [/wi-?fi|internet|kablosuz/, "Ücretsiz WiFi"],
  [/klima/, "Klima"],
  [/otopark|park yeri|araç park/, "Otopark"],
  [/spa|sauna|hamam/, "Spa & Sauna"],
  [/fitness|spor salonu|gym/, "Fitness Merkezi"],
  [/evcil|köpe|kedi|hayvan dostu/, "Evcil Hayvan Dostu"],
  [/7\/24|resepsiyon/, "7/24 Resepsiyon"],
  [/şehir merkez|merkezi konum|merkeze yakın/, "Şehir Merkezi"],
  [/oda servis/, "Oda Servisi"],
];

const TYPE_SYNONYMS: Array<[RegExp, PropertyTypeCode]> = [
  [/\bvilla/, "VILLA"],
  [/\bhostel/, "HOSTEL"],
  [/pansiyon|oda kahvaltı|b&b/, "BED_AND_BREAKFAST"],
  [/\bdaire|\bapart|\bev\b|kiralık ev/, "APARTMENT"],
  [/\botel/, "HOTEL"],
];

const WORD_NUMBERS: Record<string, number> = {
  bir: 1,
  tek: 1,
  iki: 2,
  üç: 3,
  dört: 4,
  beş: 5,
  altı: 6,
  yedi: 7,
  sekiz: 8,
  dokuz: 9,
  on: 10,
};

const MONTHS: Record<string, number> = {
  ocak: 1,
  şubat: 2,
  mart: 3,
  nisan: 4,
  mayıs: 5,
  haziran: 6,
  temmuz: 7,
  ağustos: 8,
  eylül: 9,
  ekim: 10,
  kasım: 11,
  aralık: 12,
};

function parseAmount(raw: string, bin?: string): number {
  // "3.500" / "3,500" → 3500 (TR binlik); "1,5 bin" → 1500
  const cleaned = raw.replace(/\./g, "").replace(",", ".");
  const n = Number(cleaned);
  return Math.round(bin ? n * 1000 : n);
}

function numberWord(token: string): number | undefined {
  return /^\d+$/.test(token) ? Number(token) : WORD_NUMBERS[token];
}

function isoDate(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function parseSmartQuery(
  text: string,
  vocab: FacetVocabulary,
  today = new Date()
): SmartFilters {
  const t = norm(text);
  const words = t.split(/[\s,.;!?]+/).filter(Boolean);
  const filters: SmartFilters = { amenities: [] };

  // Şehir: Türkçe ek almış biçimler dahil ("İzmir'de", "antalyada").
  const cityByNorm = new Map(vocab.cities.map((c) => [norm(c), c]));
  for (const [alias, city] of Object.entries(CITY_ALIASES)) {
    if (cityByNorm.has(norm(city))) cityByNorm.set(alias, city);
  }
  const cityKeys = [...cityByNorm.keys()].sort((a, b) => b.length - a.length);
  outer: for (const key of cityKeys) {
    for (const w of words) {
      const base = w.split("'")[0];
      if (
        base === key ||
        (base.startsWith(key) && base.length - key.length <= 4) ||
        (t.includes(`${key} `) && key.includes(" "))
      ) {
        filters.city = cityByNorm.get(key);
        break outer;
      }
    }
  }
  for (const [district, city] of Object.entries(DISTRICTS)) {
    if (words.some((w) => w.split("'")[0].startsWith(district))) {
      filters.query = district.charAt(0).toLocaleUpperCase("tr-TR") + district.slice(1);
      if (!filters.city && cityByNorm.has(norm(city))) filters.city = city;
      break;
    }
  }

  // Misafir sayısı
  const guest =
    /(\d+|bir|tek|iki|üç|dört|beş|altı|yedi|sekiz|dokuz|on)\s*(kişi|yetişkin|misafir)/.exec(t);
  if (guest) filters.guests = numberWord(guest[1]);
  else if (/\b(çift|sevgilimle|eşimle|balayı|ikimiz)\b/.test(t)) filters.guests = 2;
  else if (/\b(yalnız|tek başıma|solo)\b/.test(t)) filters.guests = 1;

  // Fiyat: üst / alt sınır
  const max =
    /(\d[\d.,]*)\s*(bin)?\s*(?:tl|₺|lira|try)?\s*(?:'?(?:nin|den|dan|ten|tan))?\s*(altı|altında|altındaki|az|ucuz|en fazla|max|maksimum)/.exec(
      t
    ) ?? /(?:en fazla|maksimum|max|bütçe(?:m)?)\s*(\d[\d.,]*)\s*(bin)?/.exec(t);
  if (max) filters.maxPrice = parseAmount(max[1], max[2]);
  const min =
    /(?:en az|minimum)\s*(\d[\d.,]*)\s*(bin)?|(\d[\d.,]*)\s*(bin)?\s*(?:tl|₺|lira)?\s*(?:üstü|üzeri|üzerinde)/.exec(
      t
    );
  if (min) filters.minPrice = parseAmount(min[1] ?? min[3], min[2] ?? min[4]);

  for (const [re, amenity] of AMENITY_SYNONYMS) {
    if (re.test(t) && vocab.amenities.includes(amenity) && !filters.amenities.includes(amenity)) {
      filters.amenities.push(amenity);
    }
  }
  for (const [re, type] of TYPE_SYNONYMS) {
    if (re.test(t)) {
      filters.propertyType = type;
      break;
    }
  }

  // Tarih: "12 temmuz" (+ "3 gece")
  const date =
    /(\d{1,2})\s+(ocak|şubat|mart|nisan|mayıs|haziran|temmuz|ağustos|eylül|ekim|kasım|aralık)/.exec(
      t
    );
  const nightsMatch = /(\d+|bir|iki|üç|dört|beş|altı|yedi|sekiz|dokuz|on)\s*gece/.exec(t);
  if (date) {
    const month = MONTHS[date[2]];
    const day = Number(date[1]);
    let year = today.getUTCFullYear();
    if (
      Date.UTC(year, month - 1, day) <
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
    )
      year += 1;
    filters.checkIn = isoDate(year, month, day);
    const nights = nightsMatch ? (numberWord(nightsMatch[1]) ?? 1) : 1;
    const out = new Date(Date.UTC(year, month - 1, day + nights));
    filters.checkOut = out.toISOString().slice(0, 10);
  }

  if (/en ucuz|ucuzdan pahalıya|uygun fiyatlı/.test(t)) filters.sort = "price_asc";
  else if (/en (iyi|yüksek) puan|puanı yüksek|en beğenilen/.test(t)) filters.sort = "rating";

  return filters;
}
