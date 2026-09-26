import type { Prisma, PrismaClient } from "@prisma/client";
import { minorFromDb } from "@/lib/money/money";
import { normalizeCouponCode, type PromotionRule } from "@/lib/pricing/promotions";

type Db = PrismaClient | Prisma.TransactionClient;

export const promotionRuleSelect = {
  id: true,
  name: true,
  type: true,
  discountBps: true,
  discountMinor: true,
  currency: true,
  minDaysBefore: true,
  maxDaysBefore: true,
  minNights: true,
  couponCode: true,
  usageLimit: true,
  usageCount: true,
  startsAt: true,
  endsAt: true,
  priority: true,
  stackable: true,
  stackGroup: true,
  active: true,
} satisfies Prisma.PromotionSelect;

type PromotionRow = Prisma.PromotionGetPayload<{ select: typeof promotionRuleSelect }>;

export function toPromotionRule(row: PromotionRow): PromotionRule {
  return {
    ...row,
    discountMinor: row.discountMinor === null ? null : minorFromDb(row.discountMinor),
  };
}

/**
 * Tesise uygulanabilir aktif promosyonlar: ev sahibinin tüm ilanlarına ya da bu ilana özel.
 * Kupon promosyonları yalnız girilen kodla eşleşiyorsa yüklenir (kodlar sızmaz).
 */
export async function loadPromotionRules(
  db: Db,
  input: { hostId: string; propertyId: string; couponCode?: string | null }
): Promise<PromotionRule[]> {
  const code = normalizeCouponCode(input.couponCode);
  const rows = await db.promotion.findMany({
    where: {
      hostId: input.hostId,
      active: true,
      OR: [{ propertyId: null }, { propertyId: input.propertyId }],
      AND: [
        code
          ? { OR: [{ type: { not: "COUPON" } }, { couponCode: code }] }
          : { type: { not: "COUPON" } },
      ],
    },
    select: promotionRuleSelect,
    orderBy: { id: "asc" },
  });
  return rows.map(toPromotionRule);
}
