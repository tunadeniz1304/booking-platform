import { createHash } from "node:crypto";
import { z } from "zod";
import type { LlmClient, LlmMode } from "@/lib/llm/client";
import {
  GuardError,
  buildFactSet,
  filterQuotedClaims,
  findUngroundedNumbers,
  type FactSet,
  type QuoteSource,
} from "@/lib/llm/guards";
import { redactText } from "@/lib/llm/redaction";
import { splitWords } from "@/lib/embedding/embedder";
import { foldToken } from "@/lib/embedding/synonyms";
import type { Embedder } from "@/lib/embedding/provider";
import { kmeans, cosineDistance, normalize as normalizeVec } from "@/lib/reviews/kmeans";
import { mapLimit } from "@/lib/resilience/limit";

/**
 * AI yorum öne çıkanları (v4 P1-9) — saf çekirdek (DB/Redis yok; birim testlenir).
 *
 * Akış: yorumlar cümlelere bölünür → cümleler KVKK redaksiyonundan geçip mevcut
 * embedding altyapısıyla (`getEmbedder`) vektörlenir → tohumlu k-means ile temalara
 * kümelenir → her küme için LLM (yalnızca `src/lib/llm/client.ts`) bir başlık ve
 * alıntılı iddialar üretir. Guard: her iddianın `quote`'u kaynak yorumda BİREBİR
 * bulunmalı ve metindeki her sayı yorum verisinde olmalı; aksi hâlde iddia reddedilir,
 * hiçbir iddia kalmazsa küme deterministik demo özetine düşer (`fallback`).
 * Demo özetleri gerçek yorum cümlelerinden seçilir (merkeze en yakın cümleler).
 */

export type HighlightLocale = "tr" | "en";

export interface HighlightReview {
  id: string;
  rating: number;
  comment: string;
  /** Redaksiyonda maskelenecek yazar adı. */
  author?: string;
}

export interface HighlightClaim {
  text: string;
  /** Kaynak yorumdan BİREBİR alıntı. */
  quote: string;
  reviewId: string;
  /** Alıntının yorum metnindeki [start, end) aralığı. */
  start: number;
  end: number;
}

export type HighlightSentiment = "positive" | "mixed" | "negative";

export interface HighlightCluster {
  id: string;
  title: string;
  sentiment: HighlightSentiment;
  /** Bu temadan söz eden farklı yorum sayısı (deterministik sayım). */
  mentionCount: number;
  avgRating: number;
  reviewIds: string[];
  claims: HighlightClaim[];
  llmMode: LlmMode;
}

export interface HighlightsResult {
  locale: HighlightLocale;
  reviewCount: number;
  setHash: string;
  llmMode: LlmMode;
  clusters: HighlightCluster[];
  /** Guard'ın reddettiği iddia sayısı (şeffaflık/izleme). */
  rejectedClaims: number;
}

export interface HighlightsConfig {
  minReviews: number;
  maxClusters: number;
  seed: number;
  maxIterations: number;
  maxClaims: number;
  minQuoteChars: number;
}

export interface Sentence {
  reviewId: string;
  text: string;
  start: number;
  end: number;
}

const SENTENCE_RE = /[^.!?…\n]+[.!?…]*/gu;

/** Yorumu cümlelere böler; her cümlenin özgün metindeki aralığını korur. */
export function splitSentences(review: Pick<HighlightReview, "id" | "comment">): Sentence[] {
  const out: Sentence[] = [];
  for (const match of review.comment.matchAll(SENTENCE_RE)) {
    const raw = match[0];
    const lead = raw.length - raw.trimStart().length;
    const text = raw.trim();
    if (splitWords(text).length === 0) continue;
    const start = (match.index ?? 0) + lead;
    out.push({ reviewId: review.id, text, start, end: start + text.length });
  }
  return out;
}

/** Yorum setinin kararlı karması (id sırasından bağımsız) + bağlam (dil, mod, ayarlar). */
export function reviewSetHash(reviews: readonly HighlightReview[], context: unknown): string {
  const canonical = [...reviews]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((r) => [r.id, r.rating, r.comment]);
  return createHash("sha256")
    .update(JSON.stringify({ canonical, context }))
    .digest("hex")
    .slice(0, 32);
}

function sentimentOf(avg: number): HighlightSentiment {
  if (avg >= 4) return "positive";
  if (avg <= 2.5) return "negative";
  return "mixed";
}

/** Kümedeki en sık anlamlı sözcük (katlanmış biçimle sayılır, ilk görülen yazımla döner). */
export function topKeyword(sentences: readonly Sentence[]): string | null {
  const counts = new Map<string, { n: number; first: number; display: string }>();
  let order = 0;
  for (const s of sentences) {
    const seen = new Set<string>();
    for (const word of splitWords(s.text)) {
      const key = foldToken(word);
      if (key.length < 3 || /^\d+$/.test(key) || seen.has(key)) continue;
      seen.add(key);
      const entry = counts.get(key);
      if (entry) entry.n++;
      else counts.set(key, { n: 1, first: order++, display: word });
    }
  }
  let best: { n: number; first: number; display: string } | null = null;
  for (const entry of counts.values()) {
    if (!best || entry.n > best.n || (entry.n === best.n && entry.first < best.first)) best = entry;
  }
  return best ? best.display : null;
}

