import { PrismaClient, Prisma, PropertyType, UserRole, BookingStatus } from "@prisma/client";
import bcrypt from "bcryptjs";
import { assertSeedAllowed } from "../src/lib/config/seed-guard";

const prisma = new PrismaClient();

const IMAGE_POOL = [
  "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1200&q=80",
  "https://images.unsplash.com/photo-1582719508461-905c673771fd?auto=format&fit=crop&w=1200&q=80",
  "https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=1200&q=80",
  "https://images.unsplash.com/photo-1541432901042-2d8bd64b4a9b?auto=format&fit=crop&w=1200&q=80",
  "https://images.unsplash.com/photo-1587061949409-02df41d5e562?auto=format&fit=crop&w=1200&q=80",
  "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=1200&q=80",
  "https://images.unsplash.com/photo-1445019980597-93fa8acb246c?auto=format&fit=crop&w=1200&q=80",
  "https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?auto=format&fit=crop&w=1200&q=80",
  "https://images.unsplash.com/photo-1571003123894-1f0594d2b5d9?auto=format&fit=crop&w=1200&q=80",
  "https://images.unsplash.com/photo-1540541338287-41700207dee6?auto=format&fit=crop&w=1200&q=80",
  "https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?auto=format&fit=crop&w=1200&q=80",
  "https://images.unsplash.com/photo-1564501049412-61c2a3083791?auto=format&fit=crop&w=1200&q=80",
  "https://images.unsplash.com/photo-1512918728675-ed5a9ecdebfd?auto=format&fit=crop&w=1200&q=80",
  "https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?auto=format&fit=crop&w=1200&q=80",
];

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

const LOCATIONS: Array<{ city: string; country: string; lat: number; lng: number }> = [
  { city: "İstanbul", country: "Türkiye", lat: 41.0082, lng: 28.9784 },
  { city: "Antalya", country: "Türkiye", lat: 36.8969, lng: 30.7133 },
  { city: "Bodrum", country: "Türkiye", lat: 37.0344, lng: 27.4305 },
  { city: "İzmir", country: "Türkiye", lat: 38.4192, lng: 27.1287 },
  { city: "Trabzon", country: "Türkiye", lat: 41.0015, lng: 39.7178 },
  { city: "Kapadokya", country: "Türkiye", lat: 38.6431, lng: 34.8287 },
  { city: "Ankara", country: "Türkiye", lat: 39.9334, lng: 32.8597 },
  { city: "Muğla", country: "Türkiye", lat: 37.2153, lng: 28.3636 },
  { city: "Alanya", country: "Türkiye", lat: 36.5444, lng: 31.9955 },
  { city: "Çeşme", country: "Türkiye", lat: 38.3237, lng: 26.3065 },
  { city: "Kuşadası", country: "Türkiye", lat: 37.8591, lng: 27.2595 },
  { city: "Paris", country: "Fransa", lat: 48.8566, lng: 2.3522 },
  { city: "Roma", country: "İtalya", lat: 41.9028, lng: 12.4964 },
  { city: "Barselona", country: "İspanya", lat: 41.3874, lng: 2.1686 },
  { city: "Amsterdam", country: "Hollanda", lat: 52.3676, lng: 4.9041 },
  { city: "Viyana", country: "Avusturya", lat: 48.2082, lng: 16.3738 },
  { city: "Dubai", country: "BAE", lat: 25.2048, lng: 55.2708 },
  { city: "Londra", country: "Birleşik Krallık", lat: 51.5074, lng: -0.1278 },
  { city: "New York", country: "ABD", lat: 40.7128, lng: -74.006 },
  { city: "Tokyo", country: "Japonya", lat: 35.6762, lng: 139.6503 },
];

const AMENITIES = [
  { name: "Ücretsiz WiFi", icon: "wifi" },
  { name: "Havuz", icon: "pool" },
  { name: "Klima", icon: "snow" },
  { name: "Otopark", icon: "car" },
  { name: "Kahvaltı Dahil", icon: "coffee" },
  { name: "Spa & Sauna", icon: "spa" },
  { name: "Fitness Merkezi", icon: "dumbbell" },
  { name: "Deniz Manzarası", icon: "view" },
  { name: "Evcil Hayvan Dostu", icon: "paw" },
  { name: "7/24 Resepsiyon", icon: "clock" },
  { name: "Şehir Merkezi", icon: "city" },
  { name: "Oda Servisi", icon: "service" },
];

// Talep sinyali için gerçekçi lokal etkinlikler (predictive pricing motoru).
// lokasyon indeksi + bugünden itibaren gün ofsetleri (180 gün ufku içinde).
const DEMAND_EVENTS: Array<{
  loc: number;
  title: string;
  startOff: number;
  endOff: number;
  impact: number;
}> = [
  { loc: 0, title: "İstanbul Caz Festivali", startOff: 18, endOff: 24, impact: 8 },
  { loc: 0, title: "İstanbul Maratonu", startOff: 45, endOff: 46, impact: 6 },
  { loc: 1, title: "Antalya Film Festivali", startOff: 28, endOff: 35, impact: 7 },
  { loc: 1, title: "Antalya Expo Fuarı", startOff: 80, endOff: 88, impact: 6 },
  { loc: 2, title: "Bodrum Yat & Caz Festivali", startOff: 24, endOff: 30, impact: 8 },
  { loc: 2, title: "Bodrum Vintage Rallisi", startOff: 70, endOff: 73, impact: 4 },
  { loc: 5, title: "Kapadokya Balon Şenliği", startOff: 34, endOff: 40, impact: 9 },
  { loc: 7, title: "Muğla Rock Müzik Festivali", startOff: 52, endOff: 56, impact: 6 },
  { loc: 9, title: "Çeşme Müzik Günleri", startOff: 40, endOff: 44, impact: 5 },
  { loc: 12, title: "Barselona Primavera Fest", startOff: 55, endOff: 62, impact: 7 },
  { loc: 12, title: "Barselona Formula E", startOff: 95, endOff: 97, impact: 5 },
  { loc: 16, title: "Dubai Shopping Festival", startOff: 22, endOff: 31, impact: 8 },
  { loc: 18, title: "New York Fashion Week", startOff: 33, endOff: 42, impact: 8 },
  { loc: 18, title: "NYC Maratonu", startOff: 78, endOff: 80, impact: 7 },
  { loc: 19, title: "Tokyo Anime Expo", startOff: 48, endOff: 54, impact: 7 },
  { loc: 19, title: "Sakura Başı Sezonu", startOff: 105, endOff: 130, impact: 6 },
];

const REVIEW_PLANS: Array<{
  g: number;
  title: string;
  off: number;
  nights: number;
  persona: string;
}> = [
  { g: 1, title: "Grand Deluxe Hotel", off: -45, nights: 3, persona: "business" },
  { g: 2, title: "Cave Suite Cappadocia", off: -60, nights: 2, persona: "backpacker" },
  { g: 3, title: "Luxury Bosphorus Suite", off: -30, nights: 4, persona: "honeymoon" },
  { g: 0, title: "Marmaris Bliss Resort", off: -20, nights: 3, persona: "family" },
  { g: 1, title: "Villa Amara", off: -90, nights: 5, persona: "business" },
  { g: 2, title: "Ankara Residence Hotel", off: -15, nights: 2, persona: "backpacker" },
  { g: 3, title: "New York Central Park View", off: -50, nights: 3, persona: "honeymoon" },
  { g: 0, title: "İzmir Alsancak Apart Hotel", off: -25, nights: 4, persona: "family" },
];

