import type { HostAccount, HostKycStatus, PayoutSchedule } from "@prisma/client";
import { audit } from "@/lib/admin/audit";
import { getConfig } from "@/lib/config/app-config";
import { NotFoundError } from "@/lib/http/errors";
import { prisma } from "@/lib/prisma";
import { isIdentityVerified } from "@/lib/trust/kyc";
import { getPayoutProvider } from "./index";

/**
 * Ev sahibi ödeme hesabı (P1-4). İki ayrı doğrulama:
 *  - `kycStatus` / `payoutsEnabled`: payout SAĞLAYICISININ bağlı hesap durumu (Stripe Connect
 *    onboarding). Mock sağlayıcının kendi KYC'si yok → P1-6 `IdentityVerification`'dan türetilir.
 *  - `PAYOUT_REQUIRE_IDENTITY_VERIFIED` (varsayılan kapalı): açıkken payout için ayrıca P1-6
 *    kimlik doğrulaması şart (`isIdentityVerified`).
 */

/** P1-6 kimlik doğrulama durumundan hesap KYC durumu (mock sağlayıcı için). */
export async function identityKycStatus(userId: string): Promise<HostKycStatus> {
  const latest = await prisma.identityVerification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { status: true },
  });
  if (latest.some((v) => v.status === "VERIFIED")) return "VERIFIED";
  const last = latest[0]?.status;
  if (!last) return "NOT_STARTED";
  return last === "FAILED" ? "REJECTED" : "PENDING";
}

/** Payout açılabilir mi: sağlayıcı izni + durdurulmamış + (istenirse) kimlik doğrulaması. */
export async function payoutBlockReason(
  account: Pick<HostAccount, "userId" | "payoutsEnabled" | "payoutsPaused"> | null
): Promise<"NO_ACCOUNT" | "PAUSED" | "PROVIDER_DISABLED" | "IDENTITY_UNVERIFIED" | null> {
  if (!account) return "NO_ACCOUNT";
  if (account.payoutsPaused) return "PAUSED";
  if (!account.payoutsEnabled) return "PROVIDER_DISABLED";
  if (getConfig().PAYOUT_REQUIRE_IDENTITY_VERIFIED && !(await isIdentityVerified(account.userId)))
    return "IDENTITY_UNVERIFIED";
  return null;
}

/**
 * Bağlı hesabı açar ya da durumunu tazeler (idempotent). Takvim verilirse güncellenir.
 * Mock: hesap anında etkin; KYC durumu P1-6'dan. Stripe: durum Connect hesabından.
 */
export async function onboardHostAccount(
  userId: string,
  opts: { schedule?: PayoutSchedule; country?: string } = {}
): Promise<HostAccount> {
  const provider = getPayoutProvider();
  const existing = await prisma.hostAccount.findUnique({ where: { userId } });
  let accountRef = existing?.connectedAccountRef ?? null;
  let status: { kycStatus: HostKycStatus; payoutsEnabled: boolean };
  if (accountRef && existing?.provider === provider.name) {
    status = await provider.getAccountStatus(accountRef);
  } else {
    const created = await provider.createConnectedAccount({ userId, country: opts.country });
    accountRef = created.accountRef;
    status = created;
  }
  if (provider.name === "mock") status = { ...status, kycStatus: await identityKycStatus(userId) };
  const data = {
    provider: provider.name,
    connectedAccountRef: accountRef,
    kycStatus: status.kycStatus,
    payoutsEnabled: status.payoutsEnabled,
    ...(opts.schedule ? { payoutSchedule: opts.schedule } : {}),
  };
  return prisma.hostAccount.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
}

/**
 * Yönetici: kullanıcının payout'larını durdurur / devam ettirir (denetim kaydı yazılır).
 * Hesabı olmayan kullanıcı (ör. devir satıcısı) için durdurma kaydı açılır.
 */
export async function setPayoutsPaused(
  adminId: string,
  userId: string,
  paused: boolean,
  reason?: string
): Promise<HostAccount> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) throw new NotFoundError("Kullanıcı bulunamadı");
  const now = new Date();
  const data = paused
    ? { payoutsPaused: true, pausedReason: reason ?? null, pausedAt: now, pausedById: adminId }
    : { payoutsPaused: false, pausedReason: null, pausedAt: null, pausedById: null };
  const account = await prisma.hostAccount.upsert({
    where: { userId },
    create: { userId, provider: getPayoutProvider().name, ...data },
    update: data,
  });
  await audit(adminId, paused ? "payout.paused" : "payout.resumed", "HostAccount", account.id, {
    userId,
    reason: reason ?? null,
  });
  return account;
}
