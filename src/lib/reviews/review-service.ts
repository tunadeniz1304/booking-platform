import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/http/errors";
import { withSerializableRetry } from "@/lib/db/transactions";
import { getConfig } from "@/lib/config/app-config";
import { moderateText, type ModerationReason } from "@/lib/reviews/moderation";

/**
 * Doğrulanmış yorumlar (P1-4; Omnibus "yorum doğrulama" beyanı):
 * yalnızca COMPLETED ve çıkış tarihi geçmiş rezervasyonun SAHİBİ yorum yazabilir,
 * rezervasyon başına bir kez (P1-7, regresyon v3#24). Deterministik filtreye takılan
 * yorum PENDING_REVIEW olur; yalnızca PUBLISHED yorumlar listelenir ve puana katılır. Her yeni yorum/yanıt mülkün yorum
 * sürümünü artırır (AI özeti önbelleği sürüm anahtarlıdır).
 */

function reviewsVersionKey(propertyId: string): string {
  return `reviews:version:${propertyId}`;
}

export async function reviewsVersion(propertyId: string): Promise<string> {
  try {
    return (await redis.get(reviewsVersionKey(propertyId))) ?? "0";
  } catch {
    return "0";
  }
}

export async function bumpVersion(propertyId: string): Promise<void> {
  await redis.incr(reviewsVersionKey(propertyId)).catch(() => 0);
}

/** Mülk puanını yalnızca yayınlanmış yorumlardan yeniden hesaplar (tx içinde). */
export async function recomputeRating(
  tx: Prisma.TransactionClient,
  propertyId: string
): Promise<void> {
  const agg = await tx.review.aggregate({
    where: { propertyId, moderationStatus: "PUBLISHED" },
    _avg: { rating: true },
    _count: { _all: true },
  });
  await tx.property.update({
    where: { id: propertyId },
    data: { ratingAvg: agg._avg.rating ?? 0, ratingCount: agg._count._all },
  });
}

export interface SubScores {
  cleanliness?: number;
  location?: number;
  staff?: number;
  value?: number;
}

export async function createReview(input: {
  userId: string;
  bookingId: string;
  rating: number;
  comment?: string;
  subScores?: SubScores;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const review = await withSerializableRetry(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: input.bookingId },
      select: { id: true, userId: true, propertyId: true, status: true, checkOut: true },
    });
    if (!booking || booking.userId !== input.userId) {
      throw new ForbiddenError("Yalnızca konaklamasını tamamlamış misafir yorum yazabilir");
    }
    // v3#24: CONFIRMED (henüz tamamlanmamış/no-show olabilir) rezervasyon yorum hakkı vermez.
    if (booking.status !== "COMPLETED" || booking.checkOut > now) {
      throw new ForbiddenError("Yorum, konaklama tamamlandıktan sonra yazılabilir");
    }
    const comment = input.comment?.trim() || null;
    const reasons: ModerationReason[] = moderateText(comment);
    let created;
    try {
      created = await tx.review.create({
        data: {
          bookingId: booking.id,
          userId: input.userId,
          propertyId: booking.propertyId,
          rating: input.rating,
          comment,
          cleanliness: input.subScores?.cleanliness ?? null,
          location: input.subScores?.location ?? null,
          staff: input.subScores?.staff ?? null,
          value: input.subScores?.value ?? null,
          moderationStatus: reasons.length > 0 ? "PENDING_REVIEW" : "PUBLISHED",
          moderationReasons: reasons as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictError("Bu rezervasyon için zaten yorum yazdınız", "REVIEW_EXISTS");
      }
      throw error;
    }
    await recomputeRating(tx, booking.propertyId);
    return created;
  });
  await bumpVersion(review.propertyId);
  return review;
}

/** Ev sahibi yanıtı: yalnızca mülkün sahibi; ADMIN her mülkün yorumuna yanıt verebilir. */
export async function replyToReview(input: {
  hostId: string;
  reviewId: string;
  text: string;
  isAdmin?: boolean;
}) {
  const review = await prisma.review.findUnique({
    where: { id: input.reviewId },
    select: { id: true, propertyId: true, property: { select: { hostId: true } } },
  });
  // Başka host'un mülkü: kaynağın varlığı sızdırılmaz.
  if (!review || (!input.isAdmin && review.property.hostId !== input.hostId))
    throw new NotFoundError("Yorum bulunamadı");
  const updated = await prisma.review.update({
    where: { id: review.id },
    data: { hostReply: input.text.trim(), hostRepliedAt: new Date() },
  });
  await bumpVersion(review.propertyId);
  return updated;
}

const reviewListSelect = {
  id: true,
  rating: true,
  comment: true,
  hostReply: true,
  hostRepliedAt: true,
  cleanliness: true,
  location: true,
  staff: true,
  value: true,
  createdAt: true,
  user: { select: { firstName: true, lastName: true } },
} satisfies Prisma.ReviewSelect;

type ReviewListRow = Prisma.ReviewGetPayload<{ select: typeof reviewListSelect }>;

