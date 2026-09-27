import type { Prisma } from "@prisma/client";
import { ConflictError } from "@/lib/http/errors";
import { minorToDb } from "@/lib/money/money";
import type { PromotionLine } from "@/lib/pricing/promotions";

/**
 * P1-8: limitli promosyon (kupon) kullanımını rezervasyonla AYNI işlemde sayar.
 * Koşullu `UPDATE … WHERE usageCount < usageLimit` → eşzamanlı son kullanımlarda yalnız biri
 * geçer; diğerinin işlemi 409 COUPON_EXHAUSTED ile geri alınır (tutma da oluşmaz).
 */
export async function redeemPromotions(
  tx: Prisma.TransactionClient,
  bookingId: string,
  lines: readonly PromotionLine[],
  currency: string
): Promise<void> {
  for (const line of lines) {
    if (!line.limited) continue;
    const updated = await tx.$executeRaw`
      UPDATE "Promotion" SET "usageCount" = "usageCount" + 1
      WHERE id = ${line.promotionId} AND active
        AND ("usageLimit" IS NULL OR "usageCount" < "usageLimit")`;
    if (updated !== 1) {
      throw new ConflictError("Kupon kullanım limiti doldu", "COUPON_EXHAUSTED", {
        promotionId: line.promotionId,
      });
    }
    await tx.promotionRedemption.create({
      data: {
        promotionId: line.promotionId,
        bookingId,
        amountMinor: minorToDb(line.amount),
        currency,
      },
    });
  }
}

/** Onaylanmamış tutma düşünce kullanımı iade eder (idempotent: satır yoksa no-op). */
export async function releasePromotionRedemptions(
  tx: Prisma.TransactionClient,
  bookingId: string
): Promise<void> {
  const rows = await tx.promotionRedemption.findMany({
    where: { bookingId },
    select: { id: true, promotionId: true },
  });
  for (const row of rows) {
    const deleted = await tx.promotionRedemption.deleteMany({ where: { id: row.id } });
    if (deleted.count !== 1) continue;
    await tx.$executeRaw`
      UPDATE "Promotion" SET "usageCount" = GREATEST("usageCount" - 1, 0)
      WHERE id = ${row.promotionId}`;
  }
}
