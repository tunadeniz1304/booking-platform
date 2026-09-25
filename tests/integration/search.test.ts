import { beforeAll, afterAll, it, expect } from "vitest";
import { PrismaClient, Prisma } from "@prisma/client";
import { describeInt, iso, utcDay } from "./helpers";
import {
  searchProperties,
  getPopularProperties,
  invalidateSearchCache,
  invalidatePropertySearchCache,
} from "@/lib/search";
import { findFuzzyCandidates } from "@/lib/search/fuzzy";
import { computeAffinity, isVectorEnabled } from "@/lib/search/vector";
import { encode, toVectorLiteral } from "@/lib/embedding/embedder";
import { redis } from "@/lib/redis";

/**
 * Arama çekirdeği (P0-4, P1-2): keyword + filtre + tarih fiyatlama (priceStay),
 * önbellek/sürüm geçersiz kılma, pgvector semantik yol ve pg_trgm fuzzy adaylar.
 * Paylaşılan DB'de diğer testlerin verisi olabilir → her sorgu benzersiz şehirle daraltılır.
 */
describeInt("arama (integration)", () => {
  const prisma = new PrismaClient();
  const stamp = Date.now();
  const city = `Aramakent${stamp}`;
  const otherCity = `Digerkent${stamp}`;
  const token = `zyqx${stamp}`;
  let userId = "";
  let cheap = { id: "", roomId: "" };
  let pricey = { id: "", roomId: "" };
  let otherTypeId = "";
  const checkIn = iso(utcDay(5));
  const checkOut = iso(utcDay(7));

  async function makeProperty(opts: {
    title: string;
    description: string;
    cityName: string;
    price: number;
    rating: number;
    propertyType?: "HOTEL" | "APARTMENT" | "VILLA";
    capacity?: number;
    amenities?: string[];
    bookedNight?: number;
  }) {
    const location = await prisma.location.upsert({
      where: { city_country: { city: opts.cityName, country: "TEST" } },
      update: {},
      create: { city: opts.cityName, country: "TEST", latitude: 41, longitude: 29 },
    });
    const property = await prisma.property.create({
      data: {
        hostId: userId,
        title: opts.title,
        description: opts.description,
        propertyType: opts.propertyType ?? "HOTEL",
        locationId: location.id,
        basePrice: new Prisma.Decimal(opts.price),
        currency: "TRY",
        ratingAvg: opts.rating,
        ratingCount: 10,
        amenities: opts.amenities
          ? {
              connectOrCreate: opts.amenities.map((name) => ({
                where: { name },
                create: { name },
              })),
            }
          : undefined,
      },
    });
    const room = await prisma.room.create({
      data: {
        propertyId: property.id,
        name: "Oda",
        capacity: opts.capacity ?? 2,
        bedType: "Çift",
        priceModifier: new Prisma.Decimal(0),
      },
    });
    await prisma.availability.createMany({
      data: Array.from({ length: 14 }, (_, i) => ({
        roomId: room.id,
        date: utcDay(i + 1),
        price: new Prisma.Decimal(opts.price),
        isAvailable: opts.bookedNight === undefined || i + 1 !== opts.bookedNight,
      })),
    });
    const literal = toVectorLiteral(encode(`${opts.title} ${opts.description} ${opts.cityName}`));
    await prisma.$executeRaw`UPDATE "Property" SET embedding = ${literal}::vector WHERE id = ${property.id}`;
    return { id: property.id, roomId: room.id };
  }

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        email: `search-${stamp}@t.test`,
        passwordHash: "x",
        firstName: "S",
        lastName: "R",
        role: "HOST",
      },
    });
    userId = user.id;
    cheap = await makeProperty({
      title: `Deniz manzaralı ${token} pansiyon`,
      description: "Sahile yakın, kahvaltı dahil",
      cityName: city,
      price: 500,
      rating: 3.5,
      amenities: [`Havuz-${stamp}`],
    });
    pricey = await makeProperty({
      title: "Lüks kayak oteli",
      description: "Şömine ve spa",
      cityName: city,
      price: 2000,
      rating: 4.9,
      capacity: 4,
    });
    const other = await makeProperty({
      title: "Şehir merkezi daire",
      description: "Metroya yürüme mesafesi",
      cityName: city,
      price: 900,
      rating: 4.2,
      propertyType: "APARTMENT",
      bookedNight: 5, // seçilen aralıkta dolu → tarihli aramada listelenmemeli
    });
    otherTypeId = other.id;
    await makeProperty({
      title: "Başka şehirde otel",
      description: "Filtre dışı",
      cityName: otherCity,
      price: 700,
      rating: 5,
    });
    await prisma.favorite.create({ data: { userId, propertyId: pricey.id } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("şehir filtresi + önerilen sıralama açıklanabilir skor döndürür, ikinci çağrı önbellekten gelir", async () => {
    const first = await searchProperties({ city });
    expect(first.cached).toBe(false);
    expect(first.total).toBe(3);
    expect(first.results.every((r) => r.location.city === city)).toBe(true);
    expect(first.results[0].score).toBeTypeOf("number");
    expect(first.results[0].explain).toBeDefined();

    const second = await searchProperties({ city });
    expect(second.cached).toBe(true);
    expect(second.results.map((r) => r.id)).toEqual(first.results.map((r) => r.id));
  });

  it("fiyat sıralamaları ve fiyat/tip/olanak filtreleri DB tarafında uygulanır", async () => {
    const asc = await searchProperties({ city, sort: "price_asc" });
    expect(asc.results.map((r) => r.basePrice)).toEqual([500, 900, 2000]);
    const desc = await searchProperties({ city, sort: "price_desc" });
    expect(desc.results.map((r) => r.basePrice)).toEqual([2000, 900, 500]);
    const rating = await searchProperties({ city, sort: "rating" });
    expect(rating.results[0].id).toBe(pricey.id);

    const ranged = await searchProperties({ city, country: "TEST", minPrice: 600, maxPrice: 1000 });
    expect(ranged.results.map((r) => r.id)).toEqual([otherTypeId]);

    const typed = await searchProperties({ city, propertyType: "APARTMENT" });
    expect(typed.results.map((r) => r.id)).toEqual([otherTypeId]);

    const withAmenity = await searchProperties({ city, amenities: [`Havuz-${stamp}`] });
    expect(withAmenity.results.map((r) => r.id)).toEqual([cheap.id]);
    expect(withAmenity.results[0].amenities).toContain(`Havuz-${stamp}`);

    const bigGroup = await searchProperties({ city, guests: 3 });
    expect(bigGroup.results.map((r) => r.id)).toEqual([pricey.id]);
  });

  it("tarihli arama dolu mülkü eler ve kartta vergi dahil priceStay teklifini gösterir", async () => {
    const res = await searchProperties({ city, checkIn, checkOut, guests: 2, sort: "price_asc" });
    const ids = res.results.map((r) => r.id);
    expect(ids).not.toContain(otherTypeId);
    expect(ids).toEqual([cheap.id, pricey.id]);
    const card = res.results[0];
    expect(card.quote).toMatchObject({ roomId: cheap.roomId, currency: "TRY", nights: 2 });
    // 2 gece × 500 TRY = 100000 minor; %1 konaklama vergisi → 101000
    expect(card.quote!.total).toBe(101000);
    expect(card.totalPrice).toBe(1010);
  });

  it("serbest metin sorgusu başlık/açıklama/şehirde arar; sayfalama uygulanır", async () => {
    const res = await searchProperties({ query: token, city });
    expect(res.results.map((r) => r.id)).toEqual([cheap.id]);

    const paged = await searchProperties({ city, sort: "price_asc", page: 2, pageSize: 2 });
    expect(paged.totalPages).toBe(2);
    expect(paged.results.map((r) => r.basePrice)).toEqual([2000]);
  });

  it("semantik yol: pgvector adaylarını keyword + kişiselleştirme ile harmanlar", async () => {
    expect(await isVectorEnabled()).toBe(true);
    const res = await searchProperties({
      query: `deniz manzaralı ${token}`,
      city,
      semantic: true,
      userId,
    });
    expect(res.semantic).toBe(true);
    expect(res.results[0].id).toBe(cheap.id);
    expect(res.results.every((r) => r.location.city === city)).toBe(true);

    const affinity = await computeAffinity(userId);
    expect(affinity.typeWeights.get("HOTEL")).toBeGreaterThan(0);
  });

  it("fuzzy (pg_trgm) imla hatalı şehir adını yakalar; kısa sözcükleri yok sayar", async () => {
    const typo = city.slice(0, -2); // son iki rakam eksik
    const candidates = await findFuzzyCandidates(typo, 50);
    expect(candidates.some((c) => c.id === cheap.id && c.matchedField === "city")).toBe(true);
    for (let i = 1; i < candidates.length; i++) {
      expect(candidates[i - 1].similarity).toBeGreaterThanOrEqual(candidates[i].similarity);
    }
    expect(await findFuzzyCandidates("a b", 10)).toEqual([]);
  });

  it("popüler mülkler önbelleklenir; geçersiz kılma sürümü artırır ve önbelleği boşaltır", async () => {
    const popular = await getPopularProperties(5);
    expect(popular.length).toBeGreaterThan(0);
    const version = (await redis.get("search:version")) ?? "0";
    // Anahtar sürüm + limit içerir (farklı limitler karışmaz).
    expect(await redis.get(`search:popular:v${version}:5`)).not.toBeNull();
    expect(await redis.get(`search:popular:v${version}:3`)).toBeNull();
    const again = await getPopularProperties(5);
    expect(again.map((p) => p.id)).toEqual(popular.map((p) => p.id));

    const before = Number((await redis.get("search:version")) ?? "0");
    await redis.set(`property:${cheap.id}`, "x");
    await invalidatePropertySearchCache(cheap.id);
    expect(Number(await redis.get("search:version"))).toBe(before + 1);
    expect(await redis.get(`search:popular:v${before + 1}:5`)).toBeNull();
    expect(await redis.get(`property:${cheap.id}`)).toBeNull();

    // Sürüm değişti → aynı parametreler artık önbellekten gelmez.
    const fresh = await searchProperties({ city });
    expect(fresh.cached).toBe(false);
    await invalidateSearchCache();
  });
});
