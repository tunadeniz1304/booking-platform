import { PayoutStatus } from "@prisma/client";
import { getConfig } from "@/lib/config/app-config";
import { account as ledgerAccount, getAccountBalance } from "@/lib/ledger";
import { minorFromDb } from "@/lib/money/money";
import { prisma } from "@/lib/prisma";
import { payoutBlockReason } from "./host-account";

/**
 * Ev sahibi bakiye özeti (P1-4): para birimi başına
 *  - escrowMinor: ev sahibinin rezervasyonlarında hâlâ emanette duran tutar
 *  - availableMinor: serbest bırakılmış, henüz payout'a bağlanmamış host_payable
 *  - pendingMinor: açılmış, gönderilmeyi bekleyen payout'lar
 *  - reserveMinor: rezervde tutulan (RESERVE_RELEASE_DAYS sonra açılır)
 *  - paidMinor: ödenmiş payout toplamı
 * Tutarlar JSON için number (minor-unit, güvenli tamsayı aralığı `minorFromDb` ile denetlenir).
 */
export interface HostBalanceView {
  currency: string;
  escrowMinor: number;
  availableMinor: number;
  pendingMinor: number;
  reserveMinor: number;
  paidMinor: number;
}

export interface PayoutHistoryItem {
  id: string;
  kind: "host" | "transfer";
  amountMinor: number;
  currency: string;
  status: PayoutStatus;
  reference: string | null;
  failureCode: string | null;
  createdAt: string;
  paidAt: string | null;
}

const HISTORY_LIMIT = 50;

async function hostEscrowByCurrency(hostId: string): Promise<Map<string, bigint>> {
  const rows = await prisma.$queryRaw<Array<{ currency: string; bal: bigint }>>`
    SELECT l."currency",
           SUM(CASE WHEN l."side" = 'CREDIT' THEN l."amountMinor" ELSE -l."amountMinor" END)::bigint AS bal
      FROM "JournalLine" l
      JOIN "JournalEntry" e ON e."id" = l."entryId"
      JOIN "LedgerAccount" a ON a."id" = l."accountId"
      JOIN "Booking" b ON b."id" = e."bookingId"
      JOIN "Property" p ON p."id" = b."propertyId"
     WHERE a."kind" = 'ESCROW' AND p."hostId" = ${hostId}
     GROUP BY l."currency"`;
  return new Map(rows.map((r) => [r.currency, BigInt(r.bal)]));
}

export async function getHostPayoutOverview(userId: string) {
  const [account, escrow, accounts, legacy, host] = await Promise.all([
    prisma.hostAccount.findUnique({ where: { userId } }),
    hostEscrowByCurrency(userId),
    prisma.ledgerAccount.findMany({
      where: { ownerId: userId, kind: { in: ["HOST_PAYABLE", "HOST_RESERVE"] } },
      select: { id: true },
    }),
    prisma.payout.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }),
    prisma.hostPayout.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }),
  ]);
  const lineCurrencies = accounts.length
    ? await prisma.journalLine.groupBy({
        by: ["currency"],
        where: { accountId: { in: accounts.map((a) => a.id) } },
      })
    : [];
  const currencies = new Set<string>([...escrow.keys(), ...lineCurrencies.map((c) => c.currency)]);

  const all = [
    ...legacy.map((p) => ({ ...p, kind: "transfer" as const, failureCode: null })),
    ...host.map((p) => ({ ...p, kind: "host" as const })),
  ];
  const balances: HostBalanceView[] = [];
  for (const currency of [...currencies].sort()) {
    const [payable, reserve] = await Promise.all([
      getAccountBalance(prisma, ledgerAccount.hostPayable(userId), currency),
      getAccountBalance(prisma, ledgerAccount.hostReserve(userId), currency),
    ]);
    const sumOf = (status: PayoutStatus) =>
      all
        .filter((p) => p.currency === currency && p.status === status)
        .reduce((s, p) => s + p.amountMinor, 0n);
    const pending = sumOf(PayoutStatus.PENDING);
    balances.push({
      currency,
      escrowMinor: minorFromDb(escrow.get(currency) ?? 0n),
      availableMinor: minorFromDb(payable.balanceMinor - pending),
      pendingMinor: minorFromDb(pending),
      reserveMinor: minorFromDb(reserve.balanceMinor),
      paidMinor: minorFromDb(sumOf(PayoutStatus.PAID)),
    });
  }

  const history: PayoutHistoryItem[] = all
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, HISTORY_LIMIT)
    .map((p) => ({
      id: p.id,
      kind: p.kind,
      amountMinor: minorFromDb(p.amountMinor),
      currency: p.currency,
      status: p.status,
      reference: p.reference,
      failureCode: p.failureCode,
      createdAt: p.createdAt.toISOString(),
      paidAt: p.paidAt?.toISOString() ?? null,
    }));

  const cfg = getConfig();
  return {
    account: account
      ? {
          provider: account.provider,
          connected: !!account.connectedAccountRef,
          kycStatus: account.kycStatus,
          payoutsEnabled: account.payoutsEnabled,
          payoutsPaused: account.payoutsPaused,
          pausedReason: account.pausedReason,
          payoutSchedule: account.payoutSchedule,
          reservePercentBps: account.reservePercentBps ?? cfg.PAYOUT_RESERVE_BPS,
          blockedReason: await payoutBlockReason(account),
        }
      : null,
    policy: {
      releaseHours: cfg.PAYOUT_RELEASE_HOURS,
      commissionBps: cfg.PLATFORM_COMMISSION_BPS,
      reserveReleaseDays: cfg.RESERVE_RELEASE_DAYS,
      identityRequired: cfg.PAYOUT_REQUIRE_IDENTITY_VERIFIED,
    },
    balances,
    history,
  };
}

/** Yönetici listesi: payout hesapları (durdurulanlar önce) + bekleyen payout sayısı. */
export async function listPayoutAccounts() {
  const accounts = await prisma.hostAccount.findMany({
    orderBy: [{ payoutsPaused: "desc" }, { updatedAt: "desc" }],
    take: 200,
  });
  const ids = accounts.map((a) => a.userId);
  const [users, pending] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, firstName: true, lastName: true },
    }),
    prisma.hostPayout.groupBy({
      by: ["userId"],
      where: { userId: { in: ids }, status: PayoutStatus.PENDING },
      _count: { _all: true },
    }),
  ]);
  return accounts.map((a) => {
    const u = users.find((x) => x.id === a.userId);
    return {
      userId: a.userId,
      // Veri minimizasyonu: yalnızca ad + soyadın baş harfi.
      displayName: u ? `${u.firstName} ${u.lastName.slice(0, 1)}.` : a.userId,
      provider: a.provider,
      kycStatus: a.kycStatus,
      payoutsEnabled: a.payoutsEnabled,
      payoutsPaused: a.payoutsPaused,
      pausedReason: a.pausedReason,
      pausedAt: a.pausedAt?.toISOString() ?? null,
      pendingPayouts: pending.find((p) => p.userId === a.userId)?._count._all ?? 0,
    };
  });
}
