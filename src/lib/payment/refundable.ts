import type { Prisma, PrismaClient } from "@prisma/client";

type Db = Prisma.TransactionClient | PrismaClient;

/**
 * Rezervasyonun kaybedilmiş PSP itirazları (CHARGEBACK talebi RESOLVED_APPROVED) toplamı
 * (fix-sweep-2). Kart sahibine itirazla dönen para, iptal/talep iadesinde "kalan iade
 * edilebilir" tutardan düşülür → aynı para ikinci kez iade edilmez.
 */
export async function lostChargebackMinor(db: Db, bookingId: string): Promise<bigint> {
  const agg = await db.claim.aggregate({
    where: { bookingId, type: "CHARGEBACK", status: "RESOLVED_APPROVED" },
    _sum: { awardedMinor: true },
  });
  return agg._sum.awardedMinor ?? 0n;
}
