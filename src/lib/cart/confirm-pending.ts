import { Prisma, BookingStatus, CartStatus, PaymentStatus } from "@prisma/client";
import { getConfig } from "@/lib/config/app-config";
import { withConfirmRetry } from "@/lib/db/transactions";
import { getQueue, QUEUE_NAMES } from "@/lib/queue";
import { counter } from "@/lib/observability/metrics";
import { errorFields, logger } from "@/lib/observability/logger";

/**
 * fix-sweep-3: "capture alındı, onay bekliyor" durumu.
 *
 * Sepet / bölünmüş ödeme pivot'u (tek SERIALIZABLE onay işlemi) ayrı bütçesiyle
 * (`withConfirmRetry`) de çakışmaya devam ederse para İADE EDİLMEZ: sepet ödemesine
 * `failureCode = CONFIRM_PENDING` yazılır, tutmalar (sepet + kalem rezervasyonları) tutma
 * süresi kadar uzatılır ve BullMQ `confirm-retry` işi onayı üstel geri çekilmeyle yeniden
 * dener (`confirm-retry-job.ts`). İade + iptal yalnız tutma gerçekten düşüp envanter artık
 * yoksa ya da iş son denemesine ulaştığında yapılır.
 *
 * Bu modül yalnız işaretleme + kuyruklama içerir (cart-payment / split-payment buradan içe
 * aktarır; iş gövdesi onları içe aktardığından döngü olmasın diye ayrı dosyada).
 */

export const CONFIRM_PENDING = "CONFIRM_PENDING";
export const CONFIRM_RETRY_JOB = "confirm-retry";

export type ConfirmRetryData =
  | { kind: "cart"; cartId: string; providerRef: string }
  | { kind: "split"; planId: string; cartId: string };

export const confirmRetryTotal = counter(
  "confirm_retry_total",
  "Capture sonrası ertelenen ödeme onayları (sonuç)",
  ["outcome"] as const
);

/** Tutmaları (sepet + HELD kalem rezervasyonları) en az `until`'e uzatır; kısaltmaz. */
export async function extendCartHoldsInTx(
  tx: Prisma.TransactionClient,
  cartId: string,
  until: Date
): Promise<void> {
  await tx.cart.updateMany({
    where: {
      id: cartId,
      status: CartStatus.HELD,
      OR: [{ holdExpiresAt: null }, { holdExpiresAt: { lt: until } }],
    },
    data: { holdExpiresAt: until },
  });
  await tx.booking.updateMany({
    where: {
      cartId,
      status: BookingStatus.HELD,
      OR: [{ holdExpiresAt: null }, { holdExpiresAt: { lt: until } }],
    },
    data: { holdExpiresAt: until },
  });
}

export function pendingHoldUntil(now = Date.now()): Date {
  return new Date(now + getConfig().CART_HOLD_TTL_MINUTES * 60_000);
}

/** Tutmaları uzatır (en iyi çaba; hata loglanır — iş tutma düşse de yeniden tutmayı dener). */
export async function extendCartHolds(cartId: string): Promise<void> {
  try {
    await withConfirmRetry((tx) => extendCartHoldsInTx(tx, cartId, pendingHoldUntil()));
  } catch (error) {
    logger.warn({ cartId, ...errorFields(error) }, "confirm pending hold extension failed");
  }
}

function jobId(data: ConfirmRetryData): string {
  return data.kind === "cart"
    ? `confirm-cart-${data.cartId}-${data.providerRef}`
    : `confirm-split-${data.planId}`;
}

export async function scheduleConfirmRetry(data: ConfirmRetryData): Promise<void> {
  const { CONFIRM_RETRY_JOB_ATTEMPTS, CONFIRM_RETRY_JOB_BASE_DELAY_MS } = getConfig();
  try {
    await getQueue(QUEUE_NAMES.confirmRetry).add(CONFIRM_RETRY_JOB, data, {
      jobId: jobId(data),
      delay: CONFIRM_RETRY_JOB_BASE_DELAY_MS,
      attempts: CONFIRM_RETRY_JOB_ATTEMPTS,
      backoff: { type: "exponential", delay: CONFIRM_RETRY_JOB_BASE_DELAY_MS },
      removeOnComplete: true,
      removeOnFail: 1000,
    });
  } catch (error) {
    // İş kaybolmaz: expire-holds süpürücüsü (`sweepConfirmPending`) bekleyen onayı işler.
    logger.error({ ...data, ...errorFields(error) }, "confirm retry could not be scheduled");
  }
}

/**
 * Onayı erteler: sepet ödemesi CONFIRM_PENDING + tutmalar uzatılır (tek işlem), sonra iş
 * kuyruğa alınır. Tek sepet ödemesinde satır AUTHORIZED(providerRef) kalır (capture alınmış);
 * bölünmüş ödemede CartPayment PENDING kalır (paylar CAPTURED). İşaretleme de başarısız olursa
 * hata fırlatılır → çağıran saga güvenli varsayılana (telafi = iade) düşer.
 */
export async function deferConfirmation(data: ConfirmRetryData): Promise<void> {
  await withConfirmRetry(async (tx) => {
    const marked = await tx.cartPayment.updateMany({
      where:
        data.kind === "cart"
          ? { cartId: data.cartId, providerRef: data.providerRef, status: PaymentStatus.AUTHORIZED }
          : { cartId: data.cartId, status: { not: PaymentStatus.PAID } },
      data: { failureCode: CONFIRM_PENDING },
    });
    if (marked.count !== 1)
      throw new Error("Onay ertelenemedi: sepet ödemesi beklenen durumda değil");
    await extendCartHoldsInTx(tx, data.cartId, pendingHoldUntil());
  });
  confirmRetryTotal.inc({ outcome: "deferred" });
  logger.warn(data, "payment confirmation deferred to confirm-retry");
  await scheduleConfirmRetry(data);
}
