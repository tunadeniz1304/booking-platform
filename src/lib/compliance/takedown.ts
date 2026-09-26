import { Prisma, type TakedownRequest } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getConfig } from "@/lib/config/app-config";
import { withSerializableRetry } from "@/lib/db/transactions";
import { ConflictError, NotFoundError } from "@/lib/http/errors";
import { getQueue, QUEUE_NAMES } from "@/lib/queue";
import { counter } from "@/lib/observability/metrics";
import { logger, errorFields } from "@/lib/observability/logger";
import { invalidatePropertySearchCache } from "@/lib/search";

/**
 * P1-13a — 7565 s. Kanun kaldırma talepleri.
 *
 * Yetkili makamdan (Kültür ve Turizm Bakanlığı / mahkeme) gelen uyarı yönetici tarafından
 * kaydedilir; ilan AYNI işlemde pasife alınır ve denetim kaydı yazılır. SLA bitişi
 * `receivedAt + TAKEDOWN_SLA_HOURS` (varsayılan 24 saat). Bitişte BullMQ gecikmeli işi
 * (`takedown-sla-check`) talebi kontrol eder: ilan hâlâ yayındaysa ya da talep işlenmemişse
 * SLA AŞIMI → `takedown_sla_breach_total` metriği + `error` seviyesinde alarm logu, ilan
 * yeniden pasife alınır. Gecikmeli iş kaybolursa cron süpürücü aynı kontrolü yapar.
 *
 * Açık (CLOSED olmayan) talebi olan ilan ev sahibi tarafından yeniden yayına alınamaz.
 */

export const TAKEDOWN_SLA_CHECK_JOB = "takedown-sla-check";
export const TAKEDOWN_SLA_SWEEP_JOB = "takedown-sla-sweep";
const SYSTEM_ACTOR = "system:takedown-sla";

export const takedownSlaBreachTotal = counter(
  "takedown_sla_breach_total",
  "7565 kaldırma taleplerinde SLA (varsayılan 24 saat) aşımı",
  ["source"] as const
);
export const takedownReceivedTotal = counter(
  "takedown_received_total",
  "Kaydedilen 7565 kaldırma talepleri",
  ["source"] as const
);

export const takedownInputSchema = z.object({
  source: z.enum(["MINISTRY_7565", "COURT_ORDER", "OTHER_AUTHORITY"]).default("MINISTRY_7565"),
  referenceNo: z.string().trim().min(1).max(120).optional(),
  propertyId: z.string().trim().min(1).max(64),
  reason: z.string().trim().min(3).max(2000),
  /** Yazının alındığı an (verilmezse şimdi). SLA bu andan sayılır. */
  receivedAt: z.coerce.date().optional(),
});
export type TakedownInput = z.infer<typeof takedownInputSchema>;

export function slaDueAt(receivedAt: Date, hours = getConfig().TAKEDOWN_SLA_HOURS): Date {
  return new Date(receivedAt.getTime() + hours * 3_600_000);
}

/** Talebi kaydeder, ilanı pasife alır (tek SERIALIZABLE işlem) ve SLA işini planlar. */
export async function receiveTakedown(
  input: TakedownInput,
  actorId: string,
  now = new Date()
): Promise<TakedownRequest> {
  const receivedAt = input.receivedAt ?? now;
  const request = await withSerializableRetry(async (tx) => {
    const property = await tx.property.findUnique({
      where: { id: input.propertyId },
      select: { id: true, isActive: true },
    });
    if (!property) throw new NotFoundError("İlan bulunamadı");
    await tx.property.update({ where: { id: property.id }, data: { isActive: false } });
    const row = await tx.takedownRequest.create({
      data: {
        source: input.source,
        referenceNo: input.referenceNo,
        propertyId: property.id,
        reason: input.reason,
        receivedAt,
        slaDueAt: slaDueAt(receivedAt),
        status: "ACTIONED",
        actionedAt: now,
        createdById: actorId,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId,
        action: "takedown.received",
        entity: "Property",
        entityId: property.id,
        meta: {
          takedownId: row.id,
          source: row.source,
          referenceNo: row.referenceNo,
          wasActive: property.isActive,
          slaDueAt: row.slaDueAt.toISOString(),
        } satisfies Prisma.InputJsonValue,
      },
    });
    return row;
  });
  takedownReceivedTotal.inc({ source: request.source });
  await invalidatePropertySearchCache(request.propertyId).catch(() => undefined);
  await scheduleTakedownSlaCheck(request, now);
  return request;
}

/** SLA bitişinde çalışacak gecikmeli iş (talep başına tek iş). Kuyruk yoksa süpürücü yakalar. */
export async function scheduleTakedownSlaCheck(
  request: Pick<TakedownRequest, "id" | "slaDueAt">,
  now = new Date()
): Promise<void> {
  try {
    await getQueue(QUEUE_NAMES.compliance).add(
      TAKEDOWN_SLA_CHECK_JOB,
      { takedownId: request.id },
      {
        jobId: `takedown-sla-${request.id}`,
        delay: Math.max(0, request.slaDueAt.getTime() - now.getTime()),
        attempts: 5,
        backoff: { type: "exponential", delay: 10_000 },
        removeOnComplete: true,
        removeOnFail: 1000,
      }
    );
  } catch (error) {
    logger.warn(
      { takedownId: request.id, ...errorFields(error) },
      "takedown SLA job could not be scheduled; sweep will check it"
    );
  }
}

export type SlaCheckOutcome = "ok" | "breached" | "not_due" | "already_checked" | "closed";

