import { Prisma, CartStatus, PaymentStatus, SplitPlanStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getConfig } from "@/lib/config/app-config";
import { ConflictError } from "@/lib/http/errors";
import { isSerializationFailure, withConfirmRetry } from "@/lib/db/transactions";
import { InventoryUnavailableError } from "@/lib/booking/inventory";
import { invalidateBookingCache } from "@/lib/booking/booking-cache";
import { invalidatePropertySearchCache } from "@/lib/search";
import { audit } from "@/lib/admin/audit";
import { errorFields, logger } from "@/lib/observability/logger";
import { scheduleCompensationRetry } from "@/lib/saga/compensation-retry";
import {
  CONFIRM_PENDING,
  confirmRetryTotal,
  extendCartHolds,
  pendingHoldUntil,
  type ConfirmRetryData,
} from "./confirm-pending";
import {
  compensateCartPayment,
  confirmCartInTransaction,
  withCartPaymentLock,
} from "./cart-payment";
import { reholdCartInTx } from "./cart-webhook";
import {
  abortPlan,
  afterCartConfirmed,
  confirmSplitInTransaction,
  loadPlan,
  splitPlanTotal,
  splitSettlementSeconds,
} from "./split-payment";

/**
 * fix-sweep-3: `confirm-retry` işinin gövdesi (idempotent).
 *
 * Capture alınmış ama SERIALIZABLE onayı çakışmada kalmış sepet / bölünmüş ödeme planını
 * onaylamayı yeniden dener:
 *  - Onay işlemi, gerekiyorsa düşmüş tutmaları AYNI işlemde yeniden alır (`reholdCartInTx`).
 *  - Başarı → CONFIRMED (`confirm_retry_total{outcome="confirmed"}`); defter/jurnal onayla aynı
 *    işlemde yazılır (capture jurnali yalnız onayla vardır → mutabakat farkı 0).
 *  - Tutma düştü ve envanter yok (ya da sepet kapandı) → iade + iptal (`refunded`).
 *  - Hâlâ serileştirme çakışması → tutmalar uzatılır, hata fırlatılır (BullMQ üstel geri
 *    çekilmeyle yeniden dener); SON denemede iade + iptal (`exhausted_refunded`).
 * İade PSP'de düşerse telafi `saga-compensation-retry` işine devredilir.
 */

export type ConfirmRetryOutcome = "confirmed" | "noop" | "refunded";

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** Onayı kalıcı olarak imkânsız kılan hata mı (tutma düştü + envanter yok, sepet kapandı…)? */
function isTerminal(error: unknown): boolean {
  return (
    error instanceof ConflictError ||
    error instanceof InventoryUnavailableError ||
    isUniqueViolation(error)
  );
}

function reasonOf(error: unknown): string {
  if (error instanceof ConflictError) return error.code;
  if (error instanceof InventoryUnavailableError) return "INVENTORY_UNAVAILABLE";
  if (isUniqueViolation(error)) return "CART_ACTIVE_CONFLICT";
  return "CONFIRM_RETRY_EXHAUSTED";
}

async function invalidateCart(cartId: string): Promise<void> {
  const bookings = await prisma.booking.findMany({
    where: { cartId },
    select: { id: true, propertyId: true },
  });
  for (const propertyId of new Set(bookings.map((b) => b.propertyId))) {
    await invalidatePropertySearchCache(propertyId).catch(() => undefined);
  }
  for (const b of bookings) await invalidateBookingCache(b.id).catch(() => 0);
}

export async function processConfirmRetry(
  data: ConfirmRetryData,
  opts: { final: boolean }
): Promise<ConfirmRetryOutcome> {
  return data.kind === "cart" ? retryCart(data, opts.final) : retrySplit(data, opts.final);
}

// ─────────────────────────── sepet tek ödemesi ───────────────────────────

async function retryCart(
  data: Extract<ConfirmRetryData, { kind: "cart" }>,
  final: boolean
): Promise<ConfirmRetryOutcome> {
  return withCartPaymentLock(data.cartId, async () => {
    const cp = await prisma.cartPayment.findUnique({
      where: { cartId: data.cartId },
      select: { status: true, providerRef: true, failureCode: true },
    });
    if (
      !cp ||
      cp.providerRef !== data.providerRef ||
      cp.status !== PaymentStatus.AUTHORIZED ||
      cp.failureCode !== CONFIRM_PENDING
    ) {
      return "noop"; // zaten onaylandı / iade edildi
    }
    try {
      await withConfirmRetry(
        async (tx) => {
          await reholdCartInTx(tx, data.cartId, { holdUntil: pendingHoldUntil() });
          await confirmCartInTransaction(tx, data.cartId, data.providerRef);
        },
        { timeout: 30_000, maxWait: 10_000, label: "confirm-retry.cart" }
      );
    } catch (error) {
      if (isSerializationFailure(error) && !final) {
        await extendCartHolds(data.cartId);
        confirmRetryTotal.inc({ outcome: "retry" });
        throw error;
      }
      if (!isSerializationFailure(error) && !isTerminal(error)) throw error;
      return refundCart(data, reasonOf(error), final && isSerializationFailure(error));
    }
    confirmRetryTotal.inc({ outcome: "confirmed" });
    await audit("system:confirm-retry", "cart.confirm_retried", "Cart", data.cartId, {
      outcome: "confirmed",
      providerRef: data.providerRef,
    }).catch((error) => logger.warn(errorFields(error), "audit failed"));
    await invalidateCart(data.cartId);
    return "confirmed";
  });
}

