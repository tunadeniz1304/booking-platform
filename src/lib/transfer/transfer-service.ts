import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import { Prisma, BookingStatus, TransferStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { invalidateBookingCache } from "@/lib/booking/booking-cache";
import { HttpError } from "@/lib/http/errors";
import { getConfig } from "@/lib/config/app-config";
import { withSerializableRetry } from "@/lib/db/transactions";
import { appendOutbox } from "@/lib/cqrs";
import { EventTypes, makeEvent, type BookingTransferredPayload } from "@/lib/events/events";
import {
  money,
  multiplyRate,
  toDecimalString,
  toMinor,
  assertCurrency,
  type Money,
} from "@/lib/money/money";
import { fromDate } from "@/lib/time/nights";
import { getPaymentProvider } from "@/lib/payment";
import type { PaymentProvider } from "@/lib/payment/provider";
import { runSaga, type SagaStep } from "@/lib/saga/saga";
import { logger, errorFields } from "@/lib/observability/logger";
import { counter } from "@/lib/observability/metrics";
import { audit } from "@/lib/admin/audit";

/**
 * P2P rezervasyon devri (ikincil pazar).
 *
 *  1. Satıcı CONFIRMED rezervasyonunu listeler → sunucu `TRANSFER_SIGNING_SECRET` ile
 *     imzalı tek kullanımlık CLAIM LİNKİ üretir ve YALNIZCA satıcıya bir kez gösterir;
 *     veritabanında yalnızca sha256(token) tutulur (token sızdırılamaz).
 *  2. Alıcı linki açar → imza (timing-safe) + süre + özet eşleşmesi doğrulanır.
 *  3. `askPrice` alıcıdan PSP ile yetkilendirilir; reddedilirse hiçbir şey değişmez.
 *  4. İlan LISTED→CAPTURE_PENDING (nonce tüketilir), ardından PSP capture; YALNIZCA capture
 *     başarılıysa tek SERIALIZABLE işlemde ilan COMPLETED, rezervasyon sahipliği alıcıya geçer,
 *     payout + defter yazılır (v4#1). Capture/commit düşerse ilan FAILED, sahiplik değişmez,
 *     yetkilendirme void edilir ya da tahsilat iade edilir (saga telafisi).
 *
 * Karaborsa önleme: askPrice ≤ TRANSFER_MAX_ASK_RATIO × ödenen tutar.
 * Yalnızca check-in'e TRANSFER_MIN_HOURS_BEFORE_CHECKIN saatten fazla kalan rezervasyonlar.
 */

export class TransferError extends HttpError {
  constructor(message: string, status = 422, code = "TRANSFER_ERROR") {
    super(status, code, message);
    this.name = "TransferError";
  }
}

function signingSecret(): string {
  const secret = process.env.TRANSFER_SIGNING_SECRET ?? "";
  if (secret.length < 32) {
    // Fallback YOK: zayıf/eksik sırla devir özelliği kapalıdır.
    throw new TransferError("Devir özelliği yapılandırılmamış", 503, "TRANSFER_UNAVAILABLE");
  }
  return secret;
}

function assertEnabled(): void {
  if (!getConfig().FEATURE_TRANSFER) {
    throw new TransferError("Devir özelliği kapalı", 404, "TRANSFER_DISABLED");
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

interface TokenPayload {
  transferId: string;
  bookingId: string;
  exp: number;
  nonce: string;
}

function signClaimToken(payload: TokenPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", signingSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

/** İmza (timing-safe) ve süre doğrulaması; geçersizse `null`. */
function verifyClaimToken(token: string, now = Date.now()): TokenPayload | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", signingSecret()).update(body).digest();
  const actual = Buffer.from(sig, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as TokenPayload;
    if (typeof payload.exp !== "number" || payload.exp < now) return null;
    return payload;
  } catch {
    return null;
  }
}

function maskName(first: string, last: string): string {
  return `${first.charAt(0)}*** ${last.charAt(0)}.`;
}

export interface ListedTransfer {
  id: string;
  bookingId: string;
  status: TransferStatus;
  askPrice: number;
  currency: string;
  expiresAt: string;
  /** Yalnızca listeleme yanıtında BİR KEZ döner; tekrar üretilemez. */
  claimToken: string;
}

export async function listBookingForTransfer(
  bookingId: string,
  sellerId: string,
  askPriceMinor: number,
  now = new Date()
): Promise<ListedTransfer> {
  assertEnabled();
  const config = getConfig();
  if (!Number.isSafeInteger(askPriceMinor) || askPriceMinor <= 0) {
    throw new TransferError("Geçersiz istek fiyatı", 400);
  }

  return withSerializableRetry(async (tx) => {
    const booking = await tx.booking.findFirst({
      where: { id: bookingId, userId: sellerId },
      select: { id: true, status: true, totalPrice: true, currency: true, checkIn: true },
    });
    if (!booking) throw new TransferError("Rezervasyon bulunamadı", 404, "NOT_FOUND");
    if (booking.status !== BookingStatus.CONFIRMED) {
      throw new TransferError(
        "Yalnızca onaylı rezervasyonlar devredilebilir",
        409,
        "INVALID_STATE"
      );
    }
    const hoursLeft = (booking.checkIn.getTime() - now.getTime()) / 3_600_000;
    if (hoursLeft <= config.TRANSFER_MIN_HOURS_BEFORE_CHECKIN) {
      throw new TransferError(
        `Girişe ${config.TRANSFER_MIN_HOURS_BEFORE_CHECKIN} saatten az kalan rezervasyon devredilemez`,
        400,
        "TOO_LATE"
      );
    }
    const currency = assertCurrency(booking.currency);
    const paid = money(toMinor(booking.totalPrice.toString(), currency), currency);
    const maxAsk = multiplyRate(paid, config.TRANSFER_MAX_ASK_RATIO);
    if (askPriceMinor > maxAsk.amount) {
      throw new TransferError(
        `İstek fiyatı üst sınırı aşıyor (en fazla ${toDecimalString(maxAsk)} ${currency})`,
        400,
        "ASK_TOO_HIGH"
      );
    }

    // v4#1: tahsilatı süren bir devir varken yeniden listeleme yok (çift satış önlenir).
    const pending = await tx.bookingTransfer.count({
      where: { bookingId, status: TransferStatus.CAPTURE_PENDING },
    });
    if (pending > 0) {
      throw new TransferError("Bu rezervasyon için devir ödemesi sürüyor", 409, "TRANSFER_PENDING");
    }

    await tx.bookingTransfer.updateMany({
      where: { bookingId, status: TransferStatus.LISTED },
      data: { status: TransferStatus.CANCELLED, cancelledAt: now },
    });

    const expiresAt = new Date(
      Math.min(
        now.getTime() + config.TRANSFER_LINK_TTL_HOURS * 3_600_000,
        booking.checkIn.getTime()
      )
    );
    const transferId = `tr_${randomBytes(12).toString("hex")}`;
    const token = signClaimToken({
      transferId,
      bookingId,
      exp: expiresAt.getTime(),
      nonce: randomBytes(16).toString("hex"),
    });
    const transfer = await tx.bookingTransfer.create({
      data: {
        id: transferId,
        bookingId,
        sellerId,
        askPrice: new Prisma.Decimal(toDecimalString(money(askPriceMinor, currency))),
        currency,
        tokenHash: hashToken(token),
        expiresAt,
        status: TransferStatus.LISTED,
      },
    });
    return {
      id: transfer.id,
      bookingId,
      status: transfer.status,
      askPrice: askPriceMinor,
      currency,
      expiresAt: expiresAt.toISOString(),
      claimToken: token,
    };
  });
}

export interface ClaimResult {
  transferId: string;
  bookingId: string;
  status: TransferStatus;
  paidMinor: number;
  currency: string;
}

/** Devir sagası adları (v4#1) — test hata enjeksiyonu `injectSagaFaultForTests` ile. */
export const TRANSFER_SAGA = "booking_transfer";
export const TRANSFER_SAGA_STEPS = {
  authorize: "authorize",
  reserve: "reserve",
  capture: "capture",
  commit: "commit",
} as const;

interface ClaimContext {
  transfer: { id: string; bookingId: string; sellerId: string };
  buyerId: string;
  cardToken: string;
  ask: Money;
  now: Date;
  providerRef?: string;
  reserved: boolean;
  captured: boolean;
  failureCode: string;
}

/** Rezervasyon hâlâ devredilebilir mi (satıcıda, CONFIRMED, girişe yeterli süre)? */
async function loadTransferableBooking(
  tx: Prisma.TransactionClient,
  bookingId: string,
  sellerId: string,
  now: Date
) {
  const booking = await tx.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      userId: true,
      status: true,
      checkIn: true,
      checkOut: true,
      propertyId: true,
      roomId: true,
    },
  });
  const config = getConfig();
  if (
    !booking ||
    booking.userId !== sellerId ||
    booking.status !== BookingStatus.CONFIRMED ||
    (booking.checkIn.getTime() - now.getTime()) / 3_600_000 <=
      config.TRANSFER_MIN_HOURS_BEFORE_CHECKIN
  ) {
    throw new TransferError("Rezervasyon artık devredilemez", 409, "BOOKING_CHANGED");
  }
  return booking;
}

