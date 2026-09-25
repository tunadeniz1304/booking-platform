import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getConfig } from "@/lib/config/app-config";
import { splitWords, toVectorLiteral } from "@/lib/embedding/embedder";
import { expandSynonyms } from "@/lib/embedding/synonyms";
import { embedText } from "@/lib/embedding/provider";
import { isVectorEnabled } from "@/lib/search/vector";

/**
 * Hibrit arama (P1-1, v3#19) — sözcüksel + vektör + trigram kanallarının tek SQL CTE'de
 * Reciprocal Rank Fusion ile birleştirilmesi:
 *
 *   rrf(d) = Σ_kanal 1 / (RRF_K + sıra_kanal(d))
 *
 *  - **lex**: `Property.searchVector` (GENERATED; `simple` + `turkish`, GIN) ∪ konum adı;
 *    sorgu sözcükleri eşanlamlılarla genişletilir, 3+ harfte önek eşleşmesi (`:*`).
 *  - **vec**: pgvector `<=>` kosinüs; `SEARCH_HYBRID_MIN_SIMILARITY` altı atılır
 *    (pgvector yoksa kanal boş).
 *  - **trg**: pg_trgm `word_similarity` (yazım hatası: "Bodurm" → Bodrum).
 *  - **phr**: tam ifade (v2 alt-dize anlamı) başlık/açıklama/şehirde geçiyorsa sıra 1.
 *    RRF sıra tabanlı olduğundan kanallar arası farkı sıkıştırır; bu kanal kesin eşleşmenin
 *    (ör. tam ilan adı) ortak sözcüklü ilanların önüne geçmesini sağlar.
 *
 * Yapısal filtreler (şehir/ülke/tip) kanallardan ÖNCE uygulanır; olanak/kişi/fiyat
 * filtresi katalog aşamasında kalır. Skorlar yalnız sıralamada kullanılır, filtrelemede değil.
 */

export interface HybridHit {
  id: string;
  rrf: number;
  lexRank: number | null;
  lexScore: number;
  vecRank: number | null;
  vecSim: number;
  trgSim: number;
}

export interface HybridFilters {
  city?: string;
  country?: string;
  propertyType?: string;
}

/** Sorgudan alınan en fazla sözcük (tsquery/trigram maliyet sınırı). */
const MAX_QUERY_WORDS = 8;
/** Önek eşleşmesi (`:*`) için en kısa sözcük. */
const PREFIX_MIN_LENGTH = 3;
/** Trigram kanalına giren en kısa sözcük (kısa sözcüklerde trigram gürültülüdür). */
const TRGM_MIN_LENGTH = 4;

const TERM_RE = /^[\p{L}\p{N}]+$/u;
/** Trigram yalnız harf sözcüklerinde: rakam dizileri (kod, yıl) ortak trigramla sahte eşleşir. */
const TRGM_WORD_RE = /^\p{L}+$/u;
/** Tam ifade kanalına giren en kısa sorgu (kısa ifadeler her yerde geçer). */
const PHRASE_MIN_LENGTH = 3;

/** Sorgudan güvenli tsquery ifadesi (`a:* | b | …`) üretir; terim yoksa null. */
export function buildTsQuery(query: string): string | null {
  const terms = new Set<string>();
  for (const word of splitWords(query).slice(0, MAX_QUERY_WORDS)) {
    for (const term of expandSynonyms(word)) {
      const t = term.toLocaleLowerCase("tr-TR");
      if (TERM_RE.test(t)) terms.add(t.length >= PREFIX_MIN_LENGTH ? `${t}:*` : t);
    }
  }
  return terms.size > 0 ? [...terms].join(" | ") : null;
}

/** Saf RRF (test ve LTR özellikleri için): sıralı id listelerini birleştirir. */
export function rrfFuse(lists: string[][], k: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const list of lists) {
    list.forEach((id, index) => out.set(id, (out.get(id) ?? 0) + 1 / (k + index + 1)));
  }
  return out;
}