async function refundCart(
  data: Extract<ConfirmRetryData, { kind: "cart" }>,
  reason: string,
  exhausted: boolean
): Promise<ConfirmRetryOutcome> {
  try {
    await compensateCartPayment({
      cartId: data.cartId,
      providerRef: data.providerRef,
      captured: true,
    });
  } catch (error) {
    logger.error({ ...data, ...errorFields(error) }, "confirm retry refund failed");
    await prisma.cartPayment.updateMany({
      where: { cartId: data.cartId, providerRef: data.providerRef, failureCode: CONFIRM_PENDING },
      data: { failureCode: "COMPENSATION_PENDING" },
    });
    await scheduleCompensationRetry(
      { saga: "cart_payment", cartId: data.cartId, providerRef: data.providerRef, captured: true },
      ["capture"]
    );
  }
  confirmRetryTotal.inc({ outcome: exhausted ? "exhausted_refunded" : "refunded" });
  await audit("system:confirm-retry", "cart.confirm_retry_refunded", "Cart", data.cartId, {
    reason,
    exhausted,
    providerRef: data.providerRef,
  }).catch((error) => logger.warn(errorFields(error), "audit failed"));
  await invalidateCart(data.cartId);
  return "refunded";
}

// ─────────────────────────── bölünmüş ödeme ───────────────────────────

async function retrySplit(
  data: Extract<ConfirmRetryData, { kind: "split" }>,
  final: boolean
): Promise<ConfirmRetryOutcome> {
  return withCartPaymentLock(data.cartId, async () => {
    const plan = await loadPlan(data.planId).catch(() => null);
    if (
      !plan ||
      (plan.status !== SplitPlanStatus.COLLECTING && plan.status !== SplitPlanStatus.FALLBACK)
    ) {
      return "noop"; // SETTLED (başka yol onayladı) ya da ABORTED (telafi edildi)
    }
    try {
      await withConfirmRetry(
        async (tx) => {
          await reholdCartInTx(tx, plan.cartId, {
            allowSplit: true,
            holdUntil: pendingHoldUntil(),
          });
          await confirmSplitInTransaction(tx, plan.id);
        },
        { timeout: 30_000, maxWait: 10_000, label: "confirm-retry.split" }
      );
    } catch (error) {
      if (isSerializationFailure(error) && !final) {
        await extendCartHolds(plan.cartId);
        confirmRetryTotal.inc({ outcome: "retry" });
        throw error;
      }
      if (!isSerializationFailure(error) && !isTerminal(error)) throw error;
      const exhausted = final && isSerializationFailure(error);
      const reason = reasonOf(error);
      // Plan kapanır → tahsilatlar iade, tutmalar serbest (PSP hatası → telafi işi).
      await abortPlan(plan, reason, CartStatus.OPEN);
      confirmRetryTotal.inc({ outcome: exhausted ? "exhausted_refunded" : "refunded" });
      await audit("system:confirm-retry", "cart.confirm_retry_refunded", "Cart", plan.cartId, {
        planId: plan.id,
        reason,
        exhausted,
      }).catch((e) => logger.warn(errorFields(e), "audit failed"));
      return "refunded";
    }
    confirmRetryTotal.inc({ outcome: "confirmed" });
    splitPlanTotal.inc({ outcome: "settled" });
    splitSettlementSeconds.observe((Date.now() - plan.createdAt.getTime()) / 1000);
    await audit("system:confirm-retry", "cart.confirm_retried", "Cart", plan.cartId, {
      outcome: "confirmed",
      planId: plan.id,
    }).catch((error) => logger.warn(errorFields(error), "audit failed"));
    await afterCartConfirmed(plan.cartId);
    return "confirmed";
  });
}

// ─────────────────────────── süpürücü ───────────────────────────

/**
 * Yedek: iş kuyruğa alınamadıysa ya da kaybolduysa, tutma süresinden uzun süredir
 * CONFIRM_PENDING kalan sepet ödemelerini SON deneme olarak işler (onay ya da iade).
 * expire-holds işinde sepet süre dolumundan ÖNCE koşar.
 */
export async function sweepConfirmPending(now: Date = new Date(), limit = 50): Promise<number> {
  const staleBefore = new Date(now.getTime() - getConfig().CART_HOLD_TTL_MINUTES * 60_000);
  const rows = await prisma.cartPayment.findMany({
    where: { failureCode: CONFIRM_PENDING, updatedAt: { lte: staleBefore } },
    select: {
      cartId: true,
      providerRef: true,
      status: true,
      splitPlans: {
        where: { status: { in: [SplitPlanStatus.COLLECTING, SplitPlanStatus.FALLBACK] } },
        select: { id: true },
      },
    },
    take: limit,
  });
  let handled = 0;
  for (const row of rows) {
    const data: ConfirmRetryData | null = row.splitPlans[0]
      ? { kind: "split", planId: row.splitPlans[0].id, cartId: row.cartId }
      : row.providerRef && row.status === PaymentStatus.AUTHORIZED
        ? { kind: "cart", cartId: row.cartId, providerRef: row.providerRef }
        : null;
    if (!data) continue;
    try {
      if ((await processConfirmRetry(data, { final: true })) !== "noop") handled++;
    } catch (error) {
      logger.error({ ...data, ...errorFields(error) }, "confirm pending sweep failed");
    }
  }
  return handled;
}
