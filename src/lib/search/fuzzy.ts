import { prisma } from "@/lib/prisma";

/**
 * PostgreSQL pg_trgm tabanlı fuzzy (yaklaşık) metin arama.
 * `similarity(a, b)` trigram benzerliğini 0..1 ölçer; imla hatalarını hoş görür.
 * Adaylar her sorgu kelimesi için ayrı taranıp mülk başına en yüksek skorla
 * birleştirilir (değer aralığı 0..1).
 */
export interface FuzzyCandidate {
  id: string;
  /** 0..1 trigram benzerliği (mülkün alanlarındaki en iyi eşleşme). */
  similarity: number;
  matchedField: "title" | "description" | "city" | "country";
}

const SIMILARITY_THRESHOLD = 0.2;
const MAX_WORDS = 4;

export async function findFuzzyCandidates(
  query: string,
  limit = 30
): Promise<FuzzyCandidate[]> {
  const words = query
    .toLocaleLowerCase("tr-TR")
    .split(/\s+/)
    .filter((w) => w.length >= 2)
    .slice(0, MAX_WORDS);
  if (words.length === 0) return [];

  // mülkId -> en iyi (skor, alan) haritası
  const best = new Map<string, { similarity: number; matchedField: FuzzyCandidate["matchedField"] }>();

  for (const word of words) {
    const rows = await prisma.$queryRaw<
      Array<{ id: string; field: FuzzyCandidate["matchedField"]; s: number }>
    >`
      SELECT sub.id, sub.field, sub.s
      FROM (
        SELECT p.id, 'title'::text AS field, similarity(${word}, p."title") AS s FROM "Property" p
        UNION ALL
        SELECT p.id, 'description', similarity(${word}, p."description") FROM "Property" p
        UNION ALL
        SELECT p.id, 'city', similarity(${word}, l."city") FROM "Property" p JOIN "Location" l ON l.id = p."locationId"
        UNION ALL
        SELECT p.id, 'country', similarity(${word}, l."country") FROM "Property" p JOIN "Location" l ON l.id = p."locationId"
      ) sub
      WHERE sub.s >= ${SIMILARITY_THRESHOLD}
      ORDER BY sub.s DESC
      LIMIT ${limit}
    `;

    for (const row of rows) {
      const prev = best.get(row.id);
      if (!prev || row.s > prev.similarity) {
        best.set(row.id, { similarity: row.s, matchedField: row.field });
      }
    }
  }

  return [...best.entries()]
    .sort((a, b) => b[1].similarity - a[1].similarity)
    .slice(0, limit)
    .map(([id, v]) => ({ id, similarity: v.similarity, matchedField: v.matchedField }));
}
