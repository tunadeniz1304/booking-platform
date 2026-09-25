import { beforeAll, afterAll, it, expect } from "vitest";
import { PrismaClient, Prisma } from "@prisma/client";
import { describeInt, utcDay } from "./helpers";
import golden from "../fixtures/search-golden.json";
import { searchProperties } from "@/lib/search";
import { ndcgAtK } from "@/lib/search/metrics";
import { RANKING_WEIGHTS, rankResults } from "@/lib/search/ranking";
import { cosineSimilarity, encode, encodeTokens, toVectorLiteral } from "@/lib/embedding/embedder";
import { logger } from "@/lib/observability/logger";

/**
 * P1-1 kabul ölçütü (v3#19): 30 sorguluk altın kümede hibrit RRF aramasının ortalama
 * nDCG@10'u v2 taban çizgisinin en az %15 üzerinde olmalı.
 *
 * v2 taban çizgisi iki yolun İYİSİ alınarak öykünülür (v2 kodu artık yok):
 *  - alt-dize: sorgunun tamamı başlık/açıklama/şehirde geçen ilanlar, v2 ağırlıklarıyla;
 *  - v2 semantik: eski belirteçleyici (NFKD, eşanlamsız) + aynı karma gömme, kosinüs ile
 *    v2 ağırlıklı sıralama (semantic ağırlığı 0.15).
 * Veri benzersiz ülke koduyla yalıtılır (paylaşılan DB).
 */

interface GoldenDoc {
  key: string;
  city: string;
  type: "HOTEL" | "APARTMENT" | "VILLA";
  title: string;
  description: string;
}
interface GoldenQuery {
  q: string;
  grades: Record<string, number>;
}

const docs = golden.docs as GoldenDoc[];
const queries = golden.queries as unknown as GoldenQuery[];

const V2_STOP_WORDS = new Set(
  "ve bir ile için bu da de en çok olan the a an of for in on to and is at".split(" ")
);
function v2Tokenize(text: string): string[] {
  return text
    .toLocaleLowerCase("tr-TR")
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !V2_STOP_WORDS.has(t));
}

/** Fiyat/puan belge sırasından deterministik türetilir (metinden bağımsız gürültü). */
function attrs(index: number) {
  return {
    price: 400 + ((index * 137) % 2000),
    rating: 3.5 + ((index * 7) % 15) / 10,
    ratingCount: 5 + ((index * 13) % 80),
  };
}

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

