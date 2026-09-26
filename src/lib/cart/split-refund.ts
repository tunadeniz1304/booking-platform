import { Prisma, PaymentShareStatus, SplitPlanStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getPaymentProvider } from "@/lib/payment";
import { assertCurrency, minorFromDb, minorToDb, money } from "@/lib/money/money";
import { allocateCapped } from "@/lib/money/split";

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
