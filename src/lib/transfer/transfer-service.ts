import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import { Prisma, BookingStatus, PaymentStatus, TransferStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { HttpError } from "@/lib/http/errors";
import { getConfig } from "@/lib/config/app-config";
import { withSerializableRetry } from "@/lib/db/transactions";
import { appendOutbox } from "@/lib/cqrs";
import { EventTypes, makeEvent, type BookingTransferredPayload } from "@/lib/events/events";
import { money, multiplyRate, toDecimalString, toMinor, assertCurrency } from "@/lib/money/money";
import { fromDate } from "@/lib/time/nights";
import { getPaymentProvider } from "@/lib/payment";
import { logger, errorFields } from "@/lib/observability/logger";

/**
 * P2P rezervasyon devri (ikincil pazar).
 *
 *  1. Satıcı CONFIRMED rezervasyonunu listeler → sunucu `TRANSFER_SIGNING_SECRET` ile
 *     imzalı tek kullanımlık CLAIM LİNKİ üretir ve YALNIZCA satıcıya bir kez gösterir;
 *     veritabanında yalnızca sha256(token) tutulur (token sızdırılamaz).
 *  2. Alıcı linki açar → imza (timing-safe) + süre + özet eşleşmesi doğrulanır.
 *  3. `askPrice` alıcıdan PSP ile yetkilendirilir; reddedilirse hiçbir şey değişmez.
 *  4. Tek SERIALIZABLE işlemde (P2034'te retry): ilan LISTED→COMPLETED (nonce tüketilir),
 *     rezervasyon + ödeme sahipliği alıcıya geçer, defter kayıtları yazılır (escrow).
 *     İşlem başarısızsa alıcının yetkilendirmesi iptal edilir.
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

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

interface TokenPayload {
  transferId: string;
  bookingId: string;
  exp: number;
  nonce: string;
}

export function signClaimToken(payload: TokenPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", signingSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

/** İmza (timing-safe) ve süre doğrulaması; geçersizse `null`. */
export function verifyClaimToken(token: string, now = Date.now()): TokenPayload | null {
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
  const provider = getPaymentProvider();

  // Ödeme önce yetkilendirilir: reddedilirse sahiplik ASLA değişmez.
  const auth = await provider.authorize({
    amount: ask,
    cardToken: input.cardToken,
    idempotencyKey: `transfer:${transfer.id}:${input.buyerId}`,
  });
  if (auth.status !== "authorized") {
    throw new HttpError(402, "PAYMENT_DECLINED", "Ödeme onaylanmadı; devir gerçekleşmedi");
  }

  try {
    const result = await withSerializableRetry(async (tx) => {
      const claimed = await tx.bookingTransfer.updateMany({
        where: { id: transfer.id, status: TransferStatus.LISTED, expiresAt: { gt: now } },
        data: {
          status: TransferStatus.COMPLETED,
          claimedById: input.buyerId,
          claimedAt: now,
          completedAt: now,
          buyerPaymentRef: auth.providerRef,
        },
      });
      if (claimed.count !== 1)
        throw new TransferError("Bu devir artık mevcut değil", 409, "ALREADY_CLAIMED");

      const booking = await tx.booking.findUnique({
        where: { id: transfer.bookingId },
        select: {
          id: true,
          userId: true,
          status: true,
          checkIn: true,
          checkOut: true,
          propertyId: true,
          roomId: true,
          guestCount: true,
        },
      });
      const config = getConfig();
      if (
        !booking ||
        booking.userId !== transfer.sellerId ||
        booking.status !== BookingStatus.CONFIRMED ||
        (booking.checkIn.getTime() - now.getTime()) / 3_600_000 <=
          config.TRANSFER_MIN_HOURS_BEFORE_CHECKIN
      ) {
        throw new TransferError("Rezervasyon artık devredilemez", 409, "BOOKING_CHANGED");
      }
      const owned = await tx.booking.updateMany({
        where: { id: booking.id, userId: transfer.sellerId, status: BookingStatus.CONFIRMED },
        data: { userId: input.buyerId, version: { increment: 1 } },
      });
      if (owned.count !== 1)
        throw new TransferError("Rezervasyon sahipliği değişti", 409, "BOOKING_CHANGED");

      // Asıl ödeme kaydı (ve gelecekteki iade hakkı) yeni sahibe geçer.
      await tx.payment.updateMany({
        where: {
          bookingId: booking.id,
          status: { in: [PaymentStatus.PAID, PaymentStatus.PARTIALLY_REFUNDED] },
        },
        data: { userId: input.buyerId },
      });
      const amount = new Prisma.Decimal(toDecimalString(ask));
      await tx.ledgerEntry.createMany({
        data: [
          {
            bookingId: booking.id,
            userId: input.buyerId,
            kind: "TRANSFER_PAYMENT",
            amount,
            currency,
            reference: auth.providerRef,
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
        makeEvent<BookingTransferredPayload>(EventTypes.BookingTransferred, booking.id, "booking", {
          bookingId: booking.id,
          propertyId: booking.propertyId,
          roomId: booking.roomId,
          checkIn: fromDate(booking.checkIn),
          checkOut: fromDate(booking.checkOut),
          userId: input.buyerId,
          fromUserId: transfer.sellerId,
          toUserId: input.buyerId,
          transferId: transfer.id,
        })
      );
      return booking.id;
    });

    await provider.capture(auth.providerRef, ask);
    await redis.del(`booking:${result}`).catch(() => 0);
    return {
      transferId: transfer.id,
      bookingId: result,
      status: TransferStatus.COMPLETED,
      paidMinor: ask.amount,
      currency,
    };
  } catch (error) {
    await provider
      .void(auth.providerRef)
      .catch((e) => logger.error(errorFields(e), "transfer auth void failed"));
    throw error;
  }
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