/** Mevsimsellik çarpanı (ay indeksi 0-11) — fiyat geçmişi ve yorum sezon notu için. */
function seasonFactor(month: number): number {
  if (month >= 5 && month <= 8) return 1.3;
  if (month === 11 || month === 0) return 1.15;
  return 1.0;
}

/** Determinist sözde-RNG (mulberry32) — seed stabil, her çalıştırmada aynı. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PERSONA_REVIEWS: Record<string, { praise: string[]; nitpick: string[] }> = {
  business: {
    praise: [
      "İş toplantılarım için ideal; konum ve sessizlik mükemmeldi.",
      "WiFi gerçekten hızlıydı, video konferanslarım hiç kesilmedi.",
      "7/24 resepsiyon yoğun programımda çok işime yaradı.",
    ],
    nitpick: ["Erken kahvaltı seçenekleri kısıtlıydı.", "Oda servisi biraz yavaş kaldı."],
  },
  backpacker: {
    praise: [
      "Bütçem için mükemmel değer; temiz ve konumu harika.",
      "Her yere yürüyerek ulaştım, fiyata göre paha biçilmez.",
      "Basit ama işlevsel; fazlasını istemezseniz birebir.",
    ],
    nitpick: ["Dekor biraz eski ama fiyata göre gayet değer."],
  },
  honeymoon: {
    praise: [
      "Manzara inanılmazdı, gün batımını odadan izledik.",
      "Romantik akşam yemeği ve özel dokunuşlar unutulmazdı.",
      "Yıldönümümüzü kutladıkları için çok memnunuz.",
    ],
    nitpick: ["Spa için önceden rezervasyon gerek, yoğun oluyor."],
  },
  family: {
    praise: [
      "Çocuklarla gelmek için çok uygun; geniş oda ve güvenli alan.",
      "Havuz temiz ve bakımlıydı, çocuklar bayıldı.",
      "Kahvaltı çeşitliliği ailecek bizi mutlu etti.",
    ],
    nitpick: ["Asansör yoğun saatlerde bekletiyor."],
  },
  vegan: {
    praise: [
      "Bitkisel kahvaltı seçenekleri düşünülmüş; yulaf sütü ve meyve boldu.",
      "Tercihimi önceden not almışlardı, kendimi özel hissettim.",
    ],
    nitpick: ["Akşam menüsünde vegan ana yemek çeşidi azdı."],
  },
};

const REVIEW_NOISE = [
  "Resepsiyon ilgili ve güler yüzlüydü.",
  "Oda temizdi, yatak rahattı.",
  "Çevrede ulaşım kolaydı.",
  "Fiyat/performans dengesi iyiydi.",
];

type ReviewCtx = {
  title: string;
  propertyType: string;
  city: string;
  amenities: string[];
  basePrice: number;
};

/** Kişilik + mevsim + olanaklarla bağlamsal (NLP-tarzı) Türkçe yorum üretir. */
function composeReview(
  ctx: ReviewCtx,
  persona: string,
  month: number,
  rng: () => number
): { rating: number; comment: string } {
  const bank = PERSONA_REVIEWS[persona] ?? PERSONA_REVIEWS.backpacker;
  const praise = bank.praise[Math.floor(rng() * bank.praise.length)];
  const nitpick = bank.nitpick[Math.floor(rng() * bank.nitpick.length)];

  let seasonNote = "Yaz döneminde yoğundu ama konaklama keyifliydi.";
  if (month >= 11 || month <= 1) seasonNote = "Kış döneminde geldik, sakin ve huzurluydu.";
  else if (month >= 2 && month <= 4) seasonNote = "Ara sezonda geldik; fiyatlar daha uygundu.";

  const amenity =
    ctx.amenities.length > 0 ? `Olanaklardan ${ctx.amenities[0]} özellikle işimize yaradı. ` : "";
  const noise = REVIEW_NOISE[Math.floor(rng() * REVIEW_NOISE.length)];
  const comment = `${praise} ${seasonNote} ${noise} ${amenity}${nitpick}`;
  const rating = Math.min(10, 8 + Math.floor(rng() * 2.6));
  return { rating, comment };
}

/** Lokasyon → IANA saat dilimi (ADR 0011). */
const TIME_ZONES: Record<string, string> = {
  Paris: "Europe/Paris",
  Roma: "Europe/Rome",
  Barselona: "Europe/Madrid",
  Amsterdam: "Europe/Amsterdam",
  Viyana: "Europe/Vienna",
  Dubai: "Asia/Dubai",
  Londra: "Europe/London",
  "New York": "America/New_York",
  Tokyo: "Asia/Tokyo",
};

/** Oda tipi başına oda adedi: oteller/hosteller çok birimli, villa/daire tek birim. */
function unitsFor(type: string, priceModifier: number): number {
  if (type === "HOTEL") return priceModifier === 0 ? 8 : priceModifier < 1500 ? 4 : 2;
  if (type === "HOSTEL") return 10;
  if (type === "BED_AND_BREAKFAST") return 3;
  return 1;
}

/** Fiyat planları: standart (iade edilebilir), iade edilemez −%10, otel/pansiyonda kahvaltılı +%12. */
function ratePlansFor(type: string) {
  const plans: Array<{
    code: string;
    name: string;
    refundable: boolean;
    priceModifierBps: number;
    isDefault: boolean;
    mealPlan?: "BREAKFAST";
  }> = [
    { code: "STANDARD", name: "Standart", refundable: true, priceModifierBps: 0, isDefault: true },
    {
      code: "NONREF",
      name: "İade edilemez",
      refundable: false,
      priceModifierBps: -1000,
      isDefault: false,
    },
  ];
  if (type === "HOTEL" || type === "BED_AND_BREAKFAST") {
    plans.push({
      code: "BREAKFAST",
      name: "Kahvaltı dahil",
      refundable: true,
      priceModifierBps: 1200,
      isDefault: false,
      mealPlan: "BREAKFAST",
    });
  }
  return plans;
}

type PropSeed = {
  title: string;
  description: string;
  type: keyof typeof PropertyType;
  loc: number;
  basePrice: number;
  ratingAvg: number;
  ratingCount: number;
  amenities: number[];
  rooms: Array<{ name: string; capacity: number; bedType: string; priceModifier: number }>;
};

