import "server-only";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { getConfig } from "@/lib/config/app-config";
import { getLlmClient } from "@/lib/llm/client";
import { getEmbedder } from "@/lib/embedding/provider";
import { NotFoundError } from "@/lib/http/errors";
import { logger } from "@/lib/observability/logger";
import {
  buildReviewHighlights,
  reviewSetHash,
  type HighlightLocale,
  type HighlightReview,
  type HighlightsConfig,
  type HighlightsResult,
} from "./review-highlights-core";

export type { HighlightsResult, HighlightCluster, HighlightClaim } from "./review-highlights-core";

export interface ReviewHighlightsResponse extends HighlightsResult {
  propertyId: string;
  cached: boolean;
}

export function highlightsConfig(): HighlightsConfig {
  const c = getConfig();
  return {
    minReviews: c.REVIEW_HIGHLIGHTS_MIN_REVIEWS,
    maxClusters: c.REVIEW_HIGHLIGHTS_MAX_CLUSTERS,
    seed: c.REVIEW_HIGHLIGHTS_KMEANS_SEED,
    maxIterations: c.REVIEW_HIGHLIGHTS_KMEANS_MAX_ITERATIONS,
    maxClaims: c.REVIEW_HIGHLIGHTS_MAX_CLAIMS,
    minQuoteChars: c.REVIEW_HIGHLIGHTS_MIN_QUOTE_CHARS,
  };
}

/**
 * Bir ilanın yayınlanmış yorumlarından tema öne çıkanları (v4 P1-9). Sonuç, yorum
 * setinin karmasıyla (id + puan + metin + dil + LLM modu + ayarlar) Redis'te önbelleğe
 * alınır: yeni/silinen/düzenlenen yorum → yeni anahtar. `fallback` sonuçlar önbelleğe
 * girmez (bir sonraki istek canlı dener).
 */
export async function getReviewHighlights(
  propertyId: string,
  locale: HighlightLocale
): Promise<ReviewHighlightsResponse> {
  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    select: { id: true },
  });
  if (!property) throw new NotFoundError("İlan bulunamadı");

  const config = highlightsConfig();
  const rows = await prisma.review.findMany({
    where: { propertyId, moderationStatus: "PUBLISHED", comment: { not: null } },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: getConfig().REVIEW_HIGHLIGHTS_MAX_REVIEWS,
    select: {
      id: true,
      rating: true,
      comment: true,
      user: { select: { firstName: true, lastName: true } },
    },
  });
  const reviews: HighlightReview[] = rows.map((r) => ({
    id: r.id,
    rating: r.rating,
    comment: r.comment ?? "",
    author: `${r.user.firstName} ${r.user.lastName}`.trim(),
  }));

  const client = getLlmClient();
  const embedder = getEmbedder();
  const ttl = getConfig().REVIEW_HIGHLIGHTS_CACHE_TTL_SECONDS;
  const cacheKey = `review-highlights:v1:${propertyId}:${reviewSetHash(reviews, {
    locale,
    mode: client.settings.effectiveMode,
    model: client.settings.model,
    embedder: embedder.name,
    config,
  })}`;
  if (ttl > 0) {
    const cached = await redis.get(cacheKey).catch(() => null);
    if (cached) {
      return { ...(JSON.parse(cached) as HighlightsResult), propertyId, cached: true };
    }
  }

  const result = await buildReviewHighlights(reviews, { client, embedder, locale, config });
  if (result.rejectedClaims > 0) {
    logger.info(
      { propertyId, rejectedClaims: result.rejectedClaims, llmMode: result.llmMode },
      "review highlights: guard rejected claims"
    );
  }
  if (ttl > 0 && result.llmMode !== "fallback") {
    await redis.set(cacheKey, JSON.stringify(result), { ex: ttl }).catch(() => null);
  }
  return { ...result, propertyId, cached: false };
}
