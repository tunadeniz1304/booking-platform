import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";

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

export async function deleteAccount(userId: string): Promise<void> {
  const pseudo = `silinmis-${userId.slice(-8)}`;
  const unusableHash = await hashPassword(randomBytes(32).toString("hex"));
  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: {
        email: `${pseudo}@anon.invalid`,
        firstName: "Silinmiş",
        lastName: "Kullanıcı",
        avatarUrl: null,
        passwordHash: unusableHash,
      },
    }),
    prisma.review.updateMany({ where: { userId }, data: { comment: null } }),
    prisma.favorite.deleteMany({ where: { userId } }),
    prisma.notification.updateMany({
      where: { userId },
      data: { to: `${pseudo}@anon.invalid`, text: "", html: "" },
    }),
  ]);
}
