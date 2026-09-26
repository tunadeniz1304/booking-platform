import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { PaymentProvider } from "./provider";

/**
 * fix-sweep-2 — hasar depozitosu için kayıtlı kart (Stripe): depozito gereken rezervasyonun
 * ödemesi kullanıcının PSP müşterisine bağlanır ve `setup_future_usage=off_session` ile kart
 * kaydedilir; depozito ön provizyonu (P1-5 `authorizeHold`) sonra aynı müşteri + ödeme
 * yöntemiyle off-session alınır. Sağlayıcı müşteri desteklemiyorsa (MockPsp) hiçbir şey
 * eklenmez — mock depozito akışı değişmez.
 */

export interface OffSessionSetup {
  customerRef?: string;
  setupFutureUsage?: "off_session";
}

/** Kalemlerden biri için (oda tipi ya da ilan geneli) pozitif depozito ayarı var mı. */
export async function depositRequiredFor(
  items: ReadonlyArray<{ propertyId: string; roomTypeId: string }>
): Promise<boolean> {
  if (items.length === 0) return false;
  const found = await prisma.damageDepositSetting.findFirst({
    where: {
      amountMinor: { gt: 0n },
      OR: items.map((i) => ({
        propertyId: i.propertyId,
        OR: [{ roomTypeId: i.roomTypeId }, { roomTypeId: null }],
      })),
    },
    select: { id: true },
  });
  return found !== null;
}

/** Kullanıcının bu sağlayıcıdaki müşteri kaydı; yoksa PSP'de açılır ve saklanır. */
export async function ensurePspCustomer(
  provider: PaymentProvider,
  userId: string
): Promise<string | null> {
  if (!provider.createCustomer) return null;
  const existing = await prisma.paymentCustomer.findUnique({
    where: { userId_provider: { userId, provider: provider.name } },
    select: { customerRef: true },
  });
  if (existing) return existing.customerRef;
  // Anahtar kullanıcıya bağlı → eşzamanlı iki ödeme PSP'de tek müşteri açar.
  const { customerRef } = await provider.createCustomer({
    userId,
    idempotencyKey: `customer:${provider.name}:${userId}`,
  });
  try {
    await prisma.paymentCustomer.create({
      data: { userId, provider: provider.name, customerRef },
    });
    return customerRef;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const row = await prisma.paymentCustomer.findUnique({
        where: { userId_provider: { userId, provider: provider.name } },
        select: { customerRef: true },
      });
      if (row) return row.customerRef;
    }
    throw error;
  }
}

/** Depozito gerekiyorsa ödemenin müşteri + kart kaydı parametreleri; değilse boş. */
export async function offSessionSetupFor(
  provider: PaymentProvider,
  userId: string,
  items: ReadonlyArray<{ propertyId: string; roomTypeId: string }>
): Promise<OffSessionSetup> {
  if (!provider.createCustomer) return {};
  if (!(await depositRequiredFor(items))) return {};
  const customerRef = await ensurePspCustomer(provider, userId);
  return customerRef ? { customerRef, setupFutureUsage: "off_session" } : {};
}