export async function hybridSearch(
  query: string,
  filters: HybridFilters = {}
): Promise<HybridHit[]> {
  const cfg = getConfig();
  const text = query.trim();
  if (!text) return [];
  const tsq = buildTsQuery(text);
  const words = splitWords(text)
    .slice(0, MAX_QUERY_WORDS)
    .filter((w) => w.length >= TRGM_MIN_LENGTH && TRGM_WORD_RE.test(w));
  const limit = cfg.SEARCH_HYBRID_CANDIDATES;
  const phrase = text.toLocaleLowerCase("tr-TR");

  const where: Prisma.Sql[] = [Prisma.sql`p."isActive" = true`];
  if (filters.city) where.push(Prisma.sql`lower(l.city) = lower(${filters.city})`);
  if (filters.country) where.push(Prisma.sql`lower(l.country) = lower(${filters.country})`);
  if (filters.propertyType) {
    where.push(Prisma.sql`p."propertyType"::text = ${filters.propertyType}`);
  }

  const vectorOn = await isVectorEnabled();
  const selectEmbedding = vectorOn ? Prisma.sql`, p.embedding` : Prisma.empty;

  const lexCte = tsq
    ? Prisma.sql`
      SELECT id, row_number() OVER (ORDER BY score DESC, id) AS rank, score
      FROM (
        SELECT b.id, ts_rank_cd(b.doc, q.q)::float8 AS score
        FROM base b,
             (SELECT to_tsquery('simple', ${tsq}) || to_tsquery('turkish', ${tsq}) AS q) q
        WHERE b.doc @@ q.q
        ORDER BY score DESC, b.id
        LIMIT ${limit}
      ) s`
    : Prisma.sql`SELECT NULL::text AS id, NULL::bigint AS rank, NULL::float8 AS score WHERE false`;

  let vecCte = Prisma.sql`SELECT NULL::text AS id, NULL::bigint AS rank, NULL::float8 AS sim WHERE false`;
  if (vectorOn) {
    const literal = toVectorLiteral(await embedText(text));
    vecCte = Prisma.sql`
      SELECT id, row_number() OVER (ORDER BY sim DESC, id) AS rank, sim
      FROM (
        SELECT b.id, (1 - (b.embedding <=> ${literal}::vector))::float8 AS sim
        FROM base b
        WHERE b.embedding IS NOT NULL
        ORDER BY b.embedding <=> ${literal}::vector, b.id
        LIMIT ${limit}
      ) s
      WHERE sim >= ${cfg.SEARCH_HYBRID_MIN_SIMILARITY}`;
  }

  const trgCte =
    words.length > 0
      ? Prisma.sql`
      SELECT id, row_number() OVER (ORDER BY sim DESC, id) AS rank, sim
      FROM (
        SELECT b.id,
               max(greatest(word_similarity(w, b.title), word_similarity(w, b.city)))::float8 AS sim
        FROM base b, unnest(${words}::text[]) AS w
        GROUP BY b.id
      ) s
      WHERE sim >= ${cfg.SEARCH_HYBRID_MIN_TRGM}
      ORDER BY sim DESC, id
      LIMIT ${limit}`
      : Prisma.sql`SELECT NULL::text AS id, NULL::bigint AS rank, NULL::float8 AS sim WHERE false`;

  const phrCte =
    phrase.length >= PHRASE_MIN_LENGTH
      ? Prisma.sql`
      SELECT b.id, 1::bigint AS rank
      FROM base b
      WHERE position(${phrase} IN lower(b.title || ' ' || b.description || ' ' || b.city)) > 0
      LIMIT ${limit}`
      : Prisma.sql`SELECT NULL::text AS id, NULL::bigint AS rank WHERE false`;

  const k = cfg.SEARCH_RRF_K;
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      rrf: number;
      lex_rank: bigint | null;
      lex_score: number | null;
      vec_rank: bigint | null;
      vec_sim: number | null;
      trg_sim: number | null;
    }>
  >`
    WITH base AS (
      SELECT p.id, p.title, p.description, l.city,
             coalesce(p."searchVector", ''::tsvector)
               || to_tsvector('simple', l.city || ' ' || l.country) AS doc
             ${selectEmbedding}
      FROM "Property" p JOIN "Location" l ON l.id = p."locationId"
      WHERE ${Prisma.join(where, " AND ")}
    ),
    lex AS (${lexCte}),
    vec AS (${vecCte}),
    trg AS (${trgCte}),
    phr AS (${phrCte}),
    fused AS (
      SELECT id, SUM(1.0 / (${k} + rank))::float8 AS rrf
      FROM (
        SELECT id, rank FROM lex
        UNION ALL SELECT id, rank FROM vec
        UNION ALL SELECT id, rank FROM trg
        UNION ALL SELECT id, rank FROM phr
      ) u
      GROUP BY id
    )
    SELECT f.id, f.rrf, lex.rank AS lex_rank, lex.score AS lex_score,
           vec.rank AS vec_rank, vec.sim AS vec_sim, trg.sim AS trg_sim
    FROM fused f
    LEFT JOIN lex ON lex.id = f.id
    LEFT JOIN vec ON vec.id = f.id
    LEFT JOIN trg ON trg.id = f.id
    ORDER BY f.rrf DESC, f.id`;

  return rows.map((r) => ({
    id: r.id,
    rrf: Number(r.rrf),
    lexRank: r.lex_rank === null ? null : Number(r.lex_rank),
    lexScore: Number(r.lex_score ?? 0),
    vecRank: r.vec_rank === null ? null : Number(r.vec_rank),
    vecSim: Number(r.vec_sim ?? 0),
    trgSim: Number(r.trg_sim ?? 0),
  }));
}
