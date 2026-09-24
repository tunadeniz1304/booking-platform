import { createHmac, timingSafeEqual, randomBytes } from "crypto";
import { Prisma, BookingStatus, TransferStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * P2P Booking Transfer (ikincil pazar).
 *
 * İptal edilemeyen / non-refundable rezervasyonu, satıcının listelemesi ve
 * başka bir kullanıcının talep etmesiyle güvenli şekilde devreder.
 *
 * Güvenlik modeli:
 *  - transferToken: HMAC-SHA256 imzalı, sürelifji (exp) yük — "delege edilebilir
 *    vekâlet". PaylaşılanToken dışarı sızarsa yalnız TOKEN süresi boyunca
 *    yetki verir ve rezervasyon sahiplik koşulu (booking.userId == sellerId)
 *    yine sağlanmalıdır (zincirleme denetim, zk-SNARK yerine doğrulanabilir
 *    delegasyon).
 *  - BOLA: liste yalnız rezervasyon sahibi; talep yalnız alıcı + LISTED.
 *  - Race: devir, booking.userId == sellerId koşuluyla SERIALIZABLE tx + koşullu
 *    updateMany (status LISTED && claimedById null) → çift talep imkânsız.
 */

const TRANSFER_SECRET = process.env.JWT_SECRET || "insecure-transfer-secret";
const TRANSFER_LINK_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 gün

export class TransferError extends Error {
  constructor(
    message: string,
    readonly status = 422
  ) {
    super(message);
    this.name = "TransferError";
  }
}

export interface ListedTransfer {
  id: string;
  bookingId: string;
  sellerId: string;
  status: TransferStatus;
  askPrice: number;
  currency: string;
  transferToken: string;
  listedAt: Date;
}

/** HMAC imzalı, süreli transfer jetonu üret. */
function signTransferToken(bookingId: string, sellerId: string, nonce: string): string {
  const exp = Date.now() + TRANSFER_LINK_TTL_MS;
  const payload = `${bookingId}.${sellerId}.${nonce}.${exp}`;
  const sig = createHmac("sha256", TRANSFER_SECRET).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

/** Jetonu doğrula ve çözümle (süre + imza). */
export function verifyTransferToken(token: string): {
  bookingId: string;
  sellerId: string;
  nonce: string;
  exp: number;
} | null {
  const parts = token.split(".");
  if (parts.length !== 5) return null;
  const [bookingId, sellerId, nonce, expRaw, sig] = parts;
  const recreated = createHmac("sha256", TRANSFER_SECRET)
    .update(parts.slice(0, 4).join("."))
    .digest("hex");
  const expected = Buffer.from(recreated);
  const actual = Buffer.from(sig);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp < Date.now()) return null;
  return { bookingId, sellerId, nonce, exp };
}

/** Satıcının rezervasyonunu ikincil pazara listeler. */
export async function listBookingForTransfer(
  bookingId: string,
  sellerId: string,
  askPrice: number
): Promise<ListedTransfer> {
  if (!Number.isFinite(askPrice) || askPrice <= 0) {
    throw new TransferError("Geçersiz istek fiyatı", 400);
  }

  return prisma.$transaction(
    async (tx) => {
      const booking = await tx.booking.findFirst({
        where: {
          id: bookingId,
          userId: sellerId, // BOLA
          status: { in: [BookingStatus.CONFIRMED, BookingStatus.PENDING] },
        },
        select: { id: true, totalPrice: true, currency: true, checkIn: true },
      });
      if (!booking) {
        throw new TransferError("Rezervasyon bulunamadı veya size ait değil", 404);
      }
      if (booking.checkIn <= new Date()) {
        throw new TransferError("Başlamış/geçmiş rezervasyon devredilemez", 400);
      }

      // Adil üst sınır: kullanıcıya maliyetin en fazla %35 üzeri talep edilebilir
      const originalCost = Number(booking.totalPrice);
      const maxAsk = originalCost * 1.35;
      if (askPrice > maxAsk) {
        throw new TransferError(
          `İstek fiyatı adil üst sınırı aşıyor (maks ${maxAsk.toFixed(0)})`,
          400
        );
      }

      // Aynı rezervasyon için yeni liste eski aktif listeyi iptal eder
      await tx.bookingTransfer.updateMany({
        where: { bookingId, status: { in: [TransferStatus.LISTED, TransferStatus.CLAIMED] } },
        data: { status: TransferStatus.CANCELLED },
      });

      const nonce = randomBytes(12).toString("hex");
      const token = signTransferToken(booking.id, sellerId, nonce);
      const transfer = await tx.bookingTransfer.create({
        data: {
          bookingId: booking.id,
          sellerId,
          askPrice: new Prisma.Decimal(askPrice.toFixed(2)),
          currency: booking.currency,
          transferToken: token,
          status: TransferStatus.LISTED,
        },
      });
      return {
        id: transfer.id,
        bookingId: transfer.bookingId,
        sellerId: transfer.sellerId,
        status: transfer.status,
        askPrice: Number(transfer.askPrice),
        currency: transfer.currency,
        transferToken: transfer.transferToken,
        listedAt: transfer.listedAt,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
}

/** Alıcı listelenmiş rezervasyonu talep eder → sahiplik atomik devredilir. */
export async function claimTransfer(transferId: string, buyerId: string): Promise<ListedTransfer> {
  return prisma.$transaction(
    async (tx) => {
      // Koşullu devir: yalnız LISTED ve henüz kimse talep etmemişse
      const claimed = await tx.bookingTransfer.updateMany({
        where: { id: transferId, status: TransferStatus.LISTED, claimedById: null },
        data: { status: TransferStatus.CLAIMED, claimedById: buyerId, claimedAt: new Date() },
      });
      if (claimed.count !== 1) {
        throw new TransferError("Transfer artık mevcut değil (başkası talep etti)", 409);
      }

      const transfer = await tx.bookingTransfer.findUnique({
        where: { id: transferId },
        include: { booking: { select: { id: true, userId: true, checkIn: true, status: true } } },
      });
      if (!transfer || !transfer.booking) throw new TransferError("Transfer bulunamadı", 404);
      if (transfer.sellerId === buyerId) {
        throw new TransferError("Kendi rezervasyonunuzu talep edemezsiniz", 400);
      }
      // Jeton imzası/süresi — hâlâ geçerli olmalı
      if (!verifyTransferToken(transfer.transferToken)) {
        throw new TransferError("Transfer jetonu süresi dolmuş veya geçersiz", 410);
      }
      if (transfer.booking.checkIn <= new Date()) {
        throw new TransferError("Başlamış rezervasyon devredilemez", 400);
      }

      // Sahiplik değişimi — eski sahip koşulu tekrar doğrulanır (race'de güvenli)
      const owned = await tx.booking.updateMany({
        where: { id: transfer.bookingId, userId: transfer.sellerId },
        data: { userId: buyerId },
      });
      if (owned.count !== 1) {
        throw new TransferError("Rezervasyon sahipliği değişti, işlem iptal", 409);
      }

      await tx.bookingTransfer.update({
        where: { id: transferId },
        data: { status: TransferStatus.COMPLETED, completedAt: new Date() },
      });

      return {
        id: transfer.id,
        bookingId: transfer.bookingId,
        sellerId: transfer.sellerId,
        status: TransferStatus.COMPLETED,
        askPrice: Number(transfer.askPrice),
        currency: transfer.currency,
        transferToken: transfer.transferToken,
        listedAt: transfer.listedAt,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
}

/** Satıcı listeyi iptal edebilir. */
export async function cancelTransferListing(transferId: string, sellerId: string): Promise<void> {
  await prisma.bookingTransfer.updateMany({
    where: {
      id: transferId,
      sellerId,
      status: { in: [TransferStatus.LISTED, TransferStatus.CLAIMED] },
    },
    data: { status: TransferStatus.CANCELLED },
  });
}

/** Kullanıcının satıcı/alıcı olduğu transferleri listeler. */
export async function listMyTransfers(userId: string) {
  return prisma.bookingTransfer.findMany({
    where: { OR: [{ sellerId: userId }, { claimedById: userId }] },
    orderBy: { listedAt: "desc" },
    include: { booking: { select: { id: true, propertyId: true, checkIn: true, checkOut: true } } },
    take: 50,
  });
}
