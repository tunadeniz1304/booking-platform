import {
  Prisma,
  CartStatus,
  PaymentShareStatus,
  PaymentStatus,
  SplitPlanStatus,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ConflictError } from "@/lib/http/errors";
import { withSerializableRetry } from "@/lib/db/transactions";
import { getPaymentProvider } from "@/lib/payment";
import type { WebhookEvent } from "@/lib/payment/webhook";
import { WebhookMismatchError } from "@/lib/payment/payment-service";
import { holdUnits, InventoryUnavailableError } from "@/lib/booking/inventory";
import { assertCurrency, minorFromDb, money } from "@/lib/money/money";
import { counter } from "@/lib/observability/metrics";
import { errorFields, logger } from "@/lib/observability/logger";
import { audit } from "@/lib/admin/audit";
import { invalidateBookingCache } from "@/lib/booking/booking-cache";
import { invalidatePropertySearchCache } from "@/lib/search";
import { confirmCartInTransaction, withCartPaymentLock } from "./cart-payment";
import { settleSplitIfFundedLocked } from "./split-payment";

/**
 * Sepet ödemesi / bölünmüş ödeme payı için PSP webhook'ları (P1-2, v4#8 deseni).
 *
 * - Sepet tek ödemesi (`CartPayment.providerRef`) için geç `payment.succeeded`: sepet hâlâ
 *   HELD ise onaylanır; süre dolmuş/bırakılmışsa ve TÜM kalemlerin envanteri uygunsa tutmalar
 *   yeniden alınır ve AYNI işlemde onaylanır; değilse tam iade.
 * - Pay (`PaymentShare.providerRef`) için `payment.succeeded`: plan hâlâ açıksa pay tahsil
 *   edilmiş sayılır; plan kapandıysa (süre sonu, yedek ödeme, iptal) pay iade edilir — tek pay
 *   sepeti tek başına onaylayamaz (diğer paylar void/iade edilmiştir).
 * Her iki yolda audit + `cart_late_success_total{subject,outcome}`; olay kaydı işlemle aynı tx.
 */

export const cartLateSuccessTotal = counter(
  "cart_late_success_total",
  "Sepet / pay için onay penceresi dışında gelen başarılı ödeme olayları",
  ["subject", "outcome"] as const
);

const LATE_SUCCESS_HOLD_MS = 60_000;

type Result = { duplicate: boolean; compensated?: boolean };

function sameAmount(event: WebhookEvent, row: { amountMinor: bigint; currency: string }): boolean {
  if (event.data.currency && event.data.currency.toUpperCase() !== row.currency) return false;
  if (event.data.amount !== undefined) return event.data.amount === minorFromDb(row.amountMinor);
  return true;
}

const recorder = (event: WebhookEvent) => (tx: Prisma.TransactionClient) =>
  tx.paymentEvent.create({
    data: { id: event.id, type: event.type, providerRef: event.data.providerRef },
  });

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** Sepet/pay olayı değilse `null` (çağıran tekil rezervasyon yoluna devam eder). */
export async function handleCartWebhookEvent(event: WebhookEvent): Promise<Result | null> {
  const ref = event.data.providerRef;
  const share = await prisma.paymentShare.findUnique({
    where: { providerRef: ref },
    select: { id: true, cartId: true, amountMinor: true, currency: true },
  });
  const cartPayment = share
    ? null
    : await prisma.cartPayment.findUnique({
        where: { providerRef: ref },
        select: { id: true, cartId: true, amountMinor: true, currency: true },
      });
  const target = share ?? cartPayment;
  if (!target) return null;
  if (!sameAmount(event, target)) {
    await audit("system:webhook", "payment.webhook_mismatch", "Cart", target.cartId, {
      eventId: event.id,
      type: event.type,
      eventAmount: event.data.amount ?? null,
      eventCurrency: event.data.currency ?? null,
    });
    throw new WebhookMismatchError();
  }
  const record = recorder(event);
  try {
    if (event.type !== "payment.succeeded") {
      await prisma.$transaction(async (tx) => {
        await record(tx);
        if (event.type === "payment.failed" && share) {
          await tx.paymentShare.updateMany({
            where: { id: share.id, status: PaymentShareStatus.REQUIRES_ACTION },
            data: { status: PaymentShareStatus.FAILED, failureCode: "psp_failed" },
          });
        } else if (event.type === "payment.failed" && cartPayment) {
          await tx.cartPayment.updateMany({
            where: { id: cartPayment.id, status: PaymentStatus.REQUIRES_ACTION },
            data: { status: PaymentStatus.FAILED, failureCode: "psp_failed" },
          });
        }
      });
      return { duplicate: false };
    }
    return await withCartPaymentLock(target.cartId, () =>
      share ? shareSucceeded(event, share.id) : cartSucceeded(event, cartPayment!.id)
    );
  } catch (error) {
    if (isUniqueViolation(error)) return { duplicate: true };
    throw error;
  }
}