/**
 * Devir sagası (v4#1). Sahiplik, payout ve defter YALNIZCA capture başarılı olduktan sonra
 * yazılır; öncesinde ilan `CAPTURE_PENDING` ara durumunda tutulur (ikinci alıcı giremez).
 *
 *   authorize → reserve (LISTED→CAPTURE_PENDING) → capture → commit (pivot, tek SERIALIZABLE tx)
 *
 * Telafiler ters sırada: capture yapıldıysa iade, ilan FAILED, yetkilendirme void.
 */
function claimSteps(provider: PaymentProvider): SagaStep<ClaimContext, string>[] {
  return [
    {
      name: TRANSFER_SAGA_STEPS.authorize,
      async run(ctx) {
        const auth = await provider.authorize({
          amount: ctx.ask,
          cardToken: ctx.cardToken,
          idempotencyKey: `transfer:${ctx.transfer.id}:${ctx.buyerId}`,
        });
        if (auth.status !== "authorized") {
          throw new HttpError(402, "PAYMENT_DECLINED", "Ödeme onaylanmadı; devir gerçekleşmedi");
        }
        ctx.providerRef = auth.providerRef;
      },
      async compensate(ctx) {
        if (!ctx.providerRef || ctx.captured) return false;
        await provider.void(ctx.providerRef);
      },
    },
    {
      name: TRANSFER_SAGA_STEPS.reserve,
      async run(ctx) {
        await withSerializableRetry(async (tx) => {
          const claimed = await tx.bookingTransfer.updateMany({
            where: {
              id: ctx.transfer.id,
              status: TransferStatus.LISTED,
              expiresAt: { gt: ctx.now },
            },
            data: {
              status: TransferStatus.CAPTURE_PENDING,
              claimedById: ctx.buyerId,
              claimedAt: ctx.now,
              buyerPaymentRef: ctx.providerRef,
            },
          });
          if (claimed.count !== 1)
            throw new TransferError("Bu devir artık mevcut değil", 409, "ALREADY_CLAIMED");
          await loadTransferableBooking(tx, ctx.transfer.bookingId, ctx.transfer.sellerId, ctx.now);
        });
        ctx.reserved = true;
        ctx.failureCode = "CAPTURE_FAILED";
      },
      async compensate(ctx) {
        if (!ctx.reserved) return false;
        // Sahiplik hiç değişmedi; ilan kalıcı olarak FAILED (satıcı yeniden listeleyebilir).
        await prisma.bookingTransfer.updateMany({
          where: { id: ctx.transfer.id, status: TransferStatus.CAPTURE_PENDING },
          data: {
            status: TransferStatus.FAILED,
            failedAt: new Date(),
            failureCode: ctx.failureCode,
          },
        });
      },
    },
    {
      name: TRANSFER_SAGA_STEPS.capture,
      async run(ctx) {
        await provider.capture(ctx.providerRef!, ctx.ask);
        ctx.captured = true;
        ctx.failureCode = "COMMIT_FAILED";
      },
      async compensate(ctx) {
        if (!ctx.captured || !ctx.providerRef) return false;
        await provider.refund(ctx.providerRef, ctx.ask, `transfer-refund:${ctx.transfer.id}`);
      },
    },
    {
      name: TRANSFER_SAGA_STEPS.commit,
      pivot: true,
      async run(ctx) {
        const { transfer, buyerId, now, ask } = ctx;
        const currency = ask.currency;
        const bookingId = await withSerializableRetry(async (tx) => {
          const done = await tx.bookingTransfer.updateMany({
            where: {
              id: transfer.id,
              status: TransferStatus.CAPTURE_PENDING,
              claimedById: buyerId,
            },
            data: { status: TransferStatus.COMPLETED, completedAt: now },
          });
          if (done.count !== 1)
            throw new TransferError("Bu devir artık mevcut değil", 409, "ALREADY_CLAIMED");

          const booking = await loadTransferableBooking(
            tx,
            transfer.bookingId,
            transfer.sellerId,
            now
          );
          const owned = await tx.booking.updateMany({
            where: { id: booking.id, userId: transfer.sellerId, status: BookingStatus.CONFIRMED },
            data: { userId: buyerId, version: { increment: 1 } },
          });
          if (owned.count !== 1)
            throw new TransferError("Rezervasyon sahipliği değişti", 409, "BOOKING_CHANGED");

          // Asıl ödeme (satıcının kartı) satıcıda kalır; satıcı bedelini payout ile alır.
          // İptal iadesi alıcının devir ödemesine (buyerPaymentRef) yapılır — yalnızca COMPLETED
          // devir iade hedefi olur, yani capture'ı kesinleşmiş ödeme (bkz. cancelAndRefund).
          const amount = new Prisma.Decimal(toDecimalString(ask));
          await tx.payout.create({
            data: {
              userId: transfer.sellerId,
              bookingId: booking.id,
              transferId: transfer.id,
              amount,
              currency,
            },
          });
          await tx.ledgerEntry.createMany({
            data: [
              {
                bookingId: booking.id,
                userId: buyerId,
                kind: "TRANSFER_PAYMENT",
                amount,
                currency,
                reference: ctx.providerRef,
              },
              {
                bookingId: booking.id,
                userId: transfer.sellerId,
                kind: "TRANSFER_PAYOUT",
                amount,
                currency,
                reference: transfer.id,
              },
            ],
          });
          await appendOutbox(
            tx,
            makeEvent<BookingTransferredPayload>(
              EventTypes.BookingTransferred,
              booking.id,
              "booking",
              {
                bookingId: booking.id,
                propertyId: booking.propertyId,
                roomId: booking.roomId,
                checkIn: fromDate(booking.checkIn),
                checkOut: fromDate(booking.checkOut),
                userId: buyerId,
                fromUserId: transfer.sellerId,
                toUserId: buyerId,
                transferId: transfer.id,
              }
            )
          );
          return booking.id;
        });
        return { done: bookingId };
      },
    },
  ];
}

