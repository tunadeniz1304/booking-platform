import { Prisma, PaymentShareStatus, SplitPlanStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getPaymentProvider } from "@/lib/payment";
import { assertCurrency, minorFromDb, minorToDb, money } from "@/lib/money/money";
import { allocateCapped } from "@/lib/money/split";
import { withSerializableRetry } from "@/lib/db/transactions";
import { ConflictError } from "@/lib/http/errors";

/**
 * Bölünmüş ödemeli sepette kalem iptali iadesi (P1-2). Rezervasyonun tek bir PSP işlemi yoktur
 * (her pay ayrı işlem) → iade tutarı tahsil edilmiş paylara, kalan iade kapasitelerine oranla
 * dağıtılır (`allocateCapped`: tek yuvarlama kuralı, kalan kuruş organizatör payına). Dağılım
 * iptal işlemiyle AYNI işlemde yazılır (`PaymentShareRefund`); PSP iadeleri işlemden sonra pay
 * başına `refund:<bookingId>:<shareId>` anahtarıyla yapılır → yeniden deneme güvenli.
 *
 * Bu modül payment-service'i import ETMEZ (döngü yok); iptal/yeniden deneme akışı çağırır.
 */

/** Settled bölünmüş plan varsa iadeyi paylara dağıtır; yoksa `false` (tek PSP işlemi yolu). */
export async function allocateSplitRefundInTx(
  tx: Prisma.TransactionClient,
  input: { cartPaymentId: string; bookingId: string; refundMinor: number; currency: string }
): Promise<boolean> {
  const plan = await tx.splitPlan.findFirst({
    where: { cartPaymentId: input.cartPaymentId, status: SplitPlanStatus.SETTLED },
    select: { id: true },
  });
  if (!plan) return false;
  if (input.refundMinor <= 0) return true;
  if ((await tx.paymentShareRefund.count({ where: { bookingId: input.bookingId } })) > 0) {
    return true; // idempotent: dağılım zaten yazıldı
  }
  await tx.$queryRaw`SELECT id FROM "PaymentShare" WHERE "planId" = ${plan.id} FOR UPDATE`;
  const shares = await tx.paymentShare.findMany({
    where: { planId: plan.id, status: PaymentShareStatus.CAPTURED },
    select: { id: true, amountMinor: true, refundedAmountMinor: true },
    orderBy: { position: "asc" },
  });
  const caps = shares.map((s) => minorFromDb(s.amountMinor) - minorFromDb(s.refundedAmountMinor));
  const parts = allocateCapped(input.refundMinor, caps);
  const now = new Date();
  for (const [i, share] of shares.entries()) {
    const part = parts[i];
    if (part <= 0) continue;
    const refunded = share.refundedAmountMinor + minorToDb(part);
    await tx.paymentShareRefund.create({
      data: {
        shareId: share.id,
        bookingId: input.bookingId,
        amountMinor: minorToDb(part),
        currency: input.currency,
      },
    });
    await tx.paymentShare.update({
      where: { id: share.id },
      data: {
        refundedAmountMinor: refunded,
        refundedAt: now,
        ...(refunded === share.amountMinor ? { status: PaymentShareStatus.REFUNDED } : {}),
      },
    });
  }
  return true;
}

