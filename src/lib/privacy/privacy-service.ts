import { randomBytes } from "crypto";
import { BookingStatus, ClaimStatus, PayoutStatus, TransferStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";
import { bumpTokenVersion, publishTokenVersion } from "@/lib/auth/token-version";
import { cancelAndRefund } from "@/lib/payment/payment-service";
import { cancelTransferListing } from "@/lib/transfer/transfer-service";
import { listMandates } from "@/lib/agentic/mandate";
import { logger, errorFields } from "@/lib/observability/logger";
import { getConfig } from "@/lib/config/app-config";
import { ConflictError } from "@/lib/http/errors";
import type { ConsentValue } from "@/lib/privacy/consent";

/**
 * KVKK/GDPR self-servis (P2-5).
 * - Dışa aktarım: kullanıcının kişisel verileri JSON (parola özeti ASLA yok).
 * - Silme: hesap anonimleştirilir; rezervasyon/ödeme kayıtları yasal saklama için
 *   korunur ama kişisel alanlar pseudonimleştirilir, yorum metinleri silinir.
 */
export interface ExportOptions {
  /** İstek çerezinden okunan çerez onayı (rıza sunucuda değil yalnız çerezde tutulur). */
  cookieConsent?: ConsentValue | null;
}

export async function exportUserData(userId: string, opts: ExportOptions = {}) {
  // v5#8: çok satırlı ilişkiler sınırlı (bellek/yanıt boyutu); aşımda `truncated` işaretlenir.
  const maxRows = getConfig().PRIVACY_EXPORT_MAX_ROWS;
  const raw = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      avatarUrl: true,
      role: true,
      locale: true,
      emailVerifiedAt: true,
      createdAt: true,
      updatedAt: true,
      bookings: {
        orderBy: { createdAt: "desc" },
        take: maxRows + 1,
        select: {
          id: true,
          propertyId: true,
          checkIn: true,
          checkOut: true,
          guestCount: true,
          totalPriceMinor: true,
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
        orderBy: { createdAt: "desc" },
        take: maxRows + 1,
        select: {
          id: true,
          bookingId: true,
          amountMinor: true,
          currency: true,
          status: true,
          createdAt: true,
        },
      },
    },
  });
  const user = {
    ...raw,
    bookings: raw.bookings.slice(0, maxRows),
    payments: raw.payments.slice(0, maxRows),
  };
  // Bildirim gövdesi tek kullanımlık bağlantı/token içerebilir → yalnız konu + tarih.
  const notificationRows = await prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: maxRows + 1,
    select: { subject: true, createdAt: true },
  });
  return {
    exportedAt: new Date().toISOString(),
    truncated: {
      bookings: raw.bookings.length > maxRows,
      payments: raw.payments.length > maxRows,
      notifications: notificationRows.length > maxRows,
    },
    user,
    notifications: notificationRows.slice(0, maxRows),
    // Rıza kaydı sunucuda tutulmaz (P2-5: yalnız `cookie_consent` çerezi); istekteki değer.
    consents: { cookie: opts.cookieConsent ?? null, storage: "cookie" as const },
    messages: await exportMessages(userId),
    agentMandates: await listMandates(userId, new Date(), null),
    agentMandateEvents: await prisma.auditLog.findMany({
      where: {
        actorId: userId,
        action: { in: ["agent_mandate.accepted", "agent_mandate.rejected"] },
      },
      select: { action: true, entityId: true, meta: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    priceAlerts: await prisma.priceAlert.findMany({
      where: { userId },
      select: {
        id: true,
        roomTypeId: true,
        checkIn: true,
        checkOut: true,
        guests: true,
        currency: true,
        lastTotalMinor: true,
        observations: true,
        active: true,
        lastNotifiedAt: true,
        createdAt: true,
      },
    }),
    claims: await exportClaims(userId),
    transfers: await prisma.bookingTransfer
      .findMany({
        where: { OR: [{ sellerId: userId }, { claimedById: userId }] },
        // tokenHash (claim bağlantısı) ve PSP referansı dışarıda.
        select: {
          id: true,
          bookingId: true,
          sellerId: true,
          status: true,
          askPriceMinor: true,
          currency: true,
          expiresAt: true,
          listedAt: true,
          claimedAt: true,
          completedAt: true,
          cancelledAt: true,
          failedAt: true,
          failureCode: true,
        },
      })
      .then((rows) =>
        rows.map(({ sellerId, ...t }) => ({
          ...t,
          role: sellerId === userId ? "SELLER" : "BUYER",
        }))
      ),
    wallet: {
      credits: await prisma.walletCredit.findMany({
        where: { userId },
        select: {
          id: true,
          currency: true,
          source: true,
          sourceRef: true,
          amountMinor: true,
          remainingMinor: true,
          expiredMinor: true,
          expiresAt: true,
          bookingId: true,
          createdAt: true,
        },
      }),
      spends: await prisma.creditSpend.findMany({
        where: { userId },
        select: {
          id: true,
          bookingId: true,
          currency: true,
          amountMinor: true,
          taxMinor: true,
          refundedMinor: true,
          status: true,
          releaseReason: true,
          createdAt: true,
          settledAt: true,
          releasedAt: true,
          allocations: { select: { creditId: true, amountMinor: true, refundedMinor: true } },
        },
      }),
    },
    loyalty: {
      account: await prisma.loyaltyAccount.findUnique({
        where: { userId },
        select: { completedStays: true, tier: true, createdAt: true, updatedAt: true },
      }),
      cashbacks: await prisma.loyaltyCashback.findMany({
        where: { userId },
        select: {
          id: true,
          bookingId: true,
          currency: true,
          tier: true,
          bps: true,
          amountMinor: true,
          status: true,
          dueAt: true,
          issuedAt: true,
          creditId: true,
          reason: true,
          createdAt: true,
        },
      }),
    },
    carts: await prisma.cart.findMany({
      where: { userId },
      select: {
        id: true,
        status: true,
        currency: true,
        checkedOutAt: true,
        expiredAt: true,
        cancelledAt: true,
        createdAt: true,
        bookings: { select: { id: true } },
      },
    }),
    // Gizli materyal (public key, sayaç, uç nokta anahtarları, sağlayıcı ref'i) dışarıda.
    passkeys: await prisma.webAuthnCredential.findMany({
      where: { userId },
      select: { id: true, name: true, transports: true, createdAt: true, lastUsedAt: true },
    }),
    sessions: await prisma.userSession.findMany({
      where: { userId },
      select: {
        id: true,
        userAgent: true,
        ipHint: true,
        createdAt: true,
        lastSeenAt: true,
        revokedAt: true,
      },
    }),
    pushSubscriptions: await prisma.pushSubscription.findMany({
      where: { userId },
      select: { id: true, locale: true, userAgent: true, createdAt: true, lastSuccessAt: true },
    }),
    // Bölünmüş ödeme payları: davet nonce'u ve PSP referansı dışarıda.
    paymentShares: await prisma.paymentShare.findMany({
      where: { payerUserId: userId },
      orderBy: { createdAt: "desc" },
      take: maxRows,
      select: {
        id: true,
        cartId: true,
        isOrganizer: true,
        isFallback: true,
        amountMinor: true,
        currency: true,
        status: true,
        refundedAmountMinor: true,
        authorizedAt: true,
        capturedAt: true,
        refundedAt: true,
        createdAt: true,
      },
    }),
    identityVerifications: await prisma.identityVerification.findMany({
      where: { userId },
      select: { id: true, provider: true, status: true, verifiedAt: true, createdAt: true },
    }),
  };
}

/**
 * Kullanıcının gönderdiği ve misafir ya da ev sahibi olarak taraf olduğu konuşmalardaki
 * mesajlar. Karşı tarafın kimliği yerine yalnız rolü ve `fromMe` verilir.
 */
async function exportMessages(userId: string) {
  const rows = await prisma.message.findMany({
    where: {
      OR: [
        { senderId: userId },
        { thread: { booking: { userId } } },
        { thread: { booking: { property: { hostId: userId } } } },
      ],
    },
    select: {
      id: true,
      threadId: true,
      thread: { select: { bookingId: true } },
      senderId: true,
      senderRole: true,
      body: true,
      maskedKinds: true,
      fromAiDraft: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(({ thread, senderId, ...m }) => ({
    ...m,
    bookingId: thread.bookingId,
    fromMe: senderId === userId,
  }));
}

/** Açtığı ya da yanıtlayan olduğu talepler; mesaj ve kanıtlarda karşı taraf kimliği yok. */
async function exportClaims(userId: string) {
  const rows = await prisma.claim.findMany({
    where: { OR: [{ openedById: userId }, { respondentId: userId }] },
    select: {
      id: true,
      bookingId: true,
      type: true,
      openedById: true,
      amountRequestedMinor: true,
      currency: true,
      description: true,
      status: true,
      slaDueAt: true,
      respondedAt: true,
      escalatedAt: true,
      awardedMinor: true,
      settledMinor: true,
      decisionNote: true,
      decidedAt: true,
      createdAt: true,
      messages: {
        select: { id: true, authorId: true, role: true, body: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      },
      evidence: {
        select: {
          id: true,
          uploaderId: true,
          contentType: true,
          byteSize: true,
          sha256: true,
          createdAt: true,
        },
      },
    },
  });
  return rows.map(({ openedById, messages, evidence, ...c }) => ({
    ...c,
    role: openedById === userId ? "OPENER" : "RESPONDENT",
    messages: messages.map(({ authorId, ...m }) => ({ ...m, fromMe: authorId === userId })),
    evidence: evidence.map(({ uploaderId, ...e }) => ({ ...e, fromMe: uploaderId === userId })),
  }));
}

export interface DeleteAccountResult {
  cancelledBookings: string[];
  cancelledTransfers: string[];
}

const OPEN_CLAIM_STATUSES = [
  ClaimStatus.OPEN,
  ClaimStatus.AWAITING_RESPONSE,
  ClaimStatus.ESCALATED,
] as const;

/**
 * Silmeyi engelleyen yükümlülükler (v5#9): ev sahibi olarak aldığı gelecekteki CONFIRMED
 * rezervasyonlar, bekleyen (PENDING) payout'lar ve taraf olduğu açık talepler (claim).
 */
async function accountObligations(userId: string, now: Date) {
  const [hostedBookings, pendingPayouts, pendingTransferPayouts, openClaims] = await Promise.all([
    prisma.booking.count({
      where: {
        property: { hostId: userId },
        status: BookingStatus.CONFIRMED,
        checkOut: { gt: now },
      },
    }),
    prisma.hostPayout.count({ where: { userId, status: PayoutStatus.PENDING } }),
    prisma.payout.count({ where: { userId, status: PayoutStatus.PENDING } }),
    prisma.claim.count({
      where: {
        status: { in: [...OPEN_CLAIM_STATUSES] },
        OR: [{ openedById: userId }, { respondentId: userId }],
      },
    }),
  ]);
  return {
    hostedBookings,
    pendingPayouts: pendingPayouts + pendingTransferPayouts,
    openClaims,
  };
}

/**
 * Hesap silme (v3#5, v5#9):
 *  0. Yükümlülük varsa (ev sahibi olarak gelecek CONFIRMED rezervasyon, bekleyen payout, açık
 *     talep) 409 `ACCOUNT_HAS_OBLIGATIONS` — hiçbir şey değişmez.
 *  1. Gelecekteki aktif rezervasyonlar (HELD/CONFIRMED) rezervasyon anındaki iptal
 *     politikasına göre iptal edilir (iade `cancelAndRefund` ile). Biri düşerse silme DURUR
 *     (409; yarım silme yok — hesap anonimleşmez, kullanıcı tekrar deneyebilir).
 *  2. Açık devir ilanları geri çekilir (aynı kural).
 *  3. İlanlar pasife alınır; kişisel alanlar pseudonimleştirilir, passkey'ler, tek kullanımlık
 *     token'lar, push abonelikleri ve oturum kayıtları silinir.
 *  4. `tokenVersion` artırılır → TÜM cihazlardaki erişim/yenileme token'ları geçersiz.
 */
export async function deleteAccount(
  userId: string,
  now = new Date()
): Promise<DeleteAccountResult> {
  const obligations = await accountObligations(userId, now);
  if (Object.values(obligations).some((n) => n > 0)) {
    throw new ConflictError(
      "Hesap silinemiyor: devam eden ev sahibi rezervasyonları, bekleyen ödemeler veya açık talepler var",
      "ACCOUNT_HAS_OBLIGATIONS",
      obligations
    );
  }
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
      // v5#9: silme durur — misafir kimsesiz bir rezervasyonla kalmasın.
      logger.error({ bookingId: b.id, ...errorFields(error) }, "account deletion: cancel failed");
      throw new ConflictError(
        "Hesap silinemiyor: bir rezervasyon iptal edilemedi, lütfen tekrar deneyin",
        "ACCOUNT_HAS_OBLIGATIONS",
        { failedBookingId: b.id, cancelledBookings }
      );
    }
  }
  const listings = await prisma.bookingTransfer.findMany({
    where: { sellerId: userId, status: TransferStatus.LISTED },
    select: { id: true },
  });
  const cancelledTransfers: string[] = [];
  for (const t of listings) {
    try {
      await cancelTransferListing(t.id, userId);
      cancelledTransfers.push(t.id);
    } catch (error) {
      logger.error({ transferId: t.id, ...errorFields(error) }, "transfer cancel failed");
      throw new ConflictError(
        "Hesap silinemiyor: bir devir ilanı geri çekilemedi, lütfen tekrar deneyin",
        "ACCOUNT_HAS_OBLIGATIONS",
        { failedTransferId: t.id, cancelledBookings, cancelledTransfers }
      );
    }
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
    // v5#9: ilanlar yeni rezervasyon almaz; push ve oturum meta verisi kalmaz.
    await tx.property.updateMany({ where: { hostId: userId }, data: { isActive: false } });
    await tx.pushSubscription.deleteMany({ where: { userId } });
    await tx.userSession.deleteMany({ where: { userId } });
    // v5 P1-4: destek kuyruğu özetleri hesapla birlikte silinir.
    await tx.supportTicket.deleteMany({ where: { userId } });
    await tx.notification.updateMany({
      where: { userId },
      data: { to: `${pseudo}@anon.invalid`, text: "", html: "" },
    });
    return bumpTokenVersion(userId, tx);
  });
  await publishTokenVersion(userId, version);
  return { cancelledBookings, cancelledTransfers };
}
