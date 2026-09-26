import { createHash } from "crypto";
import type { Queue } from "bullmq";
import { PayoutStatus } from "@prisma/client";
import { getConfig } from "@/lib/config/app-config";
import { prisma } from "@/lib/prisma";
import { withSerializableRetry } from "@/lib/db/transactions";
import { post } from "@/lib/ledger";
import { logger } from "@/lib/observability/logger";

/**
 * Mock payout işi (#4): devir sonrası satıcıya açılan PENDING ödemeleri "gönderir".
 * Gerçek banka/PSP transferi yok (çevrimdışı); deterministik `po_mock_…` referansı yazılır.
 * Koşullu güncelleme (status=PENDING) sayesinde paralel worker'lar aynı payout'u iki kez ödemez.
 * Aynı işlemde `payoutReleased` jurnali (Dr host_payable(alıcı) / Cr psp_clearing) yazılır.
 */
export const PAYOUT_JOB = "payouts";

/** Tek çalıştırmada işlenecek en fazla payout (uzun işleri önler). */
const PAYOUT_BATCH_SIZE = 100;
const PAYOUT_REF_HEX_LENGTH = 24;

function mockPayoutReference(payoutId: string): string {
  const digest = createHash("sha256").update(`payout:${payoutId}`).digest("hex");
  return `po_mock_${digest.slice(0, PAYOUT_REF_HEX_LENGTH)}`;
}

/** İdempotent scheduler; desen `PAYOUT_CRON`, UTC. */
export async function schedulePayouts(queue: Queue): Promise<void> {
  await queue.upsertJobScheduler(
    PAYOUT_JOB,
    { pattern: getConfig().PAYOUT_CRON, tz: "UTC" },
    { name: PAYOUT_JOB, data: {}, opts: { removeOnComplete: true, removeOnFail: 100 } }
  );
}

export async function runPayouts(now = new Date()): Promise<{ paid: number }> {
  const pending = await prisma.payout.findMany({
    where: { status: PayoutStatus.PENDING },
    orderBy: { createdAt: "asc" },
    take: PAYOUT_BATCH_SIZE,
    select: { id: true },
  });
  let paid = 0;
  for (const { id } of pending) {
    const count = await withSerializableRetry(async (tx) => {
      const done = await tx.payout.updateMany({
        where: { id, status: PayoutStatus.PENDING },
        data: {
          status: PayoutStatus.PAID,
          reference: mockPayoutReference(id),
          paidAt: now,
          attempts: { increment: 1 },
        },
      });
      if (done.count !== 1) return 0;
      const payout = await tx.payout.findUniqueOrThrow({
        where: { id },
        select: {
          userId: true,
          bookingId: true,
          transferId: true,
          amountMinor: true,
          currency: true,
        },
      });
      if (payout.amountMinor > 0n) {
        await post.payoutReleased(tx, {
          payoutId: id,
          payeeId: payout.userId,
          amountMinor: payout.amountMinor,
          currency: payout.currency,
          bookingId: payout.bookingId,
          transferId: payout.transferId,
          occurredAt: now,
        });
      }
      return 1;
    });
    paid += count;
  }
  if (paid > 0) logger.info({ paid }, "mock payouts sent");
  return { paid };
}