/**
 * SLA kontrolü (gecikmeli iş + süpürücü). Bitişte ilan hâlâ yayındaysa veya talep hiç
 * işlenmediyse aşım: metrik + alarm + ilanın zorla pasife alınması (eskalasyon).
 */
export async function checkTakedownSla(
  takedownId: string,
  now = new Date()
): Promise<SlaCheckOutcome> {
  const request = await prisma.takedownRequest.findUnique({ where: { id: takedownId } });
  if (!request) throw new NotFoundError("Kaldırma talebi bulunamadı");
  if (request.slaCheckedAt) return "already_checked";
  if (request.status === "CLOSED") return "closed";
  if (request.slaDueAt.getTime() > now.getTime()) return "not_due";

  const property = await prisma.property.findUnique({
    where: { id: request.propertyId },
    select: { isActive: true },
  });
  const breached =
    request.status !== "ACTIONED" ||
    !request.actionedAt ||
    request.actionedAt.getTime() > request.slaDueAt.getTime() ||
    property?.isActive === true;

  // Koşullu güncelleme: gecikmeli iş ile süpürücü yarışırsa yalnız biri sayar.
  const claimed = await prisma.takedownRequest.updateMany({
    where: { id: request.id, slaCheckedAt: null },
    data: {
      slaCheckedAt: now,
      ...(breached ? { slaBreachedAt: now } : {}),
    },
  });
  if (claimed.count === 0) return "already_checked";
  if (!breached) return "ok";

  takedownSlaBreachTotal.inc({ source: request.source });
  logger.error(
    {
      alert: "TAKEDOWN_SLA_BREACH",
      takedownId: request.id,
      propertyId: request.propertyId,
      source: request.source,
      referenceNo: request.referenceNo,
      slaDueAt: request.slaDueAt.toISOString(),
      listingActive: property?.isActive ?? null,
      status: request.status,
    },
    "ALERT: 7565 takedown SLA breached; listing forced offline, escalate to compliance officer"
  );
  // Eskalasyon: ilanı zorla pasife al, talebi ACTIONED işaretle, denetim kaydı yaz.
  await prisma.$transaction([
    prisma.property.updateMany({
      where: { id: request.propertyId },
      data: { isActive: false },
    }),
    prisma.takedownRequest.update({
      where: { id: request.id },
      data: { status: "ACTIONED", actionedAt: request.actionedAt ?? now },
    }),
    prisma.auditLog.create({
      data: {
        actorId: SYSTEM_ACTOR,
        action: "takedown.sla_breach",
        entity: "Property",
        entityId: request.propertyId,
        meta: { takedownId: request.id, slaDueAt: request.slaDueAt.toISOString() },
      },
    }),
  ]);
  await invalidatePropertySearchCache(request.propertyId).catch(() => undefined);
  return "breached";
}

/** Süresi dolmuş, kontrol edilmemiş talepler (gecikmeli iş kaybolduysa yedek). */
export async function sweepTakedownSla(now = new Date()): Promise<Record<SlaCheckOutcome, number>> {
  const due = await prisma.takedownRequest.findMany({
    where: { slaCheckedAt: null, status: { not: "CLOSED" }, slaDueAt: { lte: now } },
    select: { id: true },
    orderBy: { slaDueAt: "asc" },
    take: 200,
  });
  const counts: Record<SlaCheckOutcome, number> = {
    ok: 0,
    breached: 0,
    not_due: 0,
    already_checked: 0,
    closed: 0,
  };
  for (const { id } of due) counts[await checkTakedownSla(id, now)]++;
  return counts;
}

/** Açık kaldırma talebi olan ilan yeniden yayına alınamaz. */
export async function assertNoOpenTakedown(propertyId: string): Promise<void> {
  const open = await prisma.takedownRequest.count({
    where: { propertyId, status: { not: "CLOSED" } },
  });
  if (open > 0) {
    throw new ConflictError(
      "İlan için açık bir yasal kaldırma talebi var; yeniden yayına alınamaz",
      "TAKEDOWN_ACTIVE"
    );
  }
}

export const closeTakedownSchema = z.object({
  resolution: z.string().trim().min(3).max(2000),
});

/** Yönetici talebi kapatır (ör. makam talebi geri çekti). İlan otomatik açılmaz. */
export async function closeTakedown(
  takedownId: string,
  resolution: string,
  actorId: string,
  now = new Date()
): Promise<TakedownRequest> {
  return withSerializableRetry(async (tx) => {
    const current = await tx.takedownRequest.findUnique({ where: { id: takedownId } });
    if (!current) throw new NotFoundError("Kaldırma talebi bulunamadı");
    if (current.status === "CLOSED")
      throw new ConflictError("Talep zaten kapalı", "TAKEDOWN_CLOSED");
    const row = await tx.takedownRequest.update({
      where: { id: takedownId },
      data: { status: "CLOSED", resolvedAt: now, resolvedById: actorId, resolution },
    });
    await tx.auditLog.create({
      data: {
        actorId,
        action: "takedown.closed",
        entity: "Property",
        entityId: current.propertyId,
        meta: { takedownId, resolution },
      },
    });
    return row;
  });
}

export async function listTakedowns(opts: { status?: "RECEIVED" | "ACTIONED" | "CLOSED" } = {}) {
  return prisma.takedownRequest.findMany({
    where: opts.status ? { status: opts.status } : undefined,
    orderBy: { receivedAt: "desc" },
    take: 200,
  });
}
