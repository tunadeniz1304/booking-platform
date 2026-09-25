import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/http/errors";
import { withSerializableRetry } from "@/lib/db/transactions";

/**
 * Doğrulanmış yorumlar (P1-4; Omnibus "yorum doğrulama" beyanı):
 * yalnızca CONFIRMED/COMPLETED ve çıkış tarihi geçmiş rezervasyonun SAHİBİ
 * yorum yazabilir, rezervasyon başına bir kez. Her yeni yorum/yanıt mülkün yorum
 * sürümünü artırır (AI özeti önbelleği sürüm anahtarlıdır).
 */

export function reviewsVersionKey(propertyId: string): string {
  return `reviews:version:${propertyId}`;
}

export async function reviewsVersion(propertyId: string): Promise<string> {
  try {
    return (await redis.get(reviewsVersionKey(propertyId))) ?? "0";
  } catch {
    return "0";
  }
}

async function bumpVersion(propertyId: string): Promise<void> {
  await redis.incr(reviewsVersionKey(propertyId)).catch(() => 0);
}

export async function createReview(input: {
  userId: string;
  bookingId: string;
  rating: number;
  comment?: string;
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
    if (!["CONFIRMED", "COMPLETED"].includes(booking.status) || booking.checkOut > now) {
      throw new ForbiddenError("Yorum, konaklama tamamlandıktan sonra yazılabilir");
    }
    let created;
    try {
      created = await tx.review.create({
        data: {
          bookingId: booking.id,
          userId: input.userId,
          propertyId: booking.propertyId,
          rating: input.rating,
          comment: input.comment?.trim() || null,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictError("Bu rezervasyon için zaten yorum yazdınız", "REVIEW_EXISTS");
      }
      throw error;
    }
    const agg = await tx.review.aggregate({
      where: { propertyId: booking.propertyId },
      _avg: { rating: true },
      _count: { _all: true },
    });
    await tx.property.update({
      where: { id: booking.propertyId },
      data: { ratingAvg: agg._avg.rating ?? 0, ratingCount: agg._count._all },
    });
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

export async function listReviews(propertyId: string, take = 50) {
  const rows = await prisma.review.findMany({
    where: { propertyId },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      rating: true,
      comment: true,
      hostReply: true,
      hostRepliedAt: true,
      createdAt: true,
      user: { select: { firstName: true, lastName: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    rating: r.rating,
    comment: r.comment,
    hostReply: r.hostReply,
    createdAt: r.createdAt.toISOString(),
    author: `${r.user.firstName} ${r.user.lastName.charAt(0)}.`,
    verifiedStay: true,
  }));
}