describeInt("altın küme: hibrit RRF vs v2 (integration)", () => {
  const prisma = new PrismaClient();
  const stamp = Date.now();
  const country = `GOLD${stamp}`;
  const idOf = new Map<string, string>();
  const keyOf = new Map<string, string>();
  let userId = "";

  beforeAll(async () => {
    const host = await prisma.user.create({
      data: {
        email: `golden-${stamp}@t.test`,
        passwordHash: "x",
        firstName: "G",
        lastName: "S",
        role: "HOST",
      },
    });
    userId = host.id;
    for (const [i, doc] of docs.entries()) {
      const { price, rating, ratingCount } = attrs(i);
      const location = await prisma.location.upsert({
        where: { city_country: { city: doc.city, country } },
        update: {},
        create: { city: doc.city, country, latitude: 39, longitude: 32 },
      });
      const property = await prisma.property.create({
        data: {
          licenseStatus: "VERIFIED",
          hostId: host.id,
          title: doc.title,
          description: doc.description,
          propertyType: doc.type,
          locationId: location.id,
          basePrice: new Prisma.Decimal(price),
          currency: "TRY",
          ratingAvg: rating,
          ratingCount,
        },
      });
      const room = await prisma.roomType.create({
        data: {
          propertyId: property.id,
          name: "Oda",
          maxOccupancy: 2,
          bedType: "Çift",
          priceModifier: new Prisma.Decimal(0),
          ratePlans: { create: [{ code: "STANDARD", name: "Standart", isDefault: true }] },
        },
      });
      await prisma.inventoryDay.createMany({
        data: Array.from({ length: 3 }, (_, d) => ({
          roomTypeId: room.id,
          date: utcDay(d + 1),
          price: new Prisma.Decimal(price),
          total: 1,
        })),
      });
      const literal = toVectorLiteral(encode(`${doc.title} ${doc.description} ${doc.city}`));
      await prisma.$executeRaw`UPDATE "Property" SET embedding = ${literal}::vector WHERE id = ${property.id}`;
      idOf.set(doc.key, property.id);
      keyOf.set(property.id, doc.key);
    }
  }, 120_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const gradesFor = (q: GoldenQuery) =>
    new Map(Object.entries(q.grades).map(([k, g]) => [idOf.get(k)!, g]));

  function v2Semantic(q: string): string[] {
    const qv = encodeTokens(v2Tokenize(q));
    const items = docs.map((d, i) => {
      const a = attrs(i);
      const dv = encodeTokens(v2Tokenize(`${d.title} ${d.description} ${d.city}`));
      return {
        id: idOf.get(d.key)!,
        price: a.price * 100,
        ratingAvg: a.rating,
        ratingCount: a.ratingCount,
        semantic: Math.max(0, cosineSimilarity(qv, dv)),
      };
    });
    return rankResults(items, RANKING_WEIGHTS).map((r) => r.id);
  }

  function v2Substring(q: string): string[] {
    const needle = q.toLocaleLowerCase("tr-TR");
    const items = docs.flatMap((d, i) => {
      const hay = [d.title, d.description, d.city].map((s) => s.toLocaleLowerCase("tr-TR"));
      if (!hay.some((h) => h.includes(needle))) return [];
      const a = attrs(i);
      return [
        {
          id: idOf.get(d.key)!,
          price: a.price * 100,
          ratingAvg: a.rating,
          ratingCount: a.ratingCount,
        },
      ];
    });
    return rankResults(items, RANKING_WEIGHTS).map((r) => r.id);
  }

  it("regression: v3#19 hibrit nDCG@10 ≥ 1.15 × v2 taban çizgisi (30 sorgu)", async () => {
    const semantic: number[] = [];
    const substring: number[] = [];
    const hybrid: number[] = [];
    const ltr: number[] = [];
    const perQuery: Array<{ q: string; v2: number; hybrid: number }> = [];
    for (const q of queries) {
      const grades = gradesFor(q);
      const s = ndcgAtK(v2Semantic(q.q), grades);
      const sub = ndcgAtK(v2Substring(q.q), grades);
      const res = await searchProperties({ query: q.q, country, pageSize: 20 });
      expect(res.results.every((r) => keyOf.has(r.id))).toBe(true);
      const h = ndcgAtK(
        res.results.map((r) => r.id),
        grades
      );
      const l = await searchProperties({ query: q.q, country, pageSize: 20 }, { ranking: "ltr" });
      semantic.push(s);
      substring.push(sub);
      hybrid.push(h);
      ltr.push(
        ndcgAtK(
          l.results.map((r) => r.id),
          grades
        )
      );
      perQuery.push({ q: q.q, v2: Math.max(s, sub), hybrid: h });
    }
    const baseline = Math.max(mean(semantic), mean(substring));
    const summary = {
      v2Semantic: mean(semantic),
      v2Substring: mean(substring),
      baseline,
      hybrid: mean(hybrid),
      ltrArm: mean(ltr),
      lift: mean(hybrid) / baseline - 1,
    };
    logger.info({ summary, perQuery }, "golden set nDCG@10");
    expect(queries).toHaveLength(30);
    expect(summary.hybrid).toBeGreaterThanOrEqual(baseline * 1.15);
  }, 120_000);

  it("regression: v3#19 semantik bayrak olmadan da anahtar sözcük sorgusu ilgi skoru taşır; favori kişisel bileşeni doldurur", async () => {
    // v2'de semantic yalnız `semantic=true` ile hesaplanıyordu; varsayılan aramada 0'dı.
    const plain = await searchProperties({ query: "şömineli dağ evi", country });
    expect(plain.semantic).toBe(true);
    expect(plain.results[0].explain!.semantic).toBeGreaterThan(0);
    expect(["d06", "d26"]).toContain(keyOf.get(plain.results[0].id));

    await prisma.favorite.create({ data: { userId, propertyId: idOf.get("d06")! } });
    const personal = await searchProperties({ query: "dağ evi", country, userId });
    expect(personal.results.some((r) => (r.explain!.personal ?? 0) > 0)).toBe(true);
  });

  it("yazım hatalı şehir trigram kanalıyla bulunur (Bodrm → Bodrum)", async () => {
    const res = await searchProperties({ query: "Bodrm", country });
    const top3 = res.results.slice(0, 3).map((r) => keyOf.get(r.id));
    expect(top3.sort()).toEqual(["d01", "d02", "d28"]);
  });
});