// ───────────────────────────── pay ─────────────────────────────

async function shareSucceeded(event: WebhookEvent, shareId: string): Promise<Result> {
  const record = recorder(event);
  const ref = event.data.providerRef;
  const applied = await withSerializableRetry(async (tx) => {
    const head = await tx.paymentShare.findUniqueOrThrow({
      where: { id: shareId },
      select: { cartId: true },
    });
    await tx.$queryRaw`SELECT id FROM "Cart" WHERE id = ${head.cartId} FOR UPDATE`;
    const share = await tx.paymentShare.findUniqueOrThrow({
      where: { id: shareId },
      select: {
        status: true,
        providerRef: true,
        plan: { select: { status: true, deadlineAt: true } },
      },
    });
    if (
      share.providerRef === ref &&
      (share.status === PaymentShareStatus.AUTHORIZED ||
        share.status === PaymentShareStatus.CAPTURED ||
        share.status === PaymentShareStatus.REFUNDED)
    ) {
      await record(tx);
      return "known" as const; // saga zaten biliyor (ya da iade edildi → ikinci iade YOK)
    }
    const cart = await tx.cart.findUnique({ where: { id: head.cartId }, select: { status: true } });
    const open =
      (share.plan.status === SplitPlanStatus.COLLECTING ||
        share.plan.status === SplitPlanStatus.FALLBACK) &&
      share.plan.deadlineAt.getTime() > Date.now() &&
      cart?.status === CartStatus.HELD &&
      (share.status === PaymentShareStatus.INVITED ||
        share.status === PaymentShareStatus.FAILED ||
        share.status === PaymentShareStatus.REQUIRES_ACTION);
    if (!open) return "late" as const;
    await record(tx);
    const now = new Date();
    await tx.paymentShare.update({
      where: { id: shareId },
      data: {
        status: PaymentShareStatus.CAPTURED,
        authorizedAt: now,
        capturedAt: now,
        failureCode: null,
      },
    });
    return "applied" as const;
  });
  if (applied === "known") return { duplicate: false };
  if (applied === "applied") {
    cartLateSuccessTotal.inc({ subject: "share", outcome: "applied" });
    // Son eksik pay buysa tahsilat + onay (kilit zaten bizde → iç sagayı doğrudan çağır).
    await settleSplitIfFundedLocked(shareId);
    return { duplicate: false };
  }

  // Plan kapandı: pay tek başına sepeti onaylayamaz → iade.
  const share = await prisma.paymentShare.findUniqueOrThrow({
    where: { id: shareId },
    select: { amountMinor: true, currency: true, cartId: true, status: true, failureCode: true },
  });
  await getPaymentProvider().refund(
    ref,
    money(minorFromDb(share.amountMinor), assertCurrency(share.currency)),
    `compensate:${ref}`
  );
  await withSerializableRetry(async (tx) => {
    await record(tx);
    await tx.paymentShare.updateMany({
      where: { id: shareId, status: { not: PaymentShareStatus.CAPTURED } },
      data: {
        status: PaymentShareStatus.REFUNDED,
        refundedAmountMinor: share.amountMinor,
        refundedAt: new Date(),
        failureCode: "LATE_SUCCESS",
      },
    });
    await tx.paymentEvent.upsert({
      where: { id: `comp:${ref}` },
      create: { id: `comp:${ref}`, type: "compensation.split_share_late", providerRef: ref },
      update: {},
    });
  });
  cartLateSuccessTotal.inc({ subject: "share", outcome: "refunded" });
  await audit("system:webhook", "cart.split_late_success", "Cart", share.cartId, {
    outcome: "refunded",
    eventId: event.id,
    shareId,
    providerRef: ref,
    previousStatus: share.status,
  });
  return { duplicate: false, compensated: true };
}

