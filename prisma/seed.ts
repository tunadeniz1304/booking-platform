import { PrismaClient, Prisma, PropertyType, UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";

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

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function toDateKey(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
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
  { city: "New York", country: "ABD", lat: 40.7128, lng: -74.006},
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
  { title: "Grand Deluxe Hotel", description: "Tarihi yarımadaya 5 dakika mesafede, boğaz manzaralı lüks otel. Ücretsiz spa, kapalı havuz ve gurme restoran.", type: "HOTEL", loc: 0, basePrice: 2450, ratingAvg: 8.9, ratingCount: 1240, amenities: [0,1,2,4,5,6,7,9],
    rooms: [
      { name: "Standart Oda", capacity: 2, bedType: "Çift Kişilik Yatak", priceModifier: 0 },
      { name: "Deluxe Boğaz Manzaralı", capacity: 3, bedType: "Kral Yatak", priceModifier: 1200 },
      { name: "Süit", capacity: 4, bedType: "2 Çift Kişilik Yatak", priceModifier: 2600 },
    ] },
  { title: "Villa Amara", description: "Özel yüzme havuzu, bahçe ve deniz manzarasıyla Bodrum'un kalbinde bütün villa. Kalabalık aileler için ideal.", type: "VILLA", loc: 2, basePrice: 5200, ratingAvg: 9.4, ratingCount: 386, amenities: [0,1,2,3,6,7],
    rooms: [
      { name: "Tüm Villa", capacity: 8, bedType: "4 Yatak Odası", priceModifier: 0 },
    ] },
  { title: "Sunset Beach Resort", description: "Antalya'nın ünlü plajlarına sıfır, her şey dahil konseptli resort. Çocuk kulübü ve açık havuzlar.", type: "HOTEL", loc: 1, basePrice: 3100, ratingAvg: 8.7, ratingCount: 892, amenities: [0,1,2,3,4,6,7,9],
    rooms: [
      { name: "Standart Oda", capacity: 2, bedType: "Çift Kişilik Yatak", priceModifier: 0 },
      { name: "Deniz Manzaralı", capacity: 3, bedType: "Kral Yatak", priceModifier: 900 },
      { name: "Aile Odası", capacity: 5, bedType: "2 Çift Kişilik Yatak", priceModifier: 1500 },
    ] },
  { title: "City Center Apart", description: "İzmir şehir merkezinde, Kordon'a 10 dakika yürüme mesafesinde modern apart. Mutfak ve çamaşır makinesi mevcut.", type: "APARTMENT", loc: 3, basePrice: 1200, ratingAvg: 8.2, ratingCount: 210, amenities: [0,2,3,8],
    rooms: [
      { name: "1+1 Apart", capacity: 2, bedType: "Çift Kişilik Yatak", priceModifier: 0 },
      { name: "2+1 Apart", capacity: 4, bedType: "2 Çift Kişilik Yatak", priceModifier: 700 },
    ] },
  { title: "Mountain View Lodge", description: "Karadeniz'in eşsiz doğasında, yayla manzaralı butik pansiyon. Ev yapımı kahvaltı dahil.", type: "BED_AND_BREAKFAST", loc: 4, basePrice: 1800, ratingAvg: 9.1, ratingCount: 154, amenities: [0,2,4,8],
    rooms: [
      { name: "Standart Oda", capacity: 2, bedType: "Çift Kişilik Yatak", priceModifier: 0 },
      { name: "Aile Odası", capacity: 4, bedType: "2 Çift Kişilik Yatak", priceModifier: 800 },
    ] },
  { title: "Cave Suite Cappadocia", description: "Peribacaları manzaralı, gerçek kaya oyma mağara süit. Balon turu organize edilir.", type: "HOTEL", loc: 5, basePrice: 4100, ratingAvg: 9.6, ratingCount: 98, amenities: [0,2,4,7,9],
    rooms: [
      { name: "Mağara Süit", capacity: 2, bedType: "Kral Yatak", priceModifier: 0 },
      { name: "Aile Mağara Süit", capacity: 4, bedType: "2 Çift Kişilik Yatak", priceModifier: 1600 },
    ] },
  { title: "Luxury Bosphorus Suite", description: "Boğaz'a tam cephe, özel balkonlu lüks apart. Şehrin en prestijli semtinde.", type: "APARTMENT", loc: 0, basePrice: 6800, ratingAvg: 9.2, ratingCount: 76, amenities: [0,2,5,6,7],
    rooms: [
      { name: "Boğaz Manzaralı Süit", capacity: 2, bedType: "Kral Yatak", priceModifier: 0 },
    ] },
  { title: "Old Town Boutique Hotel", description: "Kaleiçi'nin tarihi dokusunda, restore edilmiş butik otel. Avlulu bahçede kahvaltı.", type: "BED_AND_BREAKFAST", loc: 1, basePrice: 2100, ratingAvg: 8.8, ratingCount: 320, amenities: [0,2,4,9],
    rooms: [
      { name: "Standart Oda", capacity: 2, bedType: "Çift Kişilik Yatak", priceModifier: 0 },
      { name: "Deluxe Bahçe Odası", capacity: 2, bedType: "Kral Yatak", priceModifier: 500 },
    ] },
  { title: "Marina View Hostel", description: "Bodrum marinaya yürüme mesafesinde, sosyal ortam arayan gezginler için modern hostel.", type: "HOSTEL", loc: 2, basePrice: 650, ratingAvg: 8.4, ratingCount: 512, amenities: [0,3,9],
    rooms: [
      { name: "4 Kişilik Yatakhane", capacity: 4, bedType: "Ranza", priceModifier: 0 },
      { name: "Özel Oda", capacity: 2, bedType: "Çift Kişilik Yatak", priceModifier: 450 },
    ] },
  { title: "Green Valley Farmstay", description: "Trabzon yaylalarında organik çiftlik konaklaması. Kemankeş şelalesine yakın.", type: "VILLA", loc: 4, basePrice: 2600, ratingAvg: 9.3, ratingCount: 145, amenities: [0,2,4,8,3],
    rooms: [
      { name: "Tüm Çiftlik Evi", capacity: 6, bedType: "3 Yatak Odası", priceModifier: 0 },
    ] },

  { title: "Ankara Residence Hotel", description: "Ankara'nın iş merkezinde, toplantı salonları ve uzun konaklama odalarıyla iş seyahatçileri için ideal otel.", type: "HOTEL", loc: 6, basePrice: 1450, ratingAvg: 8.0, ratingCount: 640, amenities: [0,2,3,6,10,11],
    rooms: [
      { name: "Standart Oda", capacity: 2, bedType: "Çift Kişilik Yatak", priceModifier: 0 },
      { name: "Executive Oda", capacity: 2, bedType: "Kral Yatak", priceModifier: 600 },
      { name: "Junior Süit", capacity: 3, bedType: "Kral Yatak", priceModifier: 1100 },
    ] },
  { title: "Göcek Yacht Marina Suites", description: "Akyaka koyundan her şeye kolay erişimle Muğla'nın marina manzaralı süitleri. Tekne turu düzenlenir.", type: "APARTMENT", loc: 7, basePrice: 2900, ratingAvg: 8.9, ratingCount: 190, amenities: [0,1,2,7,10],
    rooms: [
      { name: "Marina Süit", capacity: 2, bedType: "Çift Kişilik Yatak", priceModifier: 0 },
      { name: "Panorama Süit", capacity: 4, bedType: "2 Çift Kişilik Yatak", priceModifier: 1400 },
    ] },
  { title: "Alanya Beach Club", description: "Kızılkule manzaralı, özel plaj şezlongları ve günlük eğlence programıyla aile dostu resort.", type: "HOTEL", loc: 8, basePrice: 2750, ratingAvg: 8.5, ratingCount: 720, amenities: [0,1,2,3,4,7,9],
    rooms: [
      { name: "Standart Oda", capacity: 2, bedType: "Çift Kişilik Yatak", priceModifier: 0 },
      { name: "Deniz Manzaralı", capacity: 3, bedType: "Kral Yatak", priceModifier: 1000 },
      { name: "Aile Süit", capacity: 5, bedType: "2 Çift Kişilik Yatak", priceModifier: 1700 },
    ] },
  { title: "Çeşme SPA & Wellness Resort", description: "Ilıca plajına 25 metre, termal havuzları ve award-winning spa'sıyla huzur dolu bir kaçış.", type: "HOTEL", loc: 9, basePrice: 3400, ratingAvg: 9.0, ratingCount: 410, amenities: [0,1,2,4,5,6,7,9],
    rooms: [
      { name: "Standart Oda", capacity: 2, bedType: "Çift Kişilik Yatak", priceModifier: 0 },
      { name: "Deluxe Deniz Manzaralı", capacity: 3, bedType: "Kral Yatak", priceModifier: 1200 },
    ] },
  { title: "Kuşadası Crystal Bay Hotel", description: "Ladies Beach'e yürüme mesafesinde, çocuklu aileler için animasyon ve mini kulüplü tatil köyü.", type: "HOTEL", loc: 10, basePrice: 2350, ratingAvg: 8.3, ratingCount: 560, amenities: [0,1,2,3,4,9],
    rooms: [
      { name: "Standart Oda", capacity: 2, bedType: "Çift Kişilik Yatak", priceModifier: 0 },
      { name: "Aile Odası", capacity: 5, bedType: "2 Çift Kişilik Yatak", priceModifier: 1300 },
    ] },
  { title: "Hôtel Lumière Paris", description: "Eiffel Kulesi'ne 10 dakikalık yürüyüş, Haussmann mimarisi ve butik şıklık. Şampanya barıyla ünlü.", type: "HOTEL", loc: 11, basePrice: 420, ratingAvg: 9.1, ratingCount: 830, amenities: [0,2,9,10,11],
    rooms: [
      { name: "Classic Oda", capacity: 2, bedType: "Çift Kişilik Yatak", priceModifier: 0 },
      { name: "Kule Manzaralı", capacity: 3, bedType: "Kral Yatak", priceModifier: 180 },
      { name: "Süit", capacity: 4, bedType: "Kral Yatak", priceModifier: 320 },
    ] },
  { title: "Roma Colosseum Nest", description: "Kolezyum'a 3 dakika, tarihi merkezde restore edilmiş daireler. Mutfak ve asansör mevcut.", type: "APARTMENT", loc: 12, basePrice: 290, ratingAvg: 9.0, ratingCount: 470, amenities: [0,2,10,11],
    rooms: [
      { name: "1+1 Daire", capacity: 2, bedType: "Çift Kişilik Yatak", priceModifier: 0 },
      { name: "2+1 Aile Dairesi", capacity: 5, bedType: "3 Tek Kişilik Yatak", priceModifier: 120 },
    ] },
  { title: "Barcelona Beachfront Hotel", description: "Barceloneta plajına sıfır, çatı terası havuzu ve deniz manzaralı odalarla Akdeniz keyfi.", type: "HOTEL", loc: 13, basePrice: 310, ratingAvg: 8.8, ratingCount: 1560, amenities: [0,1,2,4,7,9,10],
    rooms: [
      { name: "Standart Oda", capacity: 2, bedType: "Çift Kişilik Yatak", priceModifier: 0 },
      { name: "Deniz Manzaralı", capacity: 3, bedType: "Kral Yatak", priceModifier: 140 },
      { name: "Junior Süit", capacity: 4, bedType: "Kral Yatak", priceModifier: 260 },
    ] },
  { title: "Amsterdam Canal House", description: "Jordaan'daki kanal evinde, bisiklet kiralama ve seramik atölyesi. Şehir merkezine yürüyüşle 5 dakika.", type: "BED_AND_BREAKFAST", loc: 14, basePrice: 260, ratingAvg: 9.3, ratingCount: 210, amenities: [0,4,10],
    rooms: [
      { name: "Kanal Oda", capacity: 2, bedType: "Çift Kişilik Yatak", priceModifier: 0 },
      { name: "Aile Oda", capacity: 4, bedType: "Çift Kişilik Yatak", priceModifier: 90 },
    ] },

  { title: "Viyana Opera Residence", description: "Devlet Operası karşısında, tarihi bir sarayın dairelerinde. Müzikseverler için yürüyüşle 2 dakika konser salonlarına.", type: "APARTMENT", loc: 15, basePrice: 230, ratingAvg: 8.7, ratingCount: 330, amenities: [0,2,10,11],
    rooms: [
      { name: "Saray Dairesi", capacity: 3, bedType: "Çift Kişilik Yatak", priceModifier: 0 },
      { name: "Aile Apartmanı", capacity: 6, bedType: "2 Çift Kişilik Yatak", priceModifier: 150 },
    ] },
  { title: "Dubai Marina Skyline Hotel", description: "Marina manzaralı yüksek katlarda, sonsuzluk havuzu ve gökdelenlerin gölgesinde zarif konaklama.", type: "HOTEL", loc: 16, basePrice: 380, ratingAvg: 9.2, ratingCount: 2140, amenities: [0,1,2,5,6,7,9],
    rooms: [
      { name: "Marina Oda", capacity: 2, bedType: "Kral Yatak", priceModifier: 0 },
      { name: "Gökdelen Manzaralı", capacity: 3, bedType: "Kral Yatak", priceModifier: 160 },
      { name: "Executive Süit", capacity: 4, bedType: "Kral Yatak", priceModifier: 340 },
    ] },
  { title: "London Camden Loft", description: "Camden Market'in kalbindeki endüstriyel loft. Canlı müzik mekanlarına yürüme mesafesi.", type: "APARTMENT", loc: 17, basePrice: 340, ratingAvg: 8.5, ratingCount: 480, amenities: [0,2,10],
    rooms: [
      { name: "Loft", capacity: 2, bedType: "Çift Kişilik Yatak", priceModifier: 0 },
      { name: "Büyük Loft", capacity: 4, bedType: "2 Çift Kişilik Yatak", priceModifier: 140 },
    ] },
  { title: "New York Central Park View", description: "Central Park South'ta, Manhattan silüeti ve park manzaralı lüks odalar. Amanhattan'ın kalbi.", type: "HOTEL", loc: 18, basePrice: 520, ratingAvg: 9.4, ratingCount: 1820, amenities: [0,2,5,6,7,9,10],
    rooms: [
      { name: "City Oda", capacity: 2, bedType: "Kral Yatak", priceModifier: 0 },
      { name: "Park Manzaralı", capacity: 3, bedType: "Kral Yatak", priceModifier: 240 },
      { name: "Corner Süit", capacity: 4, bedType: "2 Kral Yatak", priceModifier: 420 },
    ] },
  { title: "Tokyo Shibuya Capsule+", description: "Shibuya'nın ortasında yüksek teknolojili kapsül hostel. Gökdelen barlarına 5 dakika.", type: "HOSTEL", loc: 19, basePrice: 90, ratingAvg: 8.6, ratingCount: 980, amenities: [0,3,9,10],
    rooms: [
      { name: "Kapsül (erkek)", capacity: 1, bedType: "Tek Kişilik Kapsül", priceModifier: 0 },
      { name: "Kapsül (kadın)", capacity: 1, bedType: "Tek Kişilik Kapsül", priceModifier: 0 },
      { name: "Özel Kabin", capacity: 2, bedType: "Çift Kişilik Yatak", priceModifier: 60 },
    ] },
  { title: "İstanbul Galata Loft Suites", description: "Galata Kulesi'nin gölgesinde, tasarım loft daireler. Tünel ve Karaköy'e yürüyüşle 3 dakika.", type: "APARTMENT", loc: 0, basePrice: 2100, ratingAvg: 8.8, ratingCount: 260, amenities: [0,2,5,10,11],
    rooms: [
      { name: "Loft", capacity: 2, bedType: "Çift Kişilik Yatak", priceModifier: 0 },
      { name: "Terash Loft", capacity: 3, bedType: "Kral Yatak", priceModifier: 700 },
    ] },
  { title: "Antalya Lara Family Resort", description: "Lara plajında ultra her şey dahil aile resort. Su kaydıraklı büyük havuz ve çocuk kulübü.", type: "HOTEL", loc: 1, basePrice: 3600, ratingAvg: 8.9, ratingCount: 1340, amenities: [0,1,2,3,4,6,9],
    rooms: [
      { name: "Standart Oda", capacity: 2, bedType: "Çift Kişilik Yatak", priceModifier: 0 },
      { name: "Aile Odası Havuz Manz.", capacity: 5, bedType: "2 Çift Kişilik Yatak", priceModifier: 1400 },
    ] },
  { title: "Bodrum Marina Boutique", description: "Milta Marina karşısında butik otel. Yat sahiplerine özel servis ve özel plaj üyeliği.", type: "BED_AND_BREAKFAST", loc: 2, basePrice: 3900, ratingAvg: 9.5, ratingCount: 180, amenities: [0,1,2,4,7,9],
    rooms: [
      { name: "Marina Manzaralı", capacity: 2, bedType: "Kral Yatak", priceModifier: 0 },
      { name: "Deluxe Süit", capacity: 3, bedType: "Kral Yatak", priceModifier: 1800 },
    ] },
  { title: "Kapadokya Sultan Cave Hotel", description: "Göreme manzaralı kaya oyma odalar, balon keyfi için özel teras. Tarihi taş dokusu.", type: "BED_AND_BREAKFAST", loc: 5, basePrice: 3200, ratingAvg: 9.7, ratingCount: 220, amenities: [0,2,4,7,9],
    rooms: [
      { name: "Kaya Oda", capacity: 2, bedType: "Kral Yatak", priceModifier: 0 },
      { name: "Manzaralı Kaya Süit", capacity: 3, bedType: "Kral Yatak", priceModifier: 1100 },
    ] },

  { title: "İzmir Alsancak Apart Hotel", description: "Kıbrıs Şehitleri Caddesi üzerinde, servisli apart odalar. Sahile 8 dakika yürüyüş.", type: "APARTMENT", loc: 3, basePrice: 1500, ratingAvg: 8.4, ratingCount: 300, amenities: [0,2,3,8,10],
    rooms: [
      { name: "Deluxe Oda", capacity: 2, bedType: "Çift Kişilik Yatak", priceModifier: 0 },
      { name: "İki Yatak Odalı Apart", capacity: 5, bedType: "2 Çift Kişilik Yatak", priceModifier: 800 },
    ] },
  { title: "Trabzon Uzungöl Country House", description: "Uzungöl manzarasına bakan ahşap kır evi. Doğa yürüyüşleri ve tekne turu yakında.", type: "VILLA", loc: 4, basePrice: 2300, ratingAvg: 9.0, ratingCount: 120, amenities: [0,2,4,8],
    rooms: [
      { name: "Tüm Ev", capacity: 6, bedType: "3 Yatak Odası", priceModifier: 0 },
    ] },
  { title: "Paris Latin Quarter Hotel", description: "Notre-Dame ve Panthéon arasında, edebi kahveleriyle ünlü mahallede şık butik otel.", type: "HOTEL", loc: 11, basePrice: 350, ratingAvg: 8.9, ratingCount: 1240, amenities: [0,2,4,10,11],
    rooms: [
      { name: "Chambre Classique", capacity: 2, bedType: "Çift Kişilik Yatak", priceModifier: 0 },
      { name: "Chambre Prestige", capacity: 3, bedType: "Kral Yatak", priceModifier: 130 },
    ] },
  { title: "İstanbul Sultanahmet Pansiyon", description: "Ayasofya'ya 2 dakika mesafede, geleneksel Osmanlı evi pansiyonu. Çatı terasında kahvaltı.", type: "BED_AND_BREAKFAST", loc: 0, basePrice: 1600, ratingAvg: 8.6, ratingCount: 540, amenities: [0,4,10,11],
    rooms: [
      { name: "Standart Oda", capacity: 2, bedType: "Çift Kişilik Yatak", priceModifier: 0 },
      { name: "Terash Manzaralı", capacity: 2, bedType: "Kral Yatak", priceModifier: 500 },
    ] },
  { title: "Barselona Gothic Stay", description: "Gotik Mahalle'nin dar sokaklarında tasarım apart. Plaj ve şehir merkezi arasında.", type: "APARTMENT", loc: 13, basePrice: 250, ratingAvg: 8.3, ratingCount: 610, amenities: [0,2,10],
    rooms: [
      { name: "Stüdyo", capacity: 2, bedType: "Çift Kişilik Yatak", priceModifier: 0 },
    ] },
  { title: "Alanya Kleopatra Beach Hotel", description: "Kleopatra Plajı'na cephe, direkt plaj erişimi ve gün batımı terası. Aileler için uygun.", type: "HOTEL", loc: 8, basePrice: 2050, ratingAvg: 8.1, ratingCount: 890, amenities: [0,1,2,3,4,9],
    rooms: [
      { name: "Standart Oda", capacity: 2, bedType: "Çift Kişilik Yatak", priceModifier: 0 },
      { name: "Deniz Manzaralı", capacity: 3, bedType: "Kral Yatak", priceModifier: 900 },
    ] },
  { title: "Roma Trastevere Rooms", description: "Trastevere'nin samimi sokaklarında, su anda popüler restoranların ortasında rahat odalar.", type: "BED_AND_BREAKFAST", loc: 12, basePrice: 180, ratingAvg: 8.8, ratingCount: 350, amenities: [0,4,10],
    rooms: [
      { name: "Standart Oda", capacity: 2, bedType: "Çift Kişilik Yatak", priceModifier: 0 },
      { name: "Aile Odası", capacity: 4, bedType: "Çift Kişilik Yatak", priceModifier: 70 },
    ] },
  { title: "Dubai Downtown Sky Suites", description: "Burj Khalifa manzarasına yürüme mesafesinde, servisli süitler. Dubai Mall 10 dakika.", type: "APARTMENT", loc: 16, basePrice: 310, ratingAvg: 9.1, ratingCount: 720, amenities: [0,1,2,5,6,7,10],
    rooms: [
      { name: "Süit", capacity: 3, bedType: "Kral Yatak", priceModifier: 0 },
      { name: "Panorama Süit", capacity: 5, bedType: "2 Kral Yatak", priceModifier: 200 },
    ] },
  { title: "Kapadokya Balon View Hostel", description: "Bütçe dostu hostel; güneş doğuşunda balon manzarası teras kahvaltısıyla başlar.", type: "HOSTEL", loc: 5, basePrice: 700, ratingAvg: 8.5, ratingCount: 480, amenities: [0,3,9],
    rooms: [
      { name: "6 Kişilik Yatakhane", capacity: 6, bedType: "Ranza", priceModifier: 0 },
      { name: "Özel Oda", capacity: 2, bedType: "Çift Kişilik Yatak", priceModifier: 350 },
    ] },
  { title: "Ankara Tunus St. Boutique", description: "Tunus Caddesi'nin şık dünyasında butik otel. Kültür merkezleri ve kafelere yürüyüşle.", type: "BED_AND_BREAKFAST", loc: 6, basePrice: 1900, ratingAvg: 8.7, ratingCount: 170, amenities: [0,4,10,11],
    rooms: [
      { name: "Standart Oda", capacity: 2, bedType: "Çift Kişilik Yatak", priceModifier: 0 },
      { name: "Caddeden Manzaralı", capacity: 2, bedType: "Kral Yatak", priceModifier: 600 },
    ] },
  { title: "Londra Hyde Park Guesthouse", description: "Harrod's ve Hyde Park arasında zarif bir Viktorya evi. Kraliyet mahallelerinde kalın.", type: "BED_AND_BREAKFAST", loc: 17, basePrice: 280, ratingAvg: 8.9, ratingCount: 290, amenities: [0,4,10],
    rooms: [
      { name: "Bahçe Manzaralı", capacity: 2, bedType: "Çift Kişilik Yatak", priceModifier: 0 },
      { name: "Aile Odası", capacity: 4, bedType: "Çift Kişilik Yatak", priceModifier: 110 },
    ] },
];


async function main() {
  console.log("Seeding başlıyor...");
  const passwordHash = await bcrypt.hash("Password123!", 10);
  const admin = await prisma.user.upsert({
    where: { email: "admin@booking.test" }, update: {},
    create: { email: "admin@booking.test", passwordHash, firstName: "Sistem", lastName: "Yöneticisi", role: UserRole.ADMIN },
  });
  const host = await prisma.user.upsert({
    where: { email: "host@booking.test" }, update: {},
    create: { email: "host@booking.test", passwordHash, firstName: "Ahmet", lastName: "Yılmaz", role: UserRole.HOST },
  });
  const guest = await prisma.user.upsert({
    where: { email: "guest@booking.test" }, update: {},
    create: { email: "guest@booking.test", passwordHash, firstName: "Ayşe", lastName: "Demir", role: UserRole.USER },
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
      where: { email: eg.email }, update: {},
      create: { email: eg.email, passwordHash, firstName: eg.firstName, lastName: eg.lastName, role: UserRole.USER },
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

  const amenityIds: Record<number, string> = {};
  for (let i = 0; i < AMENITIES.length; i++) {
    const a = AMENITIES[i];
    const created = await prisma.amenity.upsert({
      where: { name: a.name }, update: { icon: a.icon },
      create: { name: a.name, icon: a.icon },
    });
    amenityIds[i] = created.id;
  }
  console.log("Olanaklar:", Object.keys(amenityIds).length);

  const existing = await prisma.property.findMany({ select: { id: true } });
  if (existing.length > 0) {
    await prisma.booking.deleteMany();
    await prisma.favorite.deleteMany();
    await prisma.review.deleteMany();
    await prisma.payment.deleteMany();
    await prisma.availability.deleteMany();
    await prisma.room.deleteMany();
    await prisma.property.deleteMany();
    console.log(`Eski veriler temizlendi (${existing.length} property).`);
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const horizon = 180;
  let propertyCount = 0;
  let roomIds: { propertyId: string; roomId: string; title: string }[] = [];

  for (const prop of PROPERTIES) {
    const property = await prisma.property.create({
      data: {
        hostId: host.id,
        title: prop.title,
        description: prop.description,
        propertyType: prop.type as PropertyType,
        locationId: locations[prop.loc],
        basePrice: new Prisma.Decimal(prop.basePrice),
        currency: "TRY",
        ratingAvg: prop.ratingAvg,
        ratingCount: prop.ratingCount,
        isActive: true,
        images: [IMAGE_POOL[propertyCount % IMAGE_POOL.length], IMAGE_POOL[(propertyCount + 1) % IMAGE_POOL.length], IMAGE_POOL[(propertyCount + 2) % IMAGE_POOL.length]],
        amenities: { connect: prop.amenities.map((idx) => ({ id: amenityIds[idx] })) },
      },
    });
    for (const room of prop.rooms) {
      const createdRoom = await prisma.room.create({
        data: {
          propertyId: property.id, name: room.name, capacity: room.capacity,
          bedType: room.bedType, priceModifier: new Prisma.Decimal(room.priceModifier), available: true,
        },
      });
      const availabilities = [];
      for (let day = 0; day < horizon; day++) {
        const date = addDays(today, day);
        const month = date.getUTCMonth();
        const seasonal = month >= 5 && month <= 8 ? 1.3 : month === 11 || month === 0 ? 1.15 : 1.0;
        const price = Math.round((prop.basePrice + room.priceModifier) * seasonal * 100) / 100;
        availabilities.push({ roomId: createdRoom.id, date, isAvailable: true, price: new Prisma.Decimal(price), lockedBy: null });
      }
      await prisma.availability.createMany({ data: availabilities });
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
    const rows = await prisma.availability.findMany({ where: { roomId: target.roomId, date: { in: dates } }, orderBy: { date: "asc" } });
    if (rows.length !== bp.nights) continue;
    const total = rows.reduce((s, r) => s + Number(r.price), 0);
    const booking = await prisma.booking.create({
      data: {
        userId: allGuests[bp.g].id, propertyId: target.propertyId, roomId: target.roomId,
        checkIn, checkOut: addDays(checkIn, bp.nights), guestCount: 2,
        totalPrice: new Prisma.Decimal(Math.round(total * 100) / 100),
        currency: "TRY", status: bp.status as "CONFIRMED" | "PENDING",
      },
    });
    if (bp.status === "CONFIRMED") {
      await prisma.availability.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { isAvailable: false, lockedBy: booking.id } });
      await prisma.payment.create({
        data: { bookingId: booking.id, userId: allGuests[bp.g].id, amount: booking.totalPrice, currency: "TRY", provider: "mock-stripe", status: "PAID", paidAt: new Date() },
      });
      // Onaylanmış biten rezervasyon için yorum
      if (bp.status === "CONFIRMED") {
        await prisma.review.create({
          data: {
            bookingId: booking.id, userId: allGuests[bp.g].id, propertyId: target.propertyId,
            rating: 8 + (bp.g % 3), comment: "Konum ve temizlik harikaydı. Tekrar gelmeyi düşünüyoruz. ⭐⭐⭐⭐⭐",
          },
        });
      }
    }
  }

  // Favoriler: her kullanıcı 2-4 mülkü favori yapsın
  const favTitles = ["Grand Deluxe Hotel", "Luxury Bosphorus Suite", "Dubai Marina Skyline Hotel", "Paris Latin Quarter Hotel", "Cave Suite Cappadocia", "Bodrum Marina Boutique", "New York Central Park View", "Tokyo Shibuya Capsule+", "Barcelona Beachfront Hotel", "Villa Amara"];
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
        update: {}, create: { userId: allGuests[g].id, propertyId: pid },
      });
    }
  }
  console.log(`Favoriler: ${already.size}`);
  console.log("Seeding tamamlandı ✅");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });
