import { PayoutStatus, type PayoutSchedule, type Prisma } from "@prisma/client";
import { getConfig } from "@/lib/config/app-config";
import { withSerializableRetry } from "@/lib/db/transactions";
import { account as ledgerAccount, getAccountBalance, post } from "@/lib/ledger";
import { logger } from "@/lib/observability/logger";
import { counter } from "@/lib/observability/metrics";
import { prisma } from "@/lib/prisma";
import { payoutBlockReason } from "./host-account";
import { getPayoutProvider } from "./index";

/**
 * Payout motoru (P1-4, ADR 0021). Tek kural: dışarı ödeme YALNIZCA serbest bırakılmış
 * `host_payable:<userId>` bakiyesinden yapılır (escrow ve rezerv ödenmez).
 *
 * 1. Devir payout'ları (eski `Payout`, devir kesinleşince açılır): aynı sağlayıcı arayüzü,
 *    durdurma kontrolü ve bakiye koruması ile gönderilir.
 * 2. Ev sahibi payout'ları (`HostPayout`): uygun hesap + takvim vadesi → kullanılabilir
 *    bakiye (host_payable − bekleyen payout'lar) ≥ PAYOUT_MIN_MINOR ise PENDING açılır.
 * 3. PENDING ev sahibi payout'ları gönderilir; başarıda aynı tx'te PAID + `payoutReleased`
 *    (Dr host_payable / Cr psp_clearing); sağlayıcı hatasında FAILED (tutar bakiyeye döner).
 *
 * Gönderim idempotency anahtarı payout kimliğinden → yeniden deneme en fazla bir aktarım.
 */

export const payoutsTotal = counter("payouts_total", "Payout sonuçları", [
  "kind",
  "outcome",
] as const);

const BATCH_SIZE = 100;
const DAY_MS = 86_400_000;

type Db = Prisma.TransactionClient | typeof prisma;

export interface PayoutRunResult {
  /** Ödenen devir payout'u sayısı (eski `Payout`). */
  paid: number;
  hostCreated: number;
  hostPaid: number;
  hostFailed: number;
}

export interface PayoutRunOptions {
  /** Yalnızca testlerde kapsamı daraltmak için. */
  userIds?: string[];
}

/** Bekleyen (PENDING) payout toplamı — iki tablo, kullanıcı + para birimi. */
async function pendingMinor(
  db: Db,
  userId: string,
  currency: string,
  excludeHostPayoutId?: string
): Promise<bigint> {
  const [legacy, host] = await Promise.all([
    db.payout.aggregate({
      where: { userId, currency, status: PayoutStatus.PENDING },
      _sum: { amountMinor: true },
    }),
    db.hostPayout.aggregate({
      where: {
        userId,
        currency,
        status: PayoutStatus.PENDING,
        ...(excludeHostPayoutId ? { id: { not: excludeHostPayoutId } } : {}),
      },
      _sum: { amountMinor: true },
    }),
  ]);
  return (legacy._sum.amountMinor ?? 0n) + (host._sum.amountMinor ?? 0n);
}

async function payableMinor(db: Db, userId: string, currency: string): Promise<bigint> {
  return (await getAccountBalance(db, ledgerAccount.hostPayable(userId), currency)).balanceMinor;
}

/** Takvim vadesi: son ev sahibi payout'undan bu yana dönem geçti mi (UTC). */
export function scheduleDue(schedule: PayoutSchedule, last: Date | null, now: Date): boolean {
  if (!last) return true;
  if (schedule === "DAILY") return last.toISOString().slice(0, 10) < now.toISOString().slice(0, 10);
  if (schedule === "WEEKLY") return now.getTime() - last.getTime() >= 7 * DAY_MS;
  return last.toISOString().slice(0, 7) < now.toISOString().slice(0, 7);
}

export async function runPayoutEngine(
  now: Date = new Date(),
  opts: PayoutRunOptions = {}
): Promise<PayoutRunResult> {
  const paid = await sendTransferPayouts(now, opts);
  const hostCreated = await createHostPayouts(now, opts);
  const { paid: hostPaid, failed: hostFailed } = await sendHostPayouts(now, opts);
  if (paid + hostCreated + hostPaid + hostFailed > 0) {
    logger.info({ paid, hostCreated, hostPaid, hostFailed }, "payout run");
  }
  return { paid, hostCreated, hostPaid, hostFailed };
}

async function sendTransferPayouts(now: Date, opts: PayoutRunOptions): Promise<number> {
  const provider = getPayoutProvider();
  const pending = await prisma.payout.findMany({
    where: {
      status: PayoutStatus.PENDING,
      ...(opts.userIds ? { userId: { in: opts.userIds } } : {}),
    },
    orderBy: { createdAt: "asc" },
    take: BATCH_SIZE,
  });
  let paid = 0;
  for (const p of pending) {
    const account = await prisma.hostAccount.findUnique({ where: { userId: p.userId } });
    if (account?.payoutsPaused) continue;
    const destination = account?.connectedAccountRef ?? null;
    if (provider.name === "stripe" && !destination) continue;
    // Bakiye koruması: devir bedeli host_payable'a transferSettled ile girmiş olmalı.
    if ((await payableMinor(prisma, p.userId, p.currency)) < p.amountMinor) {
      logger.warn({ payoutId: p.id }, "transfer payout exceeds payable balance; skipped");
      continue;
    }
    let reference: string;
    try {
      ({ reference } = await provider.sendPayout({
        idempotencyKey: `payout:${p.id}`,
        amountMinor: p.amountMinor,
        currency: p.currency,
        destination,
        metadata: { payoutId: p.id, kind: "transfer" },
      }));
    } catch (error) {
      payoutsTotal.inc({ kind: "transfer", outcome: "error" });
      logger.error({ payoutId: p.id, err: (error as Error).message }, "transfer payout failed");
      await prisma.payout.updateMany({
        where: { id: p.id, status: PayoutStatus.PENDING },
        data: { attempts: { increment: 1 } },
      });
      continue;
    }
    const count = await withSerializableRetry(async (tx) => {
      const done = await tx.payout.updateMany({
        where: { id: p.id, status: PayoutStatus.PENDING },
        data: { status: PayoutStatus.PAID, reference, paidAt: now, attempts: { increment: 1 } },
      });
      if (done.count !== 1) return 0;
      await post.payoutReleased(tx, {
        payoutId: p.id,
        payeeId: p.userId,
        amountMinor: p.amountMinor,
        currency: p.currency,
        bookingId: p.bookingId,
        transferId: p.transferId,
        occurredAt: now,
      });
      return 1;
    });
    if (count) payoutsTotal.inc({ kind: "transfer", outcome: "paid" });
    paid += count;
  }
  return paid;
}

async function createHostPayouts(now: Date, opts: PayoutRunOptions): Promise<number> {
  const cfg = getConfig();
  const accounts = await prisma.hostAccount.findMany({
    where: {
      payoutsEnabled: true,
      payoutsPaused: false,
      ...(opts.userIds ? { userId: { in: opts.userIds } } : {}),
    },
    orderBy: { createdAt: "asc" },
    take: BATCH_SIZE * 10,
  });
  let created = 0;
  for (const acc of accounts) {
    if (await payoutBlockReason(acc)) continue;
    const last = await prisma.hostPayout.findFirst({
      where: { userId: acc.userId, status: { not: PayoutStatus.FAILED } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    if (!scheduleDue(acc.payoutSchedule, last?.createdAt ?? null, now)) continue;
    const code = `host_payable:${acc.userId}`;
    const currencies = await prisma.journalLine.groupBy({
      by: ["currency"],
      where: { account: { code } },
    });
    for (const { currency } of currencies) {
      const made = await withSerializableRetry(async (tx) => {
        const available =
          (await payableMinor(tx, acc.userId, currency)) -
          (await pendingMinor(tx, acc.userId, currency));
        if (available < BigInt(cfg.PAYOUT_MIN_MINOR)) return 0;
        await tx.hostPayout.create({
          data: {
            userId: acc.userId,
            amountMinor: available,
            currency,
            provider: acc.provider,
            createdAt: now,
          },
        });
        return 1;
      });
      created += made;
    }
  }
  return created;
}

async function sendHostPayouts(
  now: Date,
  opts: PayoutRunOptions
): Promise<{ paid: number; failed: number }> {
  const provider = getPayoutProvider();
  const pending = await prisma.hostPayout.findMany({
    where: {
      status: PayoutStatus.PENDING,
      ...(opts.userIds ? { userId: { in: opts.userIds } } : {}),
    },
    orderBy: { createdAt: "asc" },
    take: BATCH_SIZE,
  });
  let paid = 0;
  let failed = 0;
  const fail = async (id: string, code: string) => {
    const res = await prisma.hostPayout.updateMany({
      where: { id, status: PayoutStatus.PENDING },
      data: {
        status: PayoutStatus.FAILED,
        failureCode: code,
        failedAt: now,
        attempts: { increment: 1 },
      },
    });
    failed += res.count;
    payoutsTotal.inc({ kind: "host", outcome: "failed" });
  };
  for (const p of pending) {
    const account = await prisma.hostAccount.findUnique({ where: { userId: p.userId } });
    const blocked = await payoutBlockReason(account);
    // Durdurulmuş / uygunluğu düşmüş hesabın bekleyen payout'u bekler (başarısız sayılmaz).
    if (blocked) continue;
    const available =
      (await payableMinor(prisma, p.userId, p.currency)) -
      (await pendingMinor(prisma, p.userId, p.currency, p.id));
    if (available < p.amountMinor) {
      // Açılıştan sonra serbest bakiye düştü (ör. serbest bırakma sonrası iade).
      await fail(p.id, "INSUFFICIENT_BALANCE");
      continue;
    }
    let reference: string;
    try {
      ({ reference } = await provider.sendPayout({
        idempotencyKey: `host-payout:${p.id}`,
        amountMinor: p.amountMinor,
        currency: p.currency,
        destination: account?.connectedAccountRef ?? null,
        metadata: { payoutId: p.id, kind: "host" },
      }));
    } catch (error) {
      logger.error({ payoutId: p.id, err: (error as Error).message }, "host payout failed");
      await fail(p.id, (error as { code?: string }).code ?? "PROVIDER_ERROR");
      continue;
    }
    const count = await withSerializableRetry(async (tx) => {
      const done = await tx.hostPayout.updateMany({
        where: { id: p.id, status: PayoutStatus.PENDING },
        data: { status: PayoutStatus.PAID, reference, paidAt: now, attempts: { increment: 1 } },
      });
      if (done.count !== 1) return 0;
      await post.payoutReleased(tx, {
        payoutId: p.id,
        payeeId: p.userId,
        amountMinor: p.amountMinor,
        currency: p.currency,
        occurredAt: now,
      });
      return 1;
    });
    if (count) payoutsTotal.inc({ kind: "host", outcome: "paid" });
    paid += count;
  }
  return { paid, failed };
}