const PROPERTIES: PropSeed[] = [
  {
    title: "Grand Deluxe Hotel",
    description:
      "Tarihi yarımadaya 5 dakika mesafede, boğaz manzaralı lüks otel. Ücretsiz spa, kapalı havuz ve gurme restoran.",
    type: "HOTEL",
    loc: 0,
    basePrice: 2450,
    ratingAvg: 8.9,
    ratingCount: 1240,
    amenities: [0, 1, 2, 4, 5, 6, 7, 9],
    rooms: [
      { name: "Standart Oda", capacity: 2, bedType: "Çift Kişilik Yatak", priceModifier: 0 },
      { name: "Deluxe Boğaz Manzaralı", capacity: 3, bedType: "Kral Yatak", priceModifier: 1200 },
      { name: "Süit", capacity: 4, bedType: "2 Çift Kişilik Yatak", priceModifier: 2600 },
    ],
  },
  {
    title: "Villa Amara",
    description:
      "Özel yüzme havuzu, bahçe ve deniz manzarasıyla Bodrum'un kalbinde bütün villa. Kalabalık aileler için ideal.",
    type: "VILLA",
    loc: 2,
    basePrice: 5200,
    ratingAvg: 9.4,
    ratingCount: 386,
    amenities: [0, 1, 2, 3, 6, 7],
    rooms: [{ name: "Tüm Villa", capacity: 8, bedType: "4 Yatak Odası", priceModifier: 0 }],
  },
  {
    title: "Sunset Beach Resort",
    description:
      "Antalya'nın ünlü plajlarına sıfır, her şey dahil konseptli resort. Çocuk kulübü ve açık havuzlar.",
    type: "HOTEL",
    loc: 1,
    basePrice: 3100,
    ratingAvg: 8.7,
    ratingCount: 892,
    amenities: [0, 1, 2, 3, 4, 6, 7, 9],
    rooms: [
      { name: "Standart Oda", capacity: 2, bedType: "Çift Kişilik Yatak", priceModifier: 0 },
      { name: "Deniz Manzaralı", capacity: 3, bedType: "Kral Yatak", priceModifier: 900 },
      { name: "Aile Odası", capacity: 5, bedType: "2 Çift Kişilik Yatak", priceModifier: 1500 },
    ],
  },
  {
    title: "City Center Apart",
    description:
      "İzmir şehir merkezinde, Kordon'a 10 dakika yürüme mesafesinde modern apart. Mutfak ve çamaşır makinesi mevcut.",
    type: "APARTMENT",
    loc: 3,
    basePrice: 1200,
    ratingAvg: 8.2,
    ratingCount: 210,
    amenities: [0, 2, 3, 8],
    rooms: [
      { name: "1+1 Apart", capacity: 2, bedType: "Çift Kişilik Yatak", priceModifier: 0 },
      { name: "2+1 Apart", capacity: 4, bedType: "2 Çift Kişilik Yatak", priceModifier: 700 },
    ],
  },
  {
    title: "Mountain View Lodge",
    description:
      "Karadeniz'in eşsiz doğasında, yayla manzaralı butik pansiyon. Ev yapımı kahvaltı dahil.",
    type: "BED_AND_BREAKFAST",
    loc: 4,
    basePrice: 1800,
    ratingAvg: 9.1,
    ratingCount: 154,
    amenities: [0, 2, 4, 8],
    rooms: [
      { name: "Standart Oda", capacity: 2, bedType: "Çift Kişilik Yatak", priceModifier: 0 },
      { name: "Aile Odası", capacity: 4, bedType: "2 Çift Kişilik Yatak", priceModifier: 800 },
    ],
  },
  {
    title: "Cave Suite Cappadocia",
    description:
      "Peribacaları manzaralı, gerçek kaya oyma mağara süit. Balon turu organize edilir.",
    type: "HOTEL",
    loc: 5,
    basePrice: 4100,
    ratingAvg: 9.6,
    ratingCount: 98,
    amenities: [0, 2, 4, 7, 9],
    rooms: [
      { name: "Mağara Süit", capacity: 2, bedType: "Kral Yatak", priceModifier: 0 },
      {
        name: "Aile Mağara Süit",
        capacity: 4,
        bedType: "2 Çift Kişilik Yatak",
        priceModifier: 1600,
      },
    ],
  },
  {
    title: "Luxury Bosphorus Suite",
    description: "Boğaz'a tam cephe, özel balkonlu lüks apart. Şehrin en prestijli semtinde.",
    type: "APARTMENT",
    loc: 0,
    basePrice: 6800,
    ratingAvg: 9.2,
    ratingCount: 76,
    amenities: [0, 2, 5, 6, 7],
    rooms: [{ name: "Boğaz Manzaralı Süit", capacity: 2, bedType: "Kral Yatak", priceModifier: 0 }],
  },
  {
    title: "Old Town Boutique Hotel",
    description:
      "Kaleiçi'nin tarihi dokusunda, restore edilmiş butik otel. Avlulu bahçede kahvaltı.",
    type: "BED_AND_BREAKFAST",
    loc: 1,
    basePrice: 2100,
    ratingAvg: 8.8,
    ratingCount: 320,
    amenities: [0, 2, 4, 9],
    rooms: [
      { name: "Standart Oda", capacity: 2, bedType: "Çift Kişilik Yatak", priceModifier: 0 },
      { name: "Deluxe Bahçe Odası", capacity: 2, bedType: "Kral Yatak", priceModifier: 500 },
    ],
  },
  {
    title: "Marina View Hostel",
    description:
      "Bodrum marinaya yürüme mesafesinde, sosyal ortam arayan gezginler için modern hostel.",
    type: "HOSTEL",
    loc: 2,
    basePrice: 650,
    ratingAvg: 8.4,
    ratingCount: 512,
    amenities: [0, 3, 9],
    rooms: [
      { name: "4 Kişilik Yatakhane", capacity: 4, bedType: "Ranza", priceModifier: 0 },
      { name: "Özel Oda", capacity: 2, bedType: "Çift Kişilik Yatak", priceModifier: 450 },
    ],
  },
  {
    title: "Green Valley Farmstay",
    description: "Trabzon yaylalarında organik çiftlik konaklaması. Kemankeş şelalesine yakın.",
    type: "VILLA",
    loc: 4,
    basePrice: 2600,
    ratingAvg: 9.3,
    ratingCount: 145,
    amenities: [0, 2, 4, 8, 3],
    rooms: [{ name: "Tüm Çiftlik Evi", capacity: 6, bedType: "3 Yatak Odası", priceModifier: 0 }],
  },

  {
    title: "Ankara Residence Hotel",
    description:
      "Ankara'nın iş merkezinde, toplantı salonları ve uzun konaklama odalarıyla iş seyahatçileri için ideal otel.",
    type: "HOTEL",
    loc: 6,
    basePrice: 1450,
    ratingAvg: 8.0,
    ratingCount: 640,
    amenities: [0, 2, 3, 6, 10, 11],
    rooms: [
      { name: "Standart Oda", capacity: 2, bedType: "Çift Kişilik Yatak", priceModifier: 0 },
      { name: "Executive Oda", capacity: 2, bedType: "Kral Yatak", priceModifier: 600 },
      { name: "Junior Süit", capacity: 3, bedType: "Kral Yatak", priceModifier: 1100 },
    ],
  },
  {
    title: "Göcek Yacht Marina Suites",
    description:
      "Akyaka koyundan her şeye kolay erişimle Muğla'nın marina manzaralı süitleri. Tekne turu düzenlenir.",
    type: "APARTMENT",
    loc: 7,
    basePrice: 2900,
    ratingAvg: 8.9,
    ratingCount: 190,
    amenities: [0, 1, 2, 7, 10],
    rooms: [
      { name: "Marina Süit", capacity: 2, bedType: "Çift Kişilik Yatak", priceModifier: 0 },
      { name: "Panorama Süit", capacity: 4, bedType: "2 Çift Kişilik Yatak", priceModifier: 1400 },
    ],
  },
  {
    title: "Alanya Beach Club",
    description:
      "Kızılkule manzaralı, özel plaj şezlongları ve günlük eğlence programıyla aile dostu resort.",
    type: "HOTEL",
    loc: 8,
    basePrice: 2750,
    ratingAvg: 8.5,
    ratingCount: 720,
    amenities: [0, 1, 2, 3, 4, 7, 9],
    rooms: [
      { name: "Standart Oda", capacity: 2, bedType: "Çift Kişilik Yatak", priceModifier: 0 },
      { name: "Deniz Manzaralı", capacity: 3, bedType: "Kral Yatak", priceModifier: 1000 },
      { name: "Aile Süit", capacity: 5, bedType: "2 Çift Kişilik Yatak", priceModifier: 1700 },
    ],
  },
  {
    title: "Çeşme SPA & Wellness Resort",
    description:
      "Ilıca plajına 25 metre, termal havuzları ve award-winning spa'sıyla huzur dolu bir kaçış.",
    type: "HOTEL",
    loc: 9,
    basePrice: 3400,
    ratingAvg: 9.0,
    ratingCount: 410,
    amenities: [0, 1, 2, 4, 5, 6, 7, 9],
    rooms: [
      { name: "Standart Oda", capacity: 2, bedType: "Çift Kişilik Yatak", priceModifier: 0 },
      { name: "Deluxe Deniz Manzaralı", capacity: 3, bedType: "Kral Yatak", priceModifier: 1200 },
    ],
  },
  {
    title: "Kuşadası Crystal Bay Hotel",
    description:
      "Ladies Beach'e yürüme mesafesinde, çocuklu aileler için animasyon ve mini kulüplü tatil köyü.",
    type: "HOTEL",
    loc: 10,
    basePrice: 2350,
    ratingAvg: 8.3,
    ratingCount: 560,
    amenities: [0, 1, 2, 3, 4, 9],
    rooms: [
      { name: "Standart Oda", capacity: 2, bedType: "Çift Kişilik Yatak", priceModifier: 0 },
      { name: "Aile Odası", capacity: 5, bedType: "2 Çift Kişilik Yatak", priceModifier: 1300 },
    ],
  },
  {
    title: "Hôtel Lumière Paris",
    description:
      "Eiffel Kulesi'ne 10 dakikalık yürüyüş, Haussmann mimarisi ve butik şıklık. Şampanya barıyla ünlü.",
    type: "HOTEL",
    loc: 11,
    basePrice: 420,
    ratingAvg: 9.1,
    ratingCount: 830,
    amenities: [0, 2, 9, 10, 11],
    rooms: [
      { name: "Classic Oda", capacity: 2, bedType: "Çift Kişilik Yatak", priceModifier: 0 },
      { name: "Kule Manzaralı", capacity: 3, bedType: "Kral Yatak", priceModifier: 180 },
      { name: "Süit", capacity: 4, bedType: "Kral Yatak", priceModifier: 320 },
    ],
  },
  {
    title: "Roma Colosseum Nest",
    description:
      "Kolezyum'a 3 dakika, tarihi merkezde restore edilmiş daireler. Mutfak ve asansör mevcut.",
    type: "APARTMENT",
    loc: 12,
    basePrice: 290,
    ratingAvg: 9.0,
    ratingCount: 470,
    amenities: [0, 2, 10, 11],
    rooms: [
      { name: "1+1 Daire", capacity: 2, bedType: "Çift Kişilik Yatak", priceModifier: 0 },
      { name: "2+1 Aile Dairesi", capacity: 5, bedType: "3 Tek Kişilik Yatak", priceModifier: 120 },
    ],
  },
  {
    title: "Barcelona Beachfront Hotel",
    description:
      "Barceloneta plajına sıfır, çatı terası havuzu ve deniz manzaralı odalarla Akdeniz keyfi.",
    type: "HOTEL",
    loc: 13,
    basePrice: 310,
    ratingAvg: 8.8,
    ratingCount: 1560,
    amenities: [0, 1, 2, 4, 7, 9, 10],
    rooms: [
      { name: "Standart Oda", capacity: 2, bedType: "Çift Kişilik Yatak", priceModifier: 0 },
      { name: "Deniz Manzaralı", capacity: 3, bedType: "Kral Yatak", priceModifier: 140 },
      { name: "Junior Süit", capacity: 4, bedType: "Kral Yatak", priceModifier: 260 },
    ],
  },
  {
    title: "Amsterdam Canal House",
    description:
      "Jordaan'daki kanal evinde, bisiklet kiralama ve seramik atölyesi. Şehir merkezine yürüyüşle 5 dakika.",
    type: "BED_AND_BREAKFAST",
    loc: 14,
    basePrice: 260,
    ratingAvg: 9.3,
    ratingCount: 210,
    amenities: [0, 4, 10],
    rooms: [
      { name: "Kanal Oda", capacity: 2, bedType: "Çift Kişilik Yatak", priceModifier: 0 },
      { name: "Aile Oda", capacity: 4, bedType: "Çift Kişilik Yatak", priceModifier: 90 },
    ],
  },

  {
    title: "Viyana Opera Residence",
    description:
      "Devlet Operası karşısında, tarihi bir sarayın dairelerinde. Müzikseverler için yürüyüşle 2 dakika konser salonlarına.",
    type: "APARTMENT",
    loc: 15,
    basePrice: 230,
    ratingAvg: 8.7,
    ratingCount: 330,
    amenities: [0, 2, 10, 11],
    rooms: [
      { name: "Saray Dairesi", capacity: 3, bedType: "Çift Kişilik Yatak", priceModifier: 0 },
      { name: "Aile Apartmanı", capacity: 6, bedType: "2 Çift Kişilik Yatak", priceModifier: 150 },
    ],
  },
  {
    title: "Dubai Marina Skyline Hotel",
    description:
      "Marina manzaralı yüksek katlarda, sonsuzluk havuzu ve gökdelenlerin gölgesinde zarif konaklama.",
    type: "HOTEL",
    loc: 16,
    basePrice: 380,
    ratingAvg: 9.2,
    ratingCount: 2140,
    amenities: [0, 1, 2, 5, 6, 7, 9],
    rooms: [
      { name: "Marina Oda", capacity: 2, bedType: "Kral Yatak", priceModifier: 0 },
      { name: "Gökdelen Manzaralı", capacity: 3, bedType: "Kral Yatak", priceModifier: 160 },
      { name: "Executive Süit", capacity: 4, bedType: "Kral Yatak", priceModifier: 340 },
    ],
  },
  {
    title: "London Camden Loft",
    description:
      "Camden Market'in kalbindeki endüstriyel loft. Canlı müzik mekanlarına yürüme mesafesi.",
    type: "APARTMENT",
    loc: 17,
    basePrice: 340,
    ratingAvg: 8.5,
    ratingCount: 480,
    amenities: [0, 2, 10],
    rooms: [
      { name: "Loft", capacity: 2, bedType: "Çift Kişilik Yatak", priceModifier: 0 },
      { name: "Büyük Loft", capacity: 4, bedType: "2 Çift Kişilik Yatak", priceModifier: 140 },
    ],
  },
  {
    title: "New York Central Park View",
    description:
      "Central Park South'ta, Manhattan silüeti ve park manzaralı lüks odalar. Amanhattan'ın kalbi.",
    type: "HOTEL",
    loc: 18,
    basePrice: 520,
    ratingAvg: 9.4,
    ratingCount: 1820,
    amenities: [0, 2, 5, 6, 7, 9, 10],
    rooms: [
      { name: "City Oda", capacity: 2, bedType: "Kral Yatak", priceModifier: 0 },
      { name: "Park Manzaralı", capacity: 3, bedType: "Kral Yatak", priceModifier: 240 },
      { name: "Corner Süit", capacity: 4, bedType: "2 Kral Yatak", priceModifier: 420 },
    ],
  },
  {
    title: "Tokyo Shibuya Capsule+",
    description:
      "Shibuya'nın ortasında yüksek teknolojili kapsül hostel. Gökdelen barlarına 5 dakika.",
    type: "HOSTEL",
    loc: 19,
    basePrice: 90,
    ratingAvg: 8.6,
    ratingCount: 980,
    amenities: [0, 3, 9, 10],
    rooms: [
      { name: "Kapsül (erkek)", capacity: 1, bedType: "Tek Kişilik Kapsül", priceModifier: 0 },
      { name: "Kapsül (kadın)", capacity: 1, bedType: "Tek Kişilik Kapsül", priceModifier: 0 },
      { name: "Özel Kabin", capacity: 2, bedType: "Çift Kişilik Yatak", priceModifier: 60 },
    ],
  },
  {
    title: "İstanbul Galata Loft Suites",
    description:
      "Galata Kulesi'nin gölgesinde, tasarım loft daireler. Tünel ve Karaköy'e yürüyüşle 3 dakika.",
    type: "APARTMENT",
    loc: 0,
    basePrice: 2100,
    ratingAvg: 8.8,
    ratingCount: 260,
    amenities: [0, 2, 5, 10, 11],
    rooms: [
      { name: "Loft", capacity: 2, bedType: "Çift Kişilik Yatak", priceModifier: 0 },
      { name: "Terash Loft", capacity: 3, bedType: "Kral Yatak", priceModifier: 700 },
    ],
  },
  {
    title: "Antalya Lara Family Resort",
    description:
      "Lara plajında ultra her şey dahil aile resort. Su kaydıraklı büyük havuz ve çocuk kulübü.",
    type: "HOTEL",
    loc: 1,
    basePrice: 3600,
    ratingAvg: 8.9,
    ratingCount: 1340,
    amenities: [0, 1, 2, 3, 4, 6, 9],
    rooms: [
      { name: "Standart Oda", capacity: 2, bedType: "Çift Kişilik Yatak", priceModifier: 0 },
      {
        name: "Aile Odası Havuz Manz.",
        capacity: 5,
        bedType: "2 Çift Kişilik Yatak",
        priceModifier: 1400,
      },
    ],
  },
  {
    title: "Bodrum Marina Boutique",
    description:
      "Milta Marina karşısında butik otel. Yat sahiplerine özel servis ve özel plaj üyeliği.",
    type: "BED_AND_BREAKFAST",
    loc: 2,
    basePrice: 3900,
    ratingAvg: 9.5,
    ratingCount: 180,
    amenities: [0, 1, 2, 4, 7, 9],
    rooms: [
      { name: "Marina Manzaralı", capacity: 2, bedType: "Kral Yatak", priceModifier: 0 },
      { name: "Deluxe Süit", capacity: 3, bedType: "Kral Yatak", priceModifier: 1800 },
    ],
  },
  {
    title: "Kapadokya Sultan Cave Hotel",
    description:
      "Göreme manzaralı kaya oyma odalar, balon keyfi için özel teras. Tarihi taş dokusu.",
    type: "BED_AND_BREAKFAST",
    loc: 5,
    basePrice: 3200,
    ratingAvg: 9.7,
    ratingCount: 220,
    amenities: [0, 2, 4, 7, 9],
    rooms: [
      { name: "Kaya Oda", capacity: 2, bedType: "Kral Yatak", priceModifier: 0 },
      { name: "Manzaralı Kaya Süit", capacity: 3, bedType: "Kral Yatak", priceModifier: 1100 },
    ],
  },

  {
    title: "İzmir Alsancak Apart Hotel",
    description:
      "Kıbrıs Şehitleri Caddesi üzerinde, servisli apart odalar. Sahile 8 dakika yürüyüş.",
    type: "APARTMENT",
    loc: 3,
    basePrice: 1500,
    ratingAvg: 8.4,
    ratingCount: 300,
    amenities: [0, 2, 3, 8, 10],
    rooms: [
      { name: "Deluxe Oda", capacity: 2, bedType: "Çift Kişilik Yatak", priceModifier: 0 },
      {
        name: "İki Yatak Odalı Apart",
        capacity: 5,
        bedType: "2 Çift Kişilik Yatak",
        priceModifier: 800,
      },
    ],
  },
  {
    title: "Trabzon Uzungöl Country House",
    description: "Uzungöl manzarasına bakan ahşap kır evi. Doğa yürüyüşleri ve tekne turu yakında.",
    type: "VILLA",
    loc: 4,
    basePrice: 2300,
    ratingAvg: 9.0,
    ratingCount: 120,
    amenities: [0, 2, 4, 8],
    rooms: [{ name: "Tüm Ev", capacity: 6, bedType: "3 Yatak Odası", priceModifier: 0 }],
  },
  {
    title: "Paris Latin Quarter Hotel",
    description:
      "Notre-Dame ve Panthéon arasında, edebi kahveleriyle ünlü mahallede şık butik otel.",
    type: "HOTEL",
    loc: 11,
    basePrice: 350,
    ratingAvg: 8.9,
    ratingCount: 1240,
    amenities: [0, 2, 4, 10, 11],
    rooms: [
      { name: "Chambre Classique", capacity: 2, bedType: "Çift Kişilik Yatak", priceModifier: 0 },
      { name: "Chambre Prestige", capacity: 3, bedType: "Kral Yatak", priceModifier: 130 },
    ],
  },
  {
    title: "İstanbul Sultanahmet Pansiyon",
    description:
      "Ayasofya'ya 2 dakika mesafede, geleneksel Osmanlı evi pansiyonu. Çatı terasında kahvaltı.",
    type: "BED_AND_BREAKFAST",
    loc: 0,
    basePrice: 1600,
    ratingAvg: 8.6,
    ratingCount: 540,
    amenities: [0, 4, 10, 11],
    rooms: [
      { name: "Standart Oda", capacity: 2, bedType: "Çift Kişilik Yatak", priceModifier: 0 },
      { name: "Terash Manzaralı", capacity: 2, bedType: "Kral Yatak", priceModifier: 500 },
    ],
  },
  {
    title: "Barselona Gothic Stay",
    description:
      "Gotik Mahalle'nin dar sokaklarında tasarım apart. Plaj ve şehir merkezi arasında.",
    type: "APARTMENT",
    loc: 13,
    basePrice: 250,
    ratingAvg: 8.3,
    ratingCount: 610,
    amenities: [0, 2, 10],
    rooms: [{ name: "Stüdyo", capacity: 2, bedType: "Çift Kişilik Yatak", priceModifier: 0 }],
  },
  {
    title: "Alanya Kleopatra Beach Hotel",
    description:
      "Kleopatra Plajı'na cephe, direkt plaj erişimi ve gün batımı terası. Aileler için uygun.",
    type: "HOTEL",
    loc: 8,
    basePrice: 2050,
    ratingAvg: 8.1,
    ratingCount: 890,
    amenities: [0, 1, 2, 3, 4, 9],
    rooms: [
      { name: "Standart Oda", capacity: 2, bedType: "Çift Kişilik Yatak", priceModifier: 0 },
      { name: "Deniz Manzaralı", capacity: 3, bedType: "Kral Yatak", priceModifier: 900 },
    ],
  },
  {
    title: "Roma Trastevere Rooms",
    description:
      "Trastevere'nin samimi sokaklarında, su anda popüler restoranların ortasında rahat odalar.",
    type: "BED_AND_BREAKFAST",
    loc: 12,
    basePrice: 180,
    ratingAvg: 8.8,
    ratingCount: 350,
    amenities: [0, 4, 10],
    rooms: [
      { name: "Standart Oda", capacity: 2, bedType: "Çift Kişilik Yatak", priceModifier: 0 },
      { name: "Aile Odası", capacity: 4, bedType: "Çift Kişilik Yatak", priceModifier: 70 },
    ],
  },
  {
    title: "Dubai Downtown Sky Suites",
    description:
      "Burj Khalifa manzarasına yürüme mesafesinde, servisli süitler. Dubai Mall 10 dakika.",
    type: "APARTMENT",
    loc: 16,
    basePrice: 310,
    ratingAvg: 9.1,
    ratingCount: 720,
    amenities: [0, 1, 2, 5, 6, 7, 10],
    rooms: [
      { name: "Süit", capacity: 3, bedType: "Kral Yatak", priceModifier: 0 },
      { name: "Panorama Süit", capacity: 5, bedType: "2 Kral Yatak", priceModifier: 200 },
    ],
  },
  {
    title: "Kapadokya Balon View Hostel",
    description: "Bütçe dostu hostel; güneş doğuşunda balon manzarası teras kahvaltısıyla başlar.",
    type: "HOSTEL",
    loc: 5,
    basePrice: 700,
    ratingAvg: 8.5,
    ratingCount: 480,
    amenities: [0, 3, 9],
    rooms: [
      { name: "6 Kişilik Yatakhane", capacity: 6, bedType: "Ranza", priceModifier: 0 },
      { name: "Özel Oda", capacity: 2, bedType: "Çift Kişilik Yatak", priceModifier: 350 },
    ],
  },
  {
    title: "Ankara Tunus St. Boutique",
    description:
      "Tunus Caddesi'nin şık dünyasında butik otel. Kültür merkezleri ve kafelere yürüyüşle.",
    type: "BED_AND_BREAKFAST",
    loc: 6,
    basePrice: 1900,
    ratingAvg: 8.7,
    ratingCount: 170,
    amenities: [0, 4, 10, 11],
    rooms: [
      { name: "Standart Oda", capacity: 2, bedType: "Çift Kişilik Yatak", priceModifier: 0 },
      { name: "Caddeden Manzaralı", capacity: 2, bedType: "Kral Yatak", priceModifier: 600 },
    ],
  },
  {
    title: "Londra Hyde Park Guesthouse",
    description:
      "Harrod's ve Hyde Park arasında zarif bir Viktorya evi. Kraliyet mahallelerinde kalın.",
    type: "BED_AND_BREAKFAST",
    loc: 17,
    basePrice: 280,
    ratingAvg: 8.9,
    ratingCount: 290,
    amenities: [0, 4, 10],
    rooms: [
      { name: "Bahçe Manzaralı", capacity: 2, bedType: "Çift Kişilik Yatak", priceModifier: 0 },
      { name: "Aile Odası", capacity: 4, bedType: "Çift Kişilik Yatak", priceModifier: 110 },
    ],
  },
];