/** Rezervasyonun bekleyen pay iadelerini PSP'ye iletir; ilk hatada fırlatır (retry kuyruğu). */
export async function executeSplitRefunds(bookingId: string): Promise<number> {
  const rows = await prisma.paymentShareRefund.findMany({
    where: { bookingId, status: "PENDING" },
    select: {
      id: true,
      shareId: true,
      amountMinor: true,
      currency: true,
      share: { select: { providerRef: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  const provider = getPaymentProvider();
  let done = 0;
  for (const row of rows) {
    if (!row.share.providerRef) continue;
    const res = await provider.refund(
      row.share.providerRef,
      money(minorFromDb(row.amountMinor), assertCurrency(row.currency)),
      `refund:${bookingId}:${row.shareId}`
    );
    await prisma.paymentShareRefund.updateMany({
      where: { id: row.id, status: "PENDING" },
      data: { status: "DONE", refundRef: res.refundRef },
    });
    done++;
  }
  return done;
}

/** Rezervasyonun iadesi paylara dağıtılmış mı (yeniden deneme yolu seçimi). */
export async function hasSplitRefunds(bookingId: string): Promise<boolean> {
  return (await prisma.paymentShareRefund.count({ where: { bookingId } })) > 0;
}

// ---------------------------------------------------------------------------
// fix-sweep-2: çözüm merkezi misafir iadesi (GUEST_REFUND) → paylara oransal dağıtım
// ---------------------------------------------------------------------------

/** Ödemenin bağlı olduğu TAMAMLANMIŞ bölünmüş plan (yoksa null → tek PSP işlemi yolu). */
export async function settledSplitPlanId(
  db: Prisma.TransactionClient | typeof prisma,
  cartPaymentId: string | null | undefined
): Promise<string | null> {
  if (!cartPaymentId) return null;
  const plan = await db.splitPlan.findFirst({
    where: { cartPaymentId, status: SplitPlanStatus.SETTLED },
    select: { id: true },
  });
  return plan?.id ?? null;
}

/** Talebin bekleyen (PSP'ye gitmemiş) pay ayrımlarını geri alır; kapasite paylara döner. */
async function releasePendingClaimShares(
  tx: Prisma.TransactionClient,
  claimId: string
): Promise<void> {
  const rows = await tx.claimShareRefund.findMany({
    where: { claimId, status: "PENDING" },
    select: { id: true, shareId: true, amountMinor: true },
  });
  for (const row of rows) {
    const share = await tx.paymentShare.findUniqueOrThrow({
      where: { id: row.shareId },
      select: { amountMinor: true, refundedAmountMinor: true, status: true },
    });
    const refunded = share.refundedAmountMinor - row.amountMinor;
    await tx.paymentShare.update({
      where: { id: row.shareId },
      data: {
        refundedAmountMinor: refunded < 0n ? 0n : refunded,
        ...(share.status === PaymentShareStatus.REFUNDED && refunded < share.amountMinor
          ? { status: PaymentShareStatus.CAPTURED }
          : {}),
      },
    });
    await tx.claimShareRefund.delete({ where: { id: row.id } });
  }
}

/**
 * Talep iadesini tahsil edilmiş paylara kalan kapasiteleriyle oransal dağıtır
 * (`allocateCapped`: tek yuvarlama kuralı, kalan kuruş organizatör payına) ve kapasiteyi
 * ayırır. Aynı talep için önceki (PSP'ye gitmemiş) dağılım tutarı aynıysa yeniden kullanılır,
 * değilse geri alınıp yeniden dağıtılır; tutar 0 → bekleyen ayrımlar serbest bırakılır.
 * Kısmen iade edilmiş (DONE) farklı tutarlı dağılım → 409 (elle inceleme).
 */
export async function reserveClaimShareRefunds(input: {
  claimId: string;
  bookingId: string;
  planId: string;
  amountMinor: bigint;
  currency: string;
}): Promise<void> {
  await withSerializableRetry(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "PaymentShare" WHERE "planId" = ${input.planId} FOR UPDATE`;
    const existing = await tx.claimShareRefund.findMany({
      where: { claimId: input.claimId },
      select: { amountMinor: true, status: true },
    });
    const total = existing.reduce((s, r) => s + r.amountMinor, 0n);
    if (existing.length > 0 && total === input.amountMinor) return;
    if (existing.some((r) => r.status === "DONE")) {
      throw new ConflictError(
        "Talebin pay iadeleri farklı tutarla kısmen yapılmış",
        "CLAIM_REFUND_IN_PROGRESS"
      );
    }
    await releasePendingClaimShares(tx, input.claimId);
    if (input.amountMinor <= 0n) return;
    const shares = await tx.paymentShare.findMany({
      where: { planId: input.planId, status: PaymentShareStatus.CAPTURED },
      select: { id: true, amountMinor: true, refundedAmountMinor: true },
      orderBy: { position: "asc" },
    });
    const caps = shares.map((s) => minorFromDb(s.amountMinor) - minorFromDb(s.refundedAmountMinor));
    if (minorFromDb(input.amountMinor) > caps.reduce((s, c) => s + Math.max(0, c), 0)) {
      throw new ConflictError("Payların iade kapasitesi yetersiz", "CLAIM_SPLIT_CAPACITY");
    }
    const parts = allocateCapped(
      minorFromDb(input.amountMinor),
      caps.map((c) => Math.max(0, c))
    );
    for (const [i, share] of shares.entries()) {
      const part = parts[i];
      if (part <= 0) continue;
      const refunded = share.refundedAmountMinor + minorToDb(part);
      await tx.claimShareRefund.create({
        data: {
          claimId: input.claimId,
          shareId: share.id,
          bookingId: input.bookingId,
          amountMinor: minorToDb(part),
          currency: input.currency,
        },
      });
      await tx.paymentShare.update({
        where: { id: share.id },
        data: {
          refundedAmountMinor: refunded,
          refundedAt: new Date(),
          ...(refunded === share.amountMinor ? { status: PaymentShareStatus.REFUNDED } : {}),
        },
      });
    }
  });
}

/** Talebin bekleyen pay iadelerini PSP'ye iletir (`claim-refund:<claimId>:<shareId>`). */
export async function executeClaimShareRefunds(claimId: string): Promise<number> {
  const rows = await prisma.claimShareRefund.findMany({
    where: { claimId, status: "PENDING" },
    select: { id: true, shareId: true, amountMinor: true, currency: true },
    orderBy: { createdAt: "asc" },
  });
  const provider = getPaymentProvider();
  let done = 0;
  for (const row of rows) {
    const share = await prisma.paymentShare.findUniqueOrThrow({
      where: { id: row.shareId },
      select: { providerRef: true },
    });
    if (!share.providerRef) continue;
    const res = await provider.refund(
      share.providerRef,
      money(minorFromDb(row.amountMinor), assertCurrency(row.currency)),
      `claim-refund:${claimId}:${row.shareId}`
    );
    await prisma.claimShareRefund.updateMany({
      where: { id: row.id, status: "PENDING" },
      data: { status: "DONE", refundRef: res.refundRef },
    });
    done++;
  }
  return done;
}

/** Talebin bekleyen ayrımlarını serbest bırakır (ret / geri çekme). */
export async function releaseClaimShareRefunds(claimId: string): Promise<void> {
  if ((await prisma.claimShareRefund.count({ where: { claimId, status: "PENDING" } })) === 0) {
    return;
  }
  await withSerializableRetry((tx) => releasePendingClaimShares(tx, claimId));
}
