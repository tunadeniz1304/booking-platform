import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { getLlmClient, type LlmMode } from "@/lib/llm/client";
import { demoReviewSummary, type ReviewSummary } from "@/lib/llm/demo";
import {
  assertCitationsGrounded,
  assertNumbersGrounded,
  buildFactSet,
  extractCitations,
} from "@/lib/llm/guards";
import { reviewsVersion } from "@/lib/reviews/review-service";

/**
 * Atıflı yorum özeti (P1-4). Son N yorum KVKK redaksiyonundan geçerek LLM'e gider;
 * çıktıdaki her `[r:<id>]` verilen yorum kimliklerinden biri olmalı, metindeki her
 * sayı yorum verisinden türetilmiş olmalı (aksi hâlde demo özetine düşülür).
 * Önbellek anahtarı yorum sürümünü içerir → yeni yorumda özet yenilenir.
 */
const schema = z.object({
  summary: z.string().min(1).max(800),
  pros: z.array(z.string().max(300)).max(5),
  cons: z.array(z.string().max(300)).max(5),
  citations: z.array(z.string()).max(20),
});

const MAX_REVIEWS = 30;
const CACHE_TTL = 60 * 60 * 24;

export interface SummaryResponse extends ReviewSummary {
  llmMode: LlmMode;
  reviewCount: number;
  version: string;
}

export interface ReviewInput {
  id: string;
  rating: number;
  comment: string | null;
}

/**
 * Saf çekirdek (P1-5 eval'leri de çağırır): verilen yorumlardan atıflı özet. DB/önbellek yok;
 * LLM istemcisi üzerinden (demo modunda deterministik `demoReviewSummary`).
 */
export async function generateReviewSummary(
  reviews: readonly ReviewInput[],
  knownNames: readonly string[] = []
): Promise<{ data: ReviewSummary; llmMode: LlmMode }> {
  const ids = reviews.map((r) => r.id);
  const avg = reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 0;
  const facts = buildFactSet([
    reviews.length,
    avg,
    5,
    ...reviews.map((r) => r.rating),
    ...reviews.map((r) => r.comment ?? ""),
  ]);
  const result = await getLlmClient().completeJson(
    "review_summary",
    schema,
    [
      {
        role: "system",
        content:
          "Doğrulanmış misafir yorumlarını Türkçe özetle. Yalnızca JSON: {summary, pros[], cons[], citations[]}. " +
          "Her iddiayı dayandığı yorumun kimliğiyle [r:<id>] biçiminde atıfla. Yorumlarda olmayan bilgi veya sayı YAZMA.",
      },
      {
        role: "user",
        content: reviews.map((r) => `[r:${r.id}] (${r.rating}/5) ${r.comment ?? ""}`).join("\n"),
      },
    ],
    {
      demo: () => demoReviewSummary([...reviews]),
      knownNames,
      validate: (data) => {
        const text = [data.summary, ...data.pros, ...data.cons].join("\n");
        assertCitationsGrounded([...data.citations, ...extractCitations(text)], ids);
        assertNumbersGrounded(text.replace(/\[r:[^\]]+\]/g, ""), facts);
      },
    }
  );
  return { data: result.data, llmMode: result.llmMode };
}

export async function summarizeReviews(propertyId: string): Promise<SummaryResponse> {
  const version = await reviewsVersion(propertyId);
  const cacheKey = `review-summary:${propertyId}:${version}`;
  const cached = await redis.get(cacheKey).catch(() => null);
  if (cached) return JSON.parse(cached) as SummaryResponse;

  const rows = await prisma.review.findMany({
    where: { propertyId, moderationStatus: "PUBLISHED" },
    orderBy: { createdAt: "desc" },
    take: MAX_REVIEWS,
    select: {
      id: true,
      rating: true,
      comment: true,
      user: { select: { firstName: true, lastName: true } },
    },
  });
  const reviews = rows.map((r) => ({ id: r.id, rating: r.rating, comment: r.comment }));
  const result = await generateReviewSummary(
    reviews,
    rows.map((r) => `${r.user.firstName} ${r.user.lastName}`)
  );

  const response: SummaryResponse = {
    ...result.data,
    llmMode: result.llmMode,
    reviewCount: reviews.length,
    version,
  };
  if (result.llmMode !== "fallback") {
    await redis.set(cacheKey, JSON.stringify(response), { ex: CACHE_TTL }).catch(() => null);
  }
  return response;
}