function capitalize(word: string, locale: HighlightLocale): string {
  return word.charAt(0).toLocaleUpperCase(locale === "tr" ? "tr-TR" : "en-US") + word.slice(1);
}

const DEMO_TITLE: Record<HighlightLocale, (w: string) => string> = {
  tr: (w) => `Öne çıkan konu: ${w}`,
  en: (w) => `Recurring topic: ${w}`,
};
const DEMO_FALLBACK_TITLE: Record<HighlightLocale, string> = {
  tr: "Diğer görüşler",
  en: "Other feedback",
};

const llmSchema = z.object({
  title: z.string().trim().min(1).max(80),
  claims: z
    .array(
      z.object({
        text: z.string().trim().min(1).max(240),
        quote: z.string().max(400).optional().nullable(),
        reviewId: z.string().max(64).optional().nullable(),
        start: z.number().int().optional(),
        end: z.number().int().optional(),
      })
    )
    .max(8),
});
type LlmClusterOutput = z.infer<typeof llmSchema>;

interface PreparedCluster {
  id: string;
  sentences: Sentence[];
  /** Merkeze yakınlığa göre sıralı temsilci cümleler. */
  ranked: Sentence[];
  reviews: HighlightReview[];
  avgRating: number;
  facts: FactSet;
}

/** Demo/fallback: merkeze en yakın, farklı yorumlardan gelen gerçek cümleler. */
export function demoCluster(
  cluster: Pick<PreparedCluster, "ranked" | "sentences">,
  locale: HighlightLocale,
  cfg: Pick<HighlightsConfig, "maxClaims" | "minQuoteChars">
): { title: string; claims: HighlightClaim[] } {
  const keyword = topKeyword(cluster.sentences);
  const title = keyword
    ? DEMO_TITLE[locale](capitalize(keyword, locale))
    : DEMO_FALLBACK_TITLE[locale];
  const claims: HighlightClaim[] = [];
  const usedReviews = new Set<string>();
  const pick = (s: Sentence) => {
    claims.push({ text: s.text, quote: s.text, reviewId: s.reviewId, start: s.start, end: s.end });
    usedReviews.add(s.reviewId);
  };
  const eligible = cluster.ranked.filter((s) => s.text.length >= cfg.minQuoteChars);
  for (const s of eligible) {
    if (claims.length >= cfg.maxClaims) break;
    if (!usedReviews.has(s.reviewId)) pick(s);
  }
  if (claims.length === 0 && cluster.ranked.length > 0) pick(cluster.ranked[0]);
  return { title, claims };
}

function systemPrompt(locale: HighlightLocale, maxClaims: number): string {
  const lang = locale === "tr" ? "Türkçe" : "English";
  return (
    `Misafir yorumlarından bir TEMA özetle. Dil: ${lang}. Yalnızca JSON döndür: ` +
    `{"title": string, "claims": [{"text": string, "quote": string, "reviewId": string}]}. ` +
    `En fazla ${maxClaims} iddia. Her iddianın "quote" alanı, "reviewId" ile belirtilen yorumdan ` +
    `KARAKTERİ KARAKTERİNE kopyalanmış bir parça olmalı (değiştirme, çevirme, kısaltma yok). ` +
    `Yorumlarda olmayan bilgi veya sayı yazma; puan/fiyat uydurma. Karar/tavsiye verme.`
  );
}

function clusterPrompt(cluster: PreparedCluster): string {
  const lines = cluster.reviews.map((r) => `[r:${r.id}] (${r.rating}/5) ${r.comment}`);
  const focus = cluster.ranked.slice(0, 8).map((s) => `- [r:${s.reviewId}] ${s.text}`);
  return `Yorumlar:\n${lines.join("\n")}\n\nTemanın cümleleri:\n${focus.join("\n")}`;
}

export interface BuildHighlightsDeps {
  client: LlmClient;
  embedder: Embedder;
  locale: HighlightLocale;
  config: HighlightsConfig;
  /** Kümeler arası eşzamanlı LLM çağrısı (süreç limiti ayrıca `client` içinde). */
  concurrency?: number;
}

/**
 * Yorumlardan tema öne çıkanlarını üretir. Aynı girdi + aynı ayarlar → aynı kümeler;
 * demo modda çıktı tamamen deterministiktir.
 */
