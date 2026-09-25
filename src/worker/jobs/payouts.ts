import { createHash } from "crypto";
import type { Queue } from "bullmq";
import { PayoutStatus } from "@prisma/client";
import { getConfig } from "@/lib/config/app-config";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/observability/logger";

/**
 * Mock payout işi (#4): devir sonrası satıcıya açılan PENDING ödemeleri "gönderir".
 * Gerçek banka/PSP transferi yok (çevrimdışı); deterministik `po_mock_…` referansı yazılır.
 * Koşullu güncelleme (status=PENDING) sayesinde paralel worker'lar aynı payout'u iki kez ödemez.
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
    const done = await prisma.payout.updateMany({
      where: { id, status: PayoutStatus.PENDING },
      data: {
        status: PayoutStatus.PAID,
        reference: mockPayoutReference(id),
        paidAt: now,
        attempts: { increment: 1 },
      },
    });
    paid += done.count;
  }
  if (paid > 0) logger.info({ paid }, "mock payouts sent");
  return { paid };
}