// ─────────────────────────── sepet tek ödemesi ───────────────────────────

async function cartSucceeded(event: WebhookEvent, cartPaymentId: string): Promise<Result> {
  const record = recorder(event);
  const ref = event.data.providerRef;
  const cp = await prisma.cartPayment.findUniqueOrThrow({
    where: { id: cartPaymentId },
    select: { cartId: true, status: true, providerRef: true, amountMinor: true, currency: true },
  });
  if (cp.status === PaymentStatus.PAID && cp.providerRef === ref) {
    await prisma.$transaction(async (tx) => record(tx));
    return { duplicate: false };
  }
  let wasHeld = false;
  let reason = "CART_NOT_CONFIRMABLE";
  try {
    await withSerializableRetry(async (tx) => {
      wasHeld = await reholdCartInTx(tx, cp.cartId);
      await tx.cartPayment.updateMany({
        where: {
          id: cartPaymentId,
          status: { notIn: [PaymentStatus.PAID, PaymentStatus.REFUNDED] },
        },
        data: {
          status: PaymentStatus.AUTHORIZED,
          providerRef: ref,
          authorizedAt: new Date(),
          failureCode: null,
        },
      });
      await record(tx);
      await confirmCartInTransaction(tx, cp.cartId, ref);
    });
  } catch (error) {
    if (
      !(error instanceof ConflictError) &&
      !(error instanceof InventoryUnavailableError) &&
      !isUniqueViolation(error)
    ) {
      throw error;
    }
    if (isUniqueViolation(error)) {
      // Olay kimliği zaten işlendi mi? Öyleyse tekrar.
      const seen = await prisma.paymentEvent.findUnique({ where: { id: event.id } });
      if (seen) return { duplicate: true };
      reason = "CART_ACTIVE_CONFLICT";
    } else {
      reason = error instanceof ConflictError ? error.code : "INVENTORY_UNAVAILABLE";
    }
    return refundCartPayment(event, cartPaymentId, reason);
  }
  const outcome = wasHeld ? "applied" : "reconfirmed";
  cartLateSuccessTotal.inc({ subject: "cart", outcome });
  if (!wasHeld) {
    await audit("system:webhook", "cart.late_success", "Cart", cp.cartId, {
      outcome,
      eventId: event.id,
      providerRef: ref,
    });
  }
  const bookings = await prisma.booking.findMany({
    where: { cartId: cp.cartId },
    select: { id: true, propertyId: true },
  });
  for (const propertyId of new Set(bookings.map((b) => b.propertyId))) {
    await invalidatePropertySearchCache(propertyId).catch(() => undefined);
  }
  for (const b of bookings) await invalidateBookingCache(b.id).catch(() => 0);
  return { duplicate: false };
}

/**
 * Sepeti onaylanabilir hâle getirir: HELD ise (zamanında) dokunmaz → true. Süresi dolmuş /
 * bırakılmışsa kalem rezervasyonlarının tutmalarını yeniden alır (yer yoksa fırlatır → iade)
 * ve sepeti HELD'e döndürür → false. Bölünmüş ödeme planı varsa tek ödeme uygulanamaz.
 */
