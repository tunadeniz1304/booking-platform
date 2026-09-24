import { prisma } from "@/lib/prisma";
import { eventBus } from "./event-bus";
import { DomainEvent } from "./types";
import { OutboxStatus } from "@prisma/client";
import { getConfig } from "@/lib/config/app-config";
import { logger, errorFields } from "@/lib/observability/logger";
import { counter } from "@/lib/observability/metrics";

/**
 * Transactional Outbox Pattern.
 *
 *  - İş satırı ve OutboxMessage aynı DB işleminde yazılır (atomik).
 *  - `relayOutbox` mesajları `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED)
 *    RETURNING *` ile TEK sorguda kiralar: iki işçi aynı mesajı asla birlikte almaz.
 *  - PROCESSING kiralaması `lockedUntil` ile sınırlıdır; işçi çökerse süre dolunca
 *    mesaj yeniden alınır.
 *  - Hata → üstel geri çekilme; `OUTBOX_MAX_ATTEMPTS` aşılınca DEAD (sonsuz retry yok).
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

const relayed = counter("outbox_messages_total", "Outbox mesaj sonuçları", ["outcome"] as const);

export async function appendOutbox(tx: OutboxWriter, event: DomainEvent<unknown>): Promise<void> {
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

export interface ClaimedMessage {
  id: string;
  eventType: string;
  aggregateId: string;
  aggregateType: string;
  payload: unknown;
  correlationId: string | null;
  attempts: number;
}

/** Hazır (veya kiralaması dolmuş) mesajları atomik olarak kiralar. */
export async function claimBatch(
  batchSize: number,
  now: Date = new Date()
): Promise<ClaimedMessage[]> {
  const leaseUntil = new Date(now.getTime() + getConfig().OUTBOX_LEASE_SECONDS * 1000);
  return prisma.$queryRaw<ClaimedMessage[]>`
    UPDATE "OutboxMessage"
    SET status = 'PROCESSING', "lockedUntil" = ${leaseUntil}, attempts = attempts + 1
    WHERE id IN (
      SELECT id FROM "OutboxMessage"
      WHERE (status IN ('PENDING', 'FAILED') AND "availableAfter" <= ${now})
         OR (status = 'PROCESSING' AND "lockedUntil" < ${now})
      ORDER BY "createdAt"
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, "eventType", "aggregateId", "aggregateType", payload, "correlationId", attempts
  `;
}

/** Bekleyen outbox mesajlarını yayınlar; başarıyla yayınlanan sayıyı döndürür. */
export async function relayOutbox(batchSize = 100): Promise<number> {
  const { OUTBOX_MAX_ATTEMPTS, OUTBOX_BACKOFF_BASE_MS } = getConfig();
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
        data: { status: OutboxStatus.DONE, processedAt: new Date(), lockedUntil: null },
      });
      published += 1;
      relayed.inc({ outcome: "done" });
    } catch (error) {
      const dead = row.attempts >= OUTBOX_MAX_ATTEMPTS;
      await prisma.outboxMessage.update({
        where: { id: row.id },
        data: {
          status: dead ? OutboxStatus.DEAD : OutboxStatus.PENDING,
          lockedUntil: null,
          availableAfter: new Date(Date.now() + OUTBOX_BACKOFF_BASE_MS * 2 ** (row.attempts - 1)),
          lastError: ((error as Error)?.message ?? String(error)).slice(0, 500),
        },
      });
      relayed.inc({ outcome: dead ? "dead" : "retry" });
      logger.error(
        { eventType: row.eventType, attempts: row.attempts, dead, ...errorFields(error) },
        "outbox relay failed"
      );
    }
  }
  return published;
}

/** DEAD mesajı yeniden kuyruğa alır (admin paneli). */
export async function requeueDeadMessage(id: string): Promise<boolean> {
  const res = await prisma.outboxMessage.updateMany({
    where: { id, status: OutboxStatus.DEAD },
    data: {
      status: OutboxStatus.PENDING,
      attempts: 0,
      availableAfter: new Date(),
      lastError: null,
    },
  });
  return res.count === 1;
}

/** Periyodik denetçi (worker) için tek çağrı. */
export async function runOutboxRelay(batchSize = 100): Promise<number> {
  return relayOutbox(batchSize);
}
