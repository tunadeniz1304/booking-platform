import { randomBytes } from "crypto";
import { BookingStatus, TransferStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";
import { bumpTokenVersion, publishTokenVersion } from "@/lib/auth/token-version";
import { cancelAndRefund } from "@/lib/payment/payment-service";
import { cancelTransferListing } from "@/lib/transfer/transfer-service";
import { logger, errorFields } from "@/lib/observability/logger";

/**
 * KVKK/GDPR self-servis (P2-5).
 * - Dışa aktarım: kullanıcının kişisel verileri JSON (parola özeti ASLA yok).
 * - Silme: hesap anonimleştirilir; rezervasyon/ödeme kayıtları yasal saklama için
 *   korunur ama kişisel alanlar pseudonimleştirilir, yorum metinleri silinir.
 */
export async function exportUserData(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      createdAt: true,
      bookings: {
        select: {
          id: true,
          propertyId: true,
          checkIn: true,
          checkOut: true,
          guestCount: true,
          totalPrice: true,
          currency: true,
          status: true,
          createdAt: true,
        },
      },
      reviews: {
        select: { id: true, propertyId: true, rating: true, comment: true, createdAt: true },
      },
      favorites: { select: { propertyId: true, createdAt: true } },
      payments: {
        select: {
          id: true,
          bookingId: true,
          amount: true,
          currency: true,
          status: true,
          createdAt: true,
        },
      },
    },
  });
  const notifications = await prisma.notification.findMany({
    where: { userId },
    select: { subject: true, createdAt: true },
  });
  return { exportedAt: new Date().toISOString(), user, notifications };
}

export interface DeleteAccountResult {
  cancelledBookings: string[];
  cancelledTransfers: string[];
}

/**
 * Hesap silme (v3#5):
 *  1. Gelecekteki aktif rezervasyonlar (HELD/CONFIRMED) rezervasyon anındaki iptal
 *     politikasına göre iptal edilir (iade `cancelAndRefund` ile).
 *  2. Açık devir ilanları geri çekilir.
 *  3. Kişisel alanlar pseudonimleştirilir, passkey'ler ve tek kullanımlık token'lar silinir.
 *  4. `tokenVersion` artırılır → TÜM cihazlardaki erişim/yenileme token'ları geçersiz.
 */
export async function deleteAccount(
  userId: string,
  now = new Date()
): Promise<DeleteAccountResult> {
  const active = await prisma.booking.findMany({
    where: {
      userId,
      status: { in: [BookingStatus.HELD, BookingStatus.CONFIRMED, BookingStatus.PENDING] },
      checkOut: { gt: now },
    },
    select: { id: true },
  });
  const cancelledBookings: string[] = [];
  for (const b of active) {
    try {
      await cancelAndRefund(b.id, userId, now);
      cancelledBookings.push(b.id);
    } catch (error) {
      // Silme durdurulmaz; iptal edilemeyen rezervasyon loglanır (yönetici takibi).
      logger.error({ bookingId: b.id, ...errorFields(error) }, "account deletion: cancel failed");
    }
  }
  const listings = await prisma.bookingTransfer.findMany({
    where: { sellerId: userId, status: TransferStatus.LISTED },
    select: { id: true },
  });
  const cancelledTransfers: string[] = [];
  for (const t of listings) {
    await cancelTransferListing(t.id, userId).then(
      () => cancelledTransfers.push(t.id),
      (error) => logger.error({ transferId: t.id, ...errorFields(error) }, "transfer cancel failed")
    );
  }

  const pseudo = `silinmis-${userId.slice(-8)}`;
  const unusableHash = await hashPassword(randomBytes(32).toString("hex"));
  const version = await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        email: `${pseudo}@anon.invalid`,
        firstName: "Silinmiş",
        lastName: "Kullanıcı",
        avatarUrl: null,
        passwordHash: unusableHash,
        deletedAt: now,
        lockedUntil: null,
        failedLoginCount: 0,
      },
    });
    await tx.review.updateMany({ where: { userId }, data: { comment: null } });
    await tx.favorite.deleteMany({ where: { userId } });
    await tx.webAuthnCredential.deleteMany({ where: { userId } });
    await tx.authToken.deleteMany({ where: { userId } });
    await tx.notification.updateMany({
      where: { userId },
      data: { to: `${pseudo}@anon.invalid`, text: "", html: "" },
    });
    return bumpTokenVersion(userId, tx);
  });
  await publishTokenVersion(userId, version);
  return { cancelledBookings, cancelledTransfers };
}
