import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { NotFoundError } from "@/lib/http/errors";
import { withSerializableRetry } from "@/lib/db/transactions";
import { getLlmClient, type LlmMode } from "@/lib/llm/client";
import { demoModerationExplain } from "@/lib/llm/demo";
import { assertNumbersGrounded, buildFactSet } from "@/lib/llm/guards";
import { bumpVersion, recomputeRating } from "@/lib/reviews/review-service";
import type { ModerationReason } from "@/lib/reviews/moderation";

const QUEUE_LIMIT = 50;
/** LLM açıklaması istenen en fazla kayıt; kalanlar deterministik açıklamayla döner. */
const EXPLAIN_LIMIT = 10;
const QUEUE_WHERE: Prisma.ReviewWhereInput = {
  moderationStatus: { in: ["PENDING_REVIEW", "HIDDEN"] },
};

function parseReasons(raw: unknown): ModerationReason[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
    .map((r) => ({
      code: String(r.code ?? "?") as ModerationReason["code"],
      detail: typeof r.detail === "string" ? r.detail : "",
    }));
}

/**
 * "Neden işaretlendi" açıklaması: LLM yalnızca gerekçe kodlarını ifade eder, karar vermez;
 * yorum metni modele gönderilmez (PII içerebilir). Demo/hata → deterministik metin.
 */
async function explain(
  reasons: ModerationReason[]
): Promise<{ explanation: string; llmMode: LlmMode }> {
  // v2-P0-7: açıklamadaki her sayı gerekçe kodu/detayından gelmeli; uydurma sayı → demo.
  const facts = buildFactSet(reasons.flatMap((r) => [r.code, r.detail]));
  const res = await getLlmClient().completeJson(
    "moderation_explain",
    z.object({ explanation: z.string().min(5).max(600) }),
    [
      {
        role: "system",
        content:
          "Bir yorumun moderasyon kuyruğuna neden düştüğünü yöneticiye tek-iki cümle Türkçe açıkla. Yalnızca verilen gerekçe kodlarını kullan, karar önerme. JSON: {explanation}",
      },
      { role: "user", content: JSON.stringify(reasons) },
    ],
    {
      demo: () => demoModerationExplain(reasons),
      validate: (data) => assertNumbersGrounded(data.explanation, facts),
    }
  );
  return { explanation: res.data.explanation, llmMode: res.llmMode };
}

/** Kuyruktaki toplam kayıt (liste QUEUE_LIMIT ile kesilir; panel "gösterilen/toplam" yazar). */
export async function countModerationQueue(): Promise<number> {
  return prisma.review.count({ where: QUEUE_WHERE });
}

export async function listModerationQueue() {
  const rows = await prisma.review.findMany({
    where: QUEUE_WHERE,
    orderBy: { createdAt: "asc" },
    take: QUEUE_LIMIT,
    select: {
      id: true,
      propertyId: true,
      rating: true,
      comment: true,
      moderationStatus: true,
      moderationReasons: true,
      reportCount: true,
      createdAt: true,
      property: { select: { title: true } },
    },
  });
  return Promise.all(
    rows.map(async (r, i) => {
      const reasons = parseReasons(r.moderationReasons);
      // EXPLAIN_LIMIT sonrası LLM'e gidilmez: deterministik (demo) açıklama.
      const { explanation, llmMode } =
        i < EXPLAIN_LIMIT
          ? await explain(reasons)
          : { explanation: demoModerationExplain(reasons).explanation, llmMode: "demo" as const };
      return {
        id: r.id,
        propertyId: r.propertyId,
        propertyTitle: r.property.title,
        rating: r.rating,
        comment: r.comment,
        status: r.moderationStatus,
        reportCount: r.reportCount,
        reasons,
        explanation,
        llmMode,
        createdAt: r.createdAt.toISOString(),
      };
    })
  );
}

/** Admin kararı: publish → PUBLISHED (puana katılır), remove → REMOVED. */
export async function decideModeration(id: string, action: "publish" | "remove") {
  const propertyId = await withSerializableRetry(async (tx) => {
    const review = await tx.review.findUnique({
      where: { id },
      select: { propertyId: true, moderationStatus: true },
    });
    if (!review || !["PENDING_REVIEW", "HIDDEN"].includes(review.moderationStatus)) {
      throw new NotFoundError("Kuyrukta böyle bir yorum yok");
    }
    await tx.review.update({
      where: { id },
      data: { moderationStatus: action === "publish" ? "PUBLISHED" : "REMOVED" },
    });
    await recomputeRating(tx, review.propertyId);
    return review.propertyId;
  });
  await bumpVersion(propertyId);
  return { ok: true };
}
