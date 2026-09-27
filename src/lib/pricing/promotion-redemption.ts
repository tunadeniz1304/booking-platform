import { Prisma } from "@prisma/client";
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
    await countRedemption(tx, bookingId, line, currency, true);
  }
}

/** Tek kullanımı koşullu sayar ve kaydeder; limit doluysa 409 COUPON_EXHAUSTED (işlem geri alınır). */
async function countRedemption(
  tx: Prisma.TransactionClient,
  bookingId: string,
  line: PromotionLine,
  currency: string,
  requireActive: boolean
): Promise<void> {
  const activeOnly = requireActive ? Prisma.sql`AND active` : Prisma.empty;
  const updated = await tx.$executeRaw`
    UPDATE "Promotion" SET "usageCount" = "usageCount" + 1
    WHERE id = ${line.promotionId} ${activeOnly}
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

/**
 * v2-P0-1: süresi dolmuş tutma geç ödeme başarısıyla yeniden alınırken, süre dolumunda iade
 * edilen limitli kullanımları AYNI işlemde yeniden sayar. Promosyon/tutar, tutma anındaki
 * kırılım anlık görüntüsünden (`Booking.priceBreakdown.discounts`) gelir; tahsil edilen toplam
 * o indirimi içerir. Limit bu arada dolduysa 409 COUPON_EXHAUSTED → işlem geri alınır, çağıran
 * iade yoluna düşer. `active` aranmaz: indirim tutmada verildi, pasifleştirme yalnız yeni
 * kullanımı keser. Hâlâ sayılan (satırı olan) promosyon atlanır → idempotent.
 */
export async function reclaimPromotionRedemptions(
  tx: Prisma.TransactionClient,
  bookingId: string
): Promise<void> {
  const booking = await tx.booking.findUniqueOrThrow({
    where: { id: bookingId },
    select: {
      currency: true,
      priceBreakdown: true,
      promotionRedemptions: { select: { promotionId: true } },
    },
  });
  const breakdown = booking.priceBreakdown as {
    currency?: unknown;
    discounts?: PromotionLine[];
  } | null;
  if (!breakdown || !Array.isArray(breakdown.discounts)) return;
  const currency = typeof breakdown.currency === "string" ? breakdown.currency : booking.currency;
  const counted = new Set(booking.promotionRedemptions.map((r) => r.promotionId));
  for (const line of breakdown.discounts) {
    if (!line.limited || counted.has(line.promotionId)) continue;
    await countRedemption(tx, bookingId, line, currency, false);
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