const DEMO_POLICIES = ["policy_flexible_v1", "policy_moderate_v1", "policy_strict_v1"] as const;
const DEMO_PROVINCES = ["34", "06", "35", "07", "48", "50", "16", "01", "81", "61"] as const;

/** `/^(0[1-9]|[1-7]\d|8[01])-\d{3,6}(-\d{4})?$/` ile uyumlu demo izin belgesi numarası. */
function demoLicenseNumber(index: number): string {
  const province = DEMO_PROVINCES[index % DEMO_PROVINCES.length];
  return `${province}-${10001 + index}`;
}

async function main() {
  assertSeedAllowed();
  console.log("Seeding başlıyor...");
  const passwordHash = await bcrypt.hash("Password123!", 10);
  await prisma.user.upsert({
    where: { email: "admin@booking.test" },
    update: {},
    create: {
      email: "admin@booking.test",
      passwordHash,
      firstName: "Sistem",
      lastName: "Yöneticisi",
      role: UserRole.ADMIN,
    },
  });
  const host = await prisma.user.upsert({
    where: { email: "host@booking.test" },
    update: {},
    create: {
      email: "host@booking.test",
      passwordHash,
      firstName: "Ahmet",
      lastName: "Yılmaz",
      role: UserRole.HOST,
    },
  });
  const guest = await prisma.user.upsert({
    where: { email: "guest@booking.test" },
    update: {},
    create: {
      email: "guest@booking.test",
      passwordHash,
      firstName: "Ayşe",
      lastName: "Demir",
      role: UserRole.USER,
    },
  });

  // Ekstra misafir kullanıcılar (favori/rezervasyon çeşitliliği için)
  const extraGuests: { id: string }[] = [];
  const extraSeed = [
    { email: "elif@test.com", firstName: "Elif", lastName: "Kaya" },
    { email: "mehmet@test.com", firstName: "Mehmet", lastName: "Şahin" },
    { email: "zeynep@test.com", firstName: "Zeynep", lastName: "Yıldız" },
  ];
  for (const eg of extraSeed) {
    const u = await prisma.user.upsert({
      where: { email: eg.email },
      update: {},
      create: {
        email: eg.email,
        passwordHash,
        firstName: eg.firstName,
        lastName: eg.lastName,
        role: UserRole.USER,
      },
    });
    extraGuests.push(u);
  }

  const locations: Record<number, string> = {};
  for (let i = 0; i < LOCATIONS.length; i++) {
    const loc = LOCATIONS[i];
    const created = await prisma.location.upsert({
      where: { city_country: { city: loc.city, country: loc.country } },
      update: { latitude: loc.lat, longitude: loc.lng },
      create: { city: loc.city, country: loc.country, latitude: loc.lat, longitude: loc.lng },
    });
    locations[i] = created.id;
  }
  console.log("Lokasyonlar:", Object.keys(locations).length);

  // Veri hijyeni: Unicode/trail-space varyantı kopya lokasyonları tekilleştir.
  // Aynı (city, country) grubunda id'si en küçük olan kanonik kalır; mülkler ve
  // talep etkinlikleri ona taşınır, kopyalar silinir.
  const allLocations = await prisma.location.findMany({
    include: { _count: { select: { properties: true, demandEvents: true } } },
  });
  const grouped = new Map<string, typeof allLocations>();
  for (const l of allLocations) {
    const key = `${l.city.trim().toLocaleLowerCase("tr-TR")}|${l.country.trim().toLocaleLowerCase("tr-TR")}`;
    const arr = grouped.get(key) ?? [];
    arr.push(l);
    grouped.set(key, arr);
  }
  let deduped = 0;
  for (const arr of grouped.values()) {
    if (arr.length < 2) continue;
    arr.sort((a, b) => (a.id < b.id ? -1 : 1));
    const keeper = arr[0];
    for (const dup of arr.slice(1)) {
      if (dup._count.properties > 0) {
        await prisma.property.updateMany({
          where: { locationId: dup.id },
          data: { locationId: keeper.id },
        });
      }
      if (dup._count.demandEvents > 0) {
        await prisma.demandEvent.updateMany({
          where: { locationId: dup.id },
          data: { locationId: keeper.id },
        });
      }
      await prisma.location.delete({ where: { id: dup.id } });
      deduped += 1;
      // seed'in locations[i] haritası silinen kopyayı gösteriyorsa kanoniğe çevir
      for (const [k, v] of Object.entries(locations)) {
        if (v === dup.id) locations[Number(k)] = keeper.id;
      }
    }
  }
  if (deduped > 0) console.log(`Tekilleştirilen lokasyon: ${deduped}`);

  const amenityIds: Record<number, string> = {};
  for (let i = 0; i < AMENITIES.length; i++) {
    const a = AMENITIES[i];
    const created = await prisma.amenity.upsert({
      where: { name: a.name },
      update: { icon: a.icon },
      create: { name: a.name, icon: a.icon },
    });
    amenityIds[i] = created.id;
  }
  console.log("Olanaklar:", Object.keys(amenityIds).length);

  const existing = await prisma.property.findMany({ select: { id: true } });
  if (existing.length > 0) {
    await prisma.invoice.deleteMany();
    await prisma.payout.deleteMany();
    await prisma.payment.deleteMany();
    await prisma.review.deleteMany();
    await prisma.booking.deleteMany();
    await prisma.favorite.deleteMany();
    await prisma.externalBlock.deleteMany();
    await prisma.restriction.deleteMany();
    await prisma.inventoryDay.deleteMany();
    await prisma.booking.updateMany({ data: { ratePlanId: null } });
    await prisma.ratePlan.deleteMany();
    await prisma.roomType.deleteMany();
    await prisma.priceHistory.deleteMany();
    await prisma.property.deleteMany();
    console.log(`Eski veriler temizlendi (${existing.length} property).`);
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  // Envanter ufku: ileri 365 gece (rollover işiyle aynı ufuk)
  const horizon = 365;

  // Talep etkinlikleri (prediktif fiyat motorunun dinamik girdisi)
  await prisma.demandEvent.deleteMany({});
  const demandEvents = DEMAND_EVENTS.map((ev) => ({
    locationId: locations[ev.loc],
    title: ev.title,
    startsAt: addDays(today, ev.startOff),
    endsAt: addDays(today, ev.endOff),
    impact: ev.impact,
  })).filter((ev) => ev.locationId);
  if (demandEvents.length > 0) {
    await prisma.demandEvent.createMany({ data: demandEvents });
  }
  console.log("Talep etkinlikleri:", demandEvents.length);

  let propertyCount = 0;
  const roomIds: { propertyId: string; roomId: string; title: string }[] = [];

  for (const prop of PROPERTIES) {
    const property = await prisma.property.create({
      data: {
        hostId: host.id,
        title: prop.title,
        description: prop.description,
        propertyType: prop.type as PropertyType,
        locationId: locations[prop.loc],
        // ADR 0011: her tesis kendi yerel saat diliminde işler (iade penceresi, gece, iCal).
        timeZone: TIME_ZONES[LOCATIONS[prop.loc].city] ?? "Europe/Istanbul",
        basePrice: new Prisma.Decimal(prop.basePrice),
        currency: "TRY",
        ratingAvg: prop.ratingAvg,
        ratingCount: prop.ratingCount,
        isActive: true,
        // Geçerli izin belgesi no (il plaka kodu 01-81 + sıra no) ve deterministik iptal politikası
        licenseNumber: demoLicenseNumber(propertyCount),
        cancellationPolicyId: DEMO_POLICIES[propertyCount % DEMO_POLICIES.length],
        images: [
          IMAGE_POOL[propertyCount % IMAGE_POOL.length],
          IMAGE_POOL[(propertyCount + 1) % IMAGE_POOL.length],
          IMAGE_POOL[(propertyCount + 2) % IMAGE_POOL.length],
        ],
        amenities: { connect: prop.amenities.map((idx) => ({ id: amenityIds[idx] })) },
      },
    });
    for (const room of prop.rooms) {
      const units = unitsFor(prop.type, room.priceModifier);
      const createdRoom = await prisma.roomType.create({
        data: {
          propertyId: property.id,
          name: room.name,
          maxOccupancy: room.capacity,
          units,
          bedType: room.bedType,
          priceModifier: new Prisma.Decimal(room.priceModifier),
          available: true,
          ratePlans: { create: ratePlansFor(prop.type) },
        },
      });
      const availabilities = [];
      for (let day = 0; day < horizon; day++) {
        const date = addDays(today, day);
        const month = date.getUTCMonth();
        const seasonal = month >= 5 && month <= 8 ? 1.3 : month === 11 || month === 0 ? 1.15 : 1.0;
        const price = Math.round((prop.basePrice + room.priceModifier) * seasonal * 100) / 100;
        availabilities.push({
          roomTypeId: createdRoom.id,
          date,
          total: units,
          price: new Prisma.Decimal(price),
        });
      }
      await prisma.inventoryDay.createMany({ data: availabilities });
      // Villalar/evler: cumartesi varışlarında en az 2 gece (LOS kısıtı demosu).
      if (prop.type === "VILLA") {
        await prisma.restriction.createMany({
          data: availabilities
            .filter((a) => a.date.getUTCDay() === 6)
            .map((a) => ({ roomTypeId: createdRoom.id, date: a.date, minStay: 2 })),
        });
      }
      roomIds.push({ propertyId: property.id, roomId: createdRoom.id, title: prop.title });
    }
    propertyCount++;
  }
  console.log(`Özellikler oluşturuldu: ${propertyCount}, odalar: ${roomIds.length}`);

  // Demo rezervasyonlar: farklı kullanıcılar, tarihler ve durumlar
  const allGuests = [{ id: guest.id }, ...extraGuests];
  const bookingPlans = [
    { g: 0, title: "Grand Deluxe Hotel", off: 14, nights: 3, status: "CONFIRMED" },
    { g: 1, title: "Dubai Marina Skyline Hotel", off: 21, nights: 4, status: "PENDING" },
    { g: 2, title: "Cave Suite Cappadocia", off: 30, nights: 2, status: "CONFIRMED" },
    { g: 3, title: "Paris Latin Quarter Hotel", off: 45, nights: 5, status: "PENDING" },
  ] as const;

  for (const bp of bookingPlans) {
    const target = roomIds.find((r) => r.title === bp.title);
    if (!target) continue;
    const checkIn = addDays(today, bp.off);
    const dates: Date[] = [];
    for (let d = 0; d < bp.nights; d++) dates.push(addDays(checkIn, d));
    const rows = await prisma.inventoryDay.findMany({
      where: { roomTypeId: target.roomId, date: { in: dates } },
      orderBy: { date: "asc" },
    });
    if (rows.length !== bp.nights) continue;
    const total = rows.reduce((sum, r) => sum + Number(r.price), 0);
    const booking = await prisma.booking.create({
      data: {
        userId: allGuests[bp.g].id,
        propertyId: target.propertyId,
        roomId: target.roomId,
        checkIn,
        checkOut: addDays(checkIn, bp.nights),
        guestCount: 2,
        totalPrice: new Prisma.Decimal(Math.round(total * 100) / 100),
        currency: "TRY",
        status: bp.status as "CONFIRMED" | "PENDING",
      },
    });
    if (bp.status === "CONFIRMED") {
      // Sayaçlı envanter: onaylı rezervasyon her gecede bir oda satar.
      await prisma.inventoryDay.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: { sold: { increment: 1 } },
      });
      await prisma.payment.create({
        data: {
          bookingId: booking.id,
          userId: allGuests[bp.g].id,
          amount: booking.totalPrice,
          currency: "TRY",
          provider: "mock-stripe",
          status: "PAID",
          paidAt: new Date(),
        },
      });
      // Onaylanmış biten rezervasyon için yorum
      if (bp.status === "CONFIRMED") {
        await prisma.review.create({
          data: {
            bookingId: booking.id,
            userId: allGuests[bp.g].id,
            propertyId: target.propertyId,
            rating: 8 + (bp.g % 3),
            comment: "Konum ve temizlik harikaydı. Tekrar gelmeyi düşünüyoruz. ⭐⭐⭐⭐⭐",
          },
        });
      }
    }
  }

  // Favoriler: her kullanıcı 2-4 mülkü favori yapsın
  const favTitles = [
    "Grand Deluxe Hotel",
    "Luxury Bosphorus Suite",
    "Dubai Marina Skyline Hotel",
    "Paris Latin Quarter Hotel",
    "Cave Suite Cappadocia",
    "Bodrum Marina Boutique",
    "New York Central Park View",
    "Tokyo Shibuya Capsule+",
    "Barcelona Beachfront Hotel",
    "Villa Amara",
  ];
  const propByTitle = new Map(roomIds.map((r) => [r.title, r.propertyId]));
  const already = new Set<string>();
  for (let g = 0; g < allGuests.length; g++) {
    for (const t of favTitles) {
      const pid = propByTitle.get(t);
      if (!pid) continue;
      if (already.has(`${g}-${pid}`)) continue;
      already.add(`${g}-${pid}`);
      await prisma.favorite.upsert({
        where: { userId_propertyId: { userId: allGuests[g].id, propertyId: pid } },
        update: {},
        create: { userId: allGuests[g].id, propertyId: pid },
      });
    }
  }
  console.log(`Favoriler: ${already.size}`);

  // Geçmiş tamamlanmış konaklamalar → kişilik + mevsim + olanak bağlamlı yorumlar
  const propByTitleForReviews = new Map(roomIds.map((r) => [r.title, r]));
  let reviewCount = 0;
  for (const plan of REVIEW_PLANS) {
    const target = propByTitleForReviews.get(plan.title);
    if (!target) continue;
    const reviewer = allGuests[plan.g];
    const checkIn = addDays(today, plan.off);
    const nights = plan.nights;
    const prop = await prisma.property.findUnique({
      where: { id: target.propertyId },
      include: { location: true, amenities: { select: { name: true } } },
    });
    if (!prop) continue;
    const total = Number(prop.basePrice) * seasonFactor(checkIn.getUTCMonth()) * nights;
    const booking = await prisma.booking.create({
      data: {
        userId: reviewer.id,
        propertyId: prop.id,
        roomId: target.roomId,
        checkIn,
        checkOut: addDays(checkIn, nights),
        guestCount: 1 + (plan.g % 2),
        totalPrice: new Prisma.Decimal(Math.round(total * 100) / 100),
        currency: "TRY",
        status: BookingStatus.COMPLETED,
        createdAt: addDays(checkIn, -10),
      },
    });
    await prisma.payment.create({
      data: {
        bookingId: booking.id,
        userId: reviewer.id,
        amount: booking.totalPrice,
        currency: "TRY",
        provider: "mock-gateway",
        status: "PAID",
        paidAt: new Date(checkIn.getTime() - 86400000 * 3),
      },
    });
    const rng = mulberry32(plan.g * 7919 + checkIn.getTime() / 86400000);
    const { rating, comment } = composeReview(
      {
        title: prop.title,
        propertyType: prop.propertyType,
        city: prop.location.city,
        amenities: prop.amenities.map((a) => a.name),
        basePrice: Number(prop.basePrice),
      },
      plan.persona,
      checkIn.getUTCMonth(),
      rng
    );
    await prisma.review.create({
      data: { bookingId: booking.id, userId: reviewer.id, propertyId: prop.id, rating, comment },
    });
    reviewCount += 1;
  }
  console.log(`Bağlamsal yorumlar: ${reviewCount}`);

  // Mevsimsel fiyat geçmişi — önceki 12 ay, yaz-zirve / kış-dip dalgalanması
  await prisma.priceHistory.deleteMany({});
  const historyStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 12, 1));
  const historyRows: Array<{
    propertyId: string;
    month: Date;
    avgNightlyPrice: Prisma.Decimal;
    demandIndex: number;
  }> = [];
  for (const prop of await prisma.property.findMany({ select: { id: true, basePrice: true } })) {
    const rng = mulberry32([...prop.id].reduce((a, c) => a + c.charCodeAt(0), 7));
    for (let m = 0; m < 12; m++) {
      const monthDate = new Date(
        Date.UTC(historyStart.getUTCFullYear(), historyStart.getUTCMonth() + m, 1)
      );
      const sf = seasonFactor(monthDate.getUTCMonth());
      const noise = 0.92 + rng() * 0.16;
      const avg = Number(prop.basePrice) * sf * noise;
      const demandIndex = Math.round(Math.min(98, Math.max(12, (sf - 0.9) * 220 + noise * 10)));
      historyRows.push({
        propertyId: prop.id,
        month: monthDate,
        avgNightlyPrice: new Prisma.Decimal(Math.round(avg * 100) / 100),
        demandIndex,
      });
    }
  }
  if (historyRows.length > 0) await prisma.priceHistory.createMany({ data: historyRows });
  console.log(`Fiyat geçmişi satırları: ${historyRows.length}`);

  console.log("Seeding tamamlandı ✅");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