async function reholdCartInTx(tx: Prisma.TransactionClient, cartId: string): Promise<boolean> {
  await tx.$queryRaw`SELECT id FROM "Cart" WHERE id = ${cartId} FOR UPDATE`;
  const cart = await tx.cart.findUniqueOrThrow({
    where: { id: cartId },
    select: {
      status: true,
      items: { select: { bookingId: true } },
      payment: { select: { splitPlans: { select: { status: true } } } },
    },
  });
  if (cart.payment?.splitPlans.some((p) => p.status !== SplitPlanStatus.ABORTED)) {
    throw new ConflictError("Sepet bölünmüş ödemeyle ödeniyor", "SPLIT_ACTIVE");
  }
  if (cart.status === CartStatus.HELD) return true;
  if (cart.status !== CartStatus.EXPIRED && cart.status !== CartStatus.OPEN) {
    throw new ConflictError("Sepet artık onaylanamaz", "CART_NOT_CONFIRMABLE");
  }
  const ids = cart.items.map((i) => i.bookingId).filter((id): id is string => !!id);
  if (ids.length === 0 || ids.length !== cart.items.length) {
    throw new ConflictError("Sepet kalemleri eksik", "CART_INCOMPLETE");
  }
  const holdExpiresAt = new Date(Date.now() + LATE_SUCCESS_HOLD_MS);
  const bookings = await tx.booking.findMany({
    where: { id: { in: ids }, cartId },
    select: {
      id: true,
      status: true,
      version: true,
      roomId: true,
      checkIn: true,
      checkOut: true,
      units: true,
    },
    orderBy: { id: "asc" },
  });
  for (const b of bookings) {
    if (b.status === "EXPIRED") {
      await holdUnits(tx, {
        roomTypeId: b.roomId,
        checkIn: b.checkIn,
        checkOut: b.checkOut,
        units: b.units,
      });
    } else if (b.status !== "HELD") {
      throw new ConflictError("Sepet kalemi artık onaylanamaz", "CART_NOT_CONFIRMABLE");
    }
    const reopened = await tx.booking.updateMany({
      where: { id: b.id, status: b.status, version: b.version },
      data: { status: "HELD", expiredAt: null, holdExpiresAt, version: { increment: 1 } },
    });
    if (reopened.count !== 1) {
      throw new ConflictError("Rezervasyon eşzamanlı olarak değişti", "CONCURRENT_UPDATE");
    }
  }
  // Kısmi benzersiz indeks: kullanıcının başka aktif sepeti varsa P2002 → iade.
  await tx.cart.update({
    where: { id: cartId },
    data: {
      status: CartStatus.HELD,
      holdExpiresAt,
      expiredAt: null,
      version: { increment: 1 },
    },
  });
  return false;
}

async function refundCartPayment(
  event: WebhookEvent,
  cartPaymentId: string,
  reason: string
): Promise<Result> {
  const record = recorder(event);
  const ref = event.data.providerRef;
  const cp = await prisma.cartPayment.findUniqueOrThrow({
    where: { id: cartPaymentId },
    select: { cartId: true, amountMinor: true, currency: true, status: true },
  });
  await getPaymentProvider().refund(
    ref,
    money(minorFromDb(cp.amountMinor), assertCurrency(cp.currency)),
    `compensate:${ref}`
  );
  await withSerializableRetry(async (tx) => {
    await record(tx);
    const now = new Date();
    await tx.cartPayment.updateMany({
      where: { id: cartPaymentId, providerRef: ref, status: { not: PaymentStatus.PAID } },
      data: {
        status: PaymentStatus.REFUNDED,
        paidAt: now,
        refundedAmountMinor: cp.amountMinor,
        refundedAt: now,
        failureCode: reason,
      },
    });
    await tx.paymentEvent.upsert({
      where: { id: `comp:${ref}` },
      create: { id: `comp:${ref}`, type: "compensation.cart_late", providerRef: ref },
      update: {},
    });
  });
  cartLateSuccessTotal.inc({ subject: "cart", outcome: "refunded" });
  await audit("system:webhook", "cart.late_success", "Cart", cp.cartId, {
    outcome: "refunded",
    eventId: event.id,
    providerRef: ref,
    reason,
  }).catch((error) => logger.warn(errorFields(error), "audit failed"));
  return { duplicate: false, compensated: true };
}