export async function buildReviewHighlights(
  input: readonly HighlightReview[],
  deps: BuildHighlightsDeps
): Promise<HighlightsResult> {
  const { client, embedder, locale, config } = deps;
  const reviews = [...input]
    .filter((r) => r.comment.trim().length > 0)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const context = {
    locale,
    mode: client.settings.effectiveMode,
    model: client.settings.model,
    embedder: embedder.name,
    config,
  };
  const setHash = reviewSetHash(reviews, context);
  const base = { locale, reviewCount: reviews.length, setHash, rejectedClaims: 0 };
  const demoMode: LlmMode = client.settings.effectiveMode === "demo" ? "demo" : "live";
  if (reviews.length < config.minReviews) {
    return { ...base, llmMode: demoMode, clusters: [] };
  }

  const sentences = reviews.flatMap(splitSentences);
  if (sentences.length === 0) return { ...base, llmMode: demoMode, clusters: [] };
  const knownNames = reviews.flatMap((r) => (r.author ? [r.author] : []));
  // KVKK: embedding'e giden metin de redakte edilir (uzak sağlayıcı ayrıca redakte eder).
  const vectors = await embedder.embed(sentences.map((s) => redactText(s.text, knownNames)));
  const k = Math.min(config.maxClusters, Math.max(1, Math.ceil(Math.sqrt(sentences.length / 2))));
  const km = kmeans(vectors, { k, seed: config.seed, maxIterations: config.maxIterations });

  const byId = new Map(reviews.map((r) => [r.id, r]));
  const prepared: PreparedCluster[] = km.clusters.map((c, idx) => {
    const members = c.members.map((i) => ({ s: sentences[i], v: vectors[i], i }));
    const ranked = members
      .map((m) => ({ ...m, d: cosineDistance(normalizeVec(m.v), c.centroid) }))
      .sort((a, b) => a.d - b.d || a.i - b.i)
      .map((m) => m.s);
    const reviewIds = [...new Set(ranked.map((s) => s.reviewId))];
    const clusterReviews = reviewIds.map((id) => byId.get(id)!);
    const avgRating =
      Math.round((clusterReviews.reduce((s, r) => s + r.rating, 0) / clusterReviews.length) * 10) /
      10;
    const facts = buildFactSet([
      reviews.length,
      clusterReviews.length,
      avgRating,
      5,
      ...clusterReviews.map((r) => r.rating),
      ...clusterReviews.map((r) => r.comment),
    ]);
    return {
      id: `t${idx + 1}`,
      sentences: members.map((m) => m.s),
      ranked,
      reviews: clusterReviews,
      avgRating,
      facts,
    };
  });

  let rejectedClaims = 0;
  const clusters = await mapLimit(prepared, deps.concurrency ?? 2, async (cluster) => {
    const sources: QuoteSource[] = cluster.reviews.map((r) => ({ id: r.id, text: r.comment }));
    const demo = (): LlmClusterOutput => demoCluster(cluster, locale, config);
    const result = await client.completeJson(
      "review_highlights",
      llmSchema,
      [
        { role: "system", content: systemPrompt(locale, config.maxClaims) },
        { role: "user", content: clusterPrompt(cluster) },
      ],
      {
        demo,
        knownNames,
        validate: (data) => {
          if (findUngroundedNumbers(data.title, cluster.facts).length > 0) {
            throw new GuardError("ungrounded_number", [data.title]);
          }
          const guarded = filterQuotedClaims(
            data.claims.map((c) => ({ text: c.text, quote: c.quote ?? "", sourceId: c.reviewId })),
            sources,
            { facts: cluster.facts, minQuoteLength: config.minQuoteChars }
          );
          rejectedClaims += guarded.rejected.length;
          if (guarded.accepted.length === 0) {
            throw new GuardError(
              "ungrounded_quote",
              guarded.rejected.map((r) => r.claim.quote)
            );
          }
          return {
            title: data.title,
            claims: guarded.accepted.slice(0, config.maxClaims).map((c) => ({
              text: c.text,
              quote: c.quote,
              reviewId: c.sourceId,
              start: c.start,
              end: c.end,
            })),
          };
        },
      }
    );
    const claims: HighlightClaim[] = result.data.claims.map((c) => ({
      text: c.text,
      quote: c.quote ?? "",
      reviewId: c.reviewId ?? "",
      start: c.start ?? 0,
      end: c.end ?? 0,
    }));
    const cl: HighlightCluster = {
      id: cluster.id,
      title: result.data.title,
      sentiment: sentimentOf(cluster.avgRating),
      mentionCount: cluster.reviews.length,
      avgRating: cluster.avgRating,
      reviewIds: cluster.reviews.map((r) => r.id),
      claims,
      llmMode: result.llmMode,
    };
    return cl;
  });

  const llmMode: LlmMode = clusters.some((c) => c.llmMode === "fallback")
    ? "fallback"
    : clusters.every((c) => c.llmMode === "demo")
      ? "demo"
      : "live";
  return { ...base, llmMode, clusters, rejectedClaims };
}