function toReviewListItem(r: ReviewListRow) {
  return {
    id: r.id,
    rating: r.rating,
    comment: r.comment,
    hostReply: r.hostReply,
    hostRepliedAt: r.hostRepliedAt ? r.hostRepliedAt.toISOString() : null,
    subScores: {
      cleanliness: r.cleanliness,
      location: r.location,
      staff: r.staff,
      value: r.value,
    },
    createdAt: r.createdAt.toISOString(),
    author: `${r.user.firstName} ${r.user.lastName.charAt(0)}.`,
    verifiedStay: true,
  };
}

export async function listReviews(propertyId: string, take = 50) {
  const rows = await prisma.review.findMany({
    where: { propertyId, moderationStatus: "PUBLISHED" },
    orderBy: { createdAt: "desc" },
    take,
    select: reviewListSelect,
  });
  return rows.map(toReviewListItem);
}

export const REVIEW_PAGE_MAX = 50;
export type ReviewSort = "newest" | "highest" | "lowest";

export interface ListReviewsPageOptions {
  /** Önceki sayfanın `nextCursor` değeri (yorum kimliği). */
  cursor?: string;
  take?: number;
  sort?: ReviewSort;
  /** Yalnızca bu genel puandaki (1-5) yorumlar. */
  rating?: number;
}

/**
 * Sunucu tarafı sayfalama (imleç): `listReviews`'in sayfalı karşılığı. Sıra yeniden eskiye
 * ya da puana göre (eşitlikte yeni önce); `total` aynı süzgeçle sayılır.
 */
export async function listReviewsPage(propertyId: string, opts: ListReviewsPageOptions = {}) {
  const take = Math.min(Math.max(Math.trunc(opts.take ?? 20) || 20, 1), REVIEW_PAGE_MAX);
  const rating =
    opts.rating && Number.isInteger(opts.rating) && opts.rating >= 1 && opts.rating <= 5
      ? opts.rating
      : undefined;
  const where: Prisma.ReviewWhereInput = {
    propertyId,
    moderationStatus: "PUBLISHED",
    ...(rating !== undefined ? { rating } : {}),
  };
  const orderBy: Prisma.ReviewOrderByWithRelationInput[] = [
    ...(opts.sort === "highest"
      ? [{ rating: "desc" as const }]
      : opts.sort === "lowest"
        ? [{ rating: "asc" as const }]
        : []),
    { createdAt: "desc" },
    { id: "desc" },
  ];
  const [rows, total] = await Promise.all([
    prisma.review.findMany({
      where,
      orderBy,
      take: take + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
      select: reviewListSelect,
    }),
    prisma.review.count({ where }),
  ]);
  const page = rows.slice(0, take);
  return {
    items: page.map(toReviewListItem),
    nextCursor: rows.length > take ? (page[page.length - 1]?.id ?? null) : null,
    total,
  };
}

/**
 * Yorum şikâyeti (P1-7): kullanıcı başına bir kez, kendi yorumuna değil. Şikâyet sayısı
 * REVIEW_REPORT_HIDE_THRESHOLD'a ulaşınca yorum HIDDEN olur (admin kuyruğuna düşer) ve
 * puan yeniden hesaplanır. Karar sayaç kuralıdır; LLM katılmaz.
 */
export async function reportReview(input: {
  reviewId: string;
  reporterId: string;
  reason: string;
  note?: string;
}) {
  const threshold = getConfig().REVIEW_REPORT_HIDE_THRESHOLD;
  const result = await withSerializableRetry(async (tx) => {
    const review = await tx.review.findUnique({
      where: { id: input.reviewId },
      select: { id: true, userId: true, propertyId: true, moderationStatus: true },
    });
    if (!review || review.moderationStatus !== "PUBLISHED") {
      throw new NotFoundError("Yorum bulunamadı");
    }
    if (review.userId === input.reporterId) {
      throw new ForbiddenError("Kendi yorumunuzu şikâyet edemezsiniz");
    }
    try {
      await tx.reviewReport.create({
        data: {
          reviewId: review.id,
          reporterId: input.reporterId,
          reason: input.reason,
          note: input.note?.trim() || null,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictError("Bu yorumu zaten şikâyet ettiniz", "REPORT_EXISTS");
      }
      throw error;
    }
    const updated = await tx.review.update({
      where: { id: review.id },
      data: { reportCount: { increment: 1 } },
      select: { reportCount: true, moderationReasons: true },
    });
    const hidden = updated.reportCount >= threshold;
    if (hidden) {
      const prev = Array.isArray(updated.moderationReasons) ? updated.moderationReasons : [];
      const reason: ModerationReason = {
        code: "REPORT_THRESHOLD",
        detail: `${updated.reportCount} kullanıcı şikâyeti (eşik ${threshold})`,
      };
      await tx.review.update({
        where: { id: review.id },
        data: {
          moderationStatus: "HIDDEN",
          moderationReasons: [...prev, reason] as unknown as Prisma.InputJsonValue,
        },
      });
      await recomputeRating(tx, review.propertyId);
    }
    return { propertyId: review.propertyId, reportCount: updated.reportCount, hidden };
  });
  if (result.hidden) await bumpVersion(result.propertyId);
  return { reportCount: result.reportCount, hidden: result.hidden };
}