export async function claimTransfer(input: {
  token: string;
  buyerId: string;
  cardToken: string;
  now?: Date;
}): Promise<ClaimResult> {
  assertEnabled();
  const now = input.now ?? new Date();
  const payload = verifyClaimToken(input.token, now.getTime());
  if (!payload)
    throw new TransferError("Devir linki geçersiz veya süresi dolmuş", 403, "INVALID_TOKEN");

  const transfer = await prisma.bookingTransfer.findUnique({ where: { id: payload.transferId } });
  if (
    !transfer ||
    transfer.tokenHash !== hashToken(input.token) ||
    transfer.bookingId !== payload.bookingId
  ) {
    throw new TransferError("Devir linki geçersiz", 403, "INVALID_TOKEN");
  }
  if (transfer.status !== TransferStatus.LISTED) {
    throw new TransferError("Bu devir artık mevcut değil", 409, "ALREADY_CLAIMED");
  }
  if (transfer.sellerId === input.buyerId) {
    throw new TransferError("Kendi rezervasyonunuzu devralamazsınız", 400, "SELF_CLAIM");
  }

  const currency = assertCurrency(transfer.currency);
  const ask = money(toMinor(transfer.askPrice.toString(), currency), currency);
  const ctx: ClaimContext = {
    transfer: { id: transfer.id, bookingId: transfer.bookingId, sellerId: transfer.sellerId },
    buyerId: input.buyerId,
    cardToken: input.cardToken,
    ask,
    now,
    reserved: false,
    captured: false,
    failureCode: "RESERVE_FAILED",
  };

  let bookingId: string;
  try {
    bookingId = await runSaga(TRANSFER_SAGA, claimSteps(getPaymentProvider()), ctx, {
      // Kart reddi iş sonucudur: yetkilendirme yok → telafi edilecek bir şey yok.
      isOutcome: (e) => e instanceof HttpError && e.code === "PAYMENT_DECLINED",
    });
  } catch (error) {
    if (error instanceof HttpError) throw error;
    logger.error({ transferId: transfer.id, ...errorFields(error) }, "transfer saga failed");
    throw new TransferError(
      "Ödeme tahsil edilemedi; devir gerçekleşmedi",
      502,
      "TRANSFER_PAYMENT_FAILED"
    );
  }

  await invalidateBookingCache(bookingId);
  return {
    transferId: transfer.id,
    bookingId,
    status: TransferStatus.COMPLETED,
    paidMinor: ask.amount,
    currency,
  };
}

