import { prisma } from "@/lib/prisma";
import { eventBus } from "./event-bus";
import { DomainEvent } from "./types";
import { OutboxStatus } from "@prisma/client";

/**
 * Transactional Outbox Pattern.
 *
 * Domain değişikliği ile olayın yayınlanmasını atomik yapan desen:
 *  - İş (business) satırı ve OutboxMessage aynı DB işlemi içinde yazılır.
 *  - `relayOutbox` hazır mesajları çeker, eventBus üzerinden yayınlar, DONE işaretler.
 *  - Başarısız mesajlar üstel geri-çekme (backoff) ile yeniden denenir.
 *
 * Garanti: at-least-once yayın. Tüketiciler idempotent olmalıdır.
 */

export interface OutboxWriter {
  outboxMessage: {
    create(args: {
      data: {
        eventType: string;
        aggregateId: string;
        aggregateType: string;
        payload: unknown;
        correlationId?: string | null;
      };
    }): Promise<unknown>;
  };
}

const MAX_ATTEMPTS = 8;
const BACKOFF_BASE_MS = 1000;

/**
 * Aynı işlem (tx) içinde mesajı kuyruğa ekler. TransactionClient veya prisma
 * singleton geçilebilir; her ikisinde de `.outboxMessage.create` bulunur.
 */
export async function appendOutbox(
  tx: OutboxWriter,
  event: DomainEvent<unknown>
): Promise<void> {
  await tx.outboxMessage.create({
    data: {
      eventType: event.type,
      aggregateId: event.aggregateId,
      aggregateType: event.aggregateType,
      payload: event.payload as unknown,
      correlationId: event.correlationId ?? null,
    },
  });
}

/** Hazır mesajları atomik şekilde işleme-leases'i olarak talep eder. */
async function claimBatch(batchSize: number): Promise<
  Array<{
    id: string;
    eventType: string;
    aggregateId: string;
    aggregateType: string;
    payload: unknown;
    correlationId: string | null;
    attempts: number;
  }>
> {
  const now = new Date();
  const candidates = await prisma.outboxMessage.findMany({
    where: {
      status: { in: [OutboxStatus.PENDING, OutboxStatus.FAILED] },
      availableAfter: { lte: now },
    },
    orderBy: { createdAt: "asc" },
    take: batchSize,
    select: { id: true },
  });
  if (candidates.length === 0) return [];

  const ids = candidates.map((c) => c.id);
  // Yalnızca bu geçişte hâlâ PENDING/FAILED olanları devralırız → yarışta
  // yalnız bir denetçi (worker) aynı mesajı işler.
  const updated = await prisma.outboxMessage.updateMany({
    where: { id: { in: ids }, status: { in: [OutboxStatus.PENDING, OutboxStatus.FAILED] } },
    data: { status: OutboxStatus.PROCESSING, attempts: { increment: 1 } },
  });
  if (updated.count === 0) return [];

  return prisma.outboxMessage.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      eventType: true,
      aggregateId: true,
      aggregateType: true,
      payload: true,
      correlationId: true,
      attempts: true,
    },
  });
}

/** Bekleyen outbox mesajlarını yayınlar; işlenen sayıyı döndürür. */
export async function relayOutbox(batchSize = 100): Promise<number> {
  const rows = await claimBatch(batchSize);
  let published = 0;

  for (const row of rows) {
    const event: DomainEvent = {
      type: row.eventType,
      payload: row.payload as never,
      aggregateId: row.aggregateId,
      aggregateType: row.aggregateType,
      correlationId: row.correlationId ?? undefined,
    };

    try {
      await eventBus.publish(event);
      await prisma.outboxMessage.update({
        where: { id: row.id },
        data: { status: OutboxStatus.DONE, processedAt: new Date() },
      });
      published += 1;
    } catch (error) {
      const attempts = row.attempts;
      const failed = attempts >= MAX_ATTEMPTS;
      await prisma.outboxMessage.update({
        where: { id: row.id },
        data: {
          status: failed ? OutboxStatus.FAILED : OutboxStatus.PENDING,
          availableAfter: failed
            ? new Date()
            : new Date(Date.now() + BACKOFF_BASE_MS * 2 ** (attempts - 1)),
          lastError: (error as Error)?.message ?? String(error),
        },
      });
      console.error(
        `Outbox relay failed for ${row.eventType} (attempt ${attempts}):`,
        error
      );
    }
  }

  return published;
}

/** Periyodik denetçi (cron / setInterval) için tek çağrı. */
export async function runOutboxRelay(batchSize = 100): Promise<number> {
  return relayOutbox(batchSize);
}