export async function cancelTransferListing(transferId: string, sellerId: string): Promise<void> {
  const res = await prisma.bookingTransfer.updateMany({
    where: { id: transferId, sellerId, status: TransferStatus.LISTED },
    data: { status: TransferStatus.CANCELLED, cancelledAt: new Date() },
  });
  if (res.count !== 1) throw new TransferError("İlan bulunamadı", 404, "NOT_FOUND");
}

/** Kullanıcının satıcı/alıcı olduğu devirler — token veya özeti ASLA dönmez. */
export async function listMyTransfers(userId: string) {
  return prisma.bookingTransfer.findMany({
    where: { OR: [{ sellerId: userId }, { claimedById: userId }] },
    orderBy: { listedAt: "desc" },
    take: 50,
    select: {
      id: true,
      bookingId: true,
      status: true,
      askPrice: true,
      currency: true,
      listedAt: true,
      expiresAt: true,
      completedAt: true,
      sellerId: true,
      claimedById: true,
      booking: { select: { propertyId: true, checkIn: true, checkOut: true } },
    },
  });
}

/** Keşif listesi (public): satıcı kimliği maskeli, token yok. */
export async function discoverTransfers(now = new Date()) {
  assertEnabled();
  const rows = await prisma.bookingTransfer.findMany({
    where: { status: TransferStatus.LISTED, expiresAt: { gt: now } },
    orderBy: { listedAt: "desc" },
    take: 50,
    select: {
      id: true,
      askPrice: true,
      currency: true,
      expiresAt: true,
      seller: { select: { firstName: true, lastName: true } },
      booking: {
        select: {
          checkIn: true,
          checkOut: true,
          guestCount: true,
          totalPrice: true,
          property: { select: { id: true, title: true, location: { select: { city: true } } } },
        },
      },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    askPrice: Number(r.askPrice),
    originalPrice: Number(r.booking.totalPrice),
    currency: r.currency,
    expiresAt: r.expiresAt.toISOString(),
    seller: maskName(r.seller.firstName, r.seller.lastName),
    checkIn: fromDate(r.booking.checkIn),
    checkOut: fromDate(r.booking.checkOut),
    guestCount: r.booking.guestCount,
    property: {
      id: r.booking.property.id,
      title: r.booking.property.title,
      city: r.booking.property.location.city,
    },
  }));
}

export const transferSweepTotal = counter(
  "transfer_sweep_total",
  "CAPTURE_PENDING'de takılıp süpürülen devirler",
  ["outcome"] as const
);

export type SweepOutcome = "voided" | "refunded" | "unresolved";

/**
 * Takılı devir süpürücüsü (v4#1 ek): süreç capture ile commit arasında çökerse ilan
 * `CAPTURE_PENDING`'de kalır ve yeniden listelemeyi bloklar. Eşikten
 * (`TRANSFER_CAPTURE_PENDING_TIMEOUT_SECONDS`) eski kayıtlar önce koşullu olarak FAILED'a
 * çekilir (geç biten bir saga commit'i artık tutmaz; kendi telafisiyle iade eder), sonra
 * yetkilendirme void edilir; void olmazsa (capture yapılmış) saga ile AYNI idempotency
 * anahtarıyla iade edilir — çift iade olmaz. Sahiplik hiç değişmemiştir. Her kayıt audit'lenir.
 */
export async function sweepStuckTransfers(
  now = new Date(),
  provider: PaymentProvider = getPaymentProvider()
): Promise<{ swept: number; outcomes: Record<SweepOutcome, number> }> {
  const cutoff = new Date(
    now.getTime() - getConfig().TRANSFER_CAPTURE_PENDING_TIMEOUT_SECONDS * 1000
  );
  const stuck = await prisma.bookingTransfer.findMany({
    where: { status: TransferStatus.CAPTURE_PENDING, claimedAt: { lt: cutoff } },
    orderBy: { claimedAt: "asc" },
    take: 100,
    select: { id: true, bookingId: true, askPrice: true, currency: true, buyerPaymentRef: true },
  });
  const outcomes: Record<SweepOutcome, number> = { voided: 0, refunded: 0, unresolved: 0 };
  let swept = 0;
  for (const t of stuck) {
    const marked = await prisma.bookingTransfer.updateMany({
      where: { id: t.id, status: TransferStatus.CAPTURE_PENDING, claimedAt: { lt: cutoff } },
      data: { status: TransferStatus.FAILED, failedAt: now, failureCode: "CAPTURE_TIMEOUT" },
    });
    if (marked.count !== 1) continue; // başka süpürücü/saga önce davrandı
    swept += 1;
    let outcome: SweepOutcome = "unresolved";
    if (t.buyerPaymentRef) {
      try {
        await provider.void(t.buyerPaymentRef);
        outcome = "voided";
      } catch (voidError) {
        try {
          const currency = assertCurrency(t.currency);
          const ask = money(toMinor(t.askPrice.toString(), currency), currency);
          await provider.refund(t.buyerPaymentRef, ask, `transfer-refund:${t.id}`);
          outcome = "refunded";
        } catch (refundError) {
          logger.error(
            { transferId: t.id, void: errorFields(voidError).err, ...errorFields(refundError) },
            "stuck transfer compensation failed; manual review required"
          );
        }
      }
    }
    if (outcome === "unresolved") {
      await prisma.bookingTransfer.update({
        where: { id: t.id },
        data: { failureCode: "CAPTURE_TIMEOUT_UNRESOLVED" },
      });
    }
    outcomes[outcome] += 1;
    transferSweepTotal.inc({ outcome });
    await audit("system:transfer-sweep", "transfer.capture_timeout", "BookingTransfer", t.id, {
      bookingId: t.bookingId,
      outcome,
    });
  }
  if (swept > 0) logger.warn({ swept, outcomes }, "stuck CAPTURE_PENDING transfers swept");
  return { swept, outcomes };
}
