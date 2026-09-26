import type { Notice, NoticeCategory, NoticeDecision, NoticeGround } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withSerializableRetry } from "@/lib/db/transactions";
import { ConflictError, HttpError, NotFoundError, ValidationError } from "@/lib/http/errors";
import { appendOutbox } from "@/lib/cqrs/outbox";
import { EventTypes, makeEvent } from "@/lib/events/events";
import { getConfig } from "@/lib/config/app-config";
import { counter } from "@/lib/observability/metrics";
import { logger, errorFields } from "@/lib/observability/logger";
import { invalidatePropertySearchCache } from "@/lib/search";
import type { RedisClient } from "@/lib/redis";

/**
 * P1-13b — DSA (AB 2022/2065) bildirim-ve-eylem.
 *
 * - md. 16: herkese açık form; içerik konumu (URL), gerekçe, bildirenin adı/e-postası ve
 *   iyi niyet beyanı zorunlu. Alındı onayı e-postayla (outbox) gönderilir.
 * - md. 17: kararda gerekçeli karar bildirimi (statement of reasons): kısıtlama türü,
 *   olgular, otomatik araç kullanılıp kullanılmadığı, hukuki ya da sözleşmesel dayanak,
 *   itiraz yolları. İlan kaldırıldıysa ev sahibine, sonuç her durumda bildirene gider.
 * - md. 15/24: şeffaflık raporu (JSON/CSV) — kategori, karar, dayanak, medyan karar süresi,
 *   7565 kaldırma talepleri ve SLA aşımları.
 */

export const NOTICE_CATEGORIES = [
  "ILLEGAL_LISTING",
  "UNLICENSED",
  "FRAUD_SCAM",
  "IP_INFRINGEMENT",
  "DISCRIMINATION",
  "UNSAFE",
  "OTHER",
] as const satisfies readonly NoticeCategory[];

export const noticesReceivedTotal = counter(
  "dsa_notices_total",
  "DSA bildirimleri (alınan / karar verilen)",
  ["stage", "category"] as const
);

export const noticeInputSchema = z.object({
  propertyId: z.string().trim().min(1).max(64).optional(),
  contentUrl: z.string().trim().url().max(2000),
  category: z.enum(NOTICE_CATEGORIES),
  explanation: z.string().trim().min(20).max(5000),
  reporterName: z.string().trim().min(1).max(120).optional(),
  reporterEmail: z.string().trim().email().max(254),
  /** md. 16(2)(d): bildirimdeki bilgilerin doğru ve eksiksiz olduğuna dair iyi niyet beyanı. */
  goodFaith: z.literal(true),
  locale: z.enum(["tr", "en"]).default("tr"),
});
export type NoticeInput = z.infer<typeof noticeInputSchema>;

/** Olay yükleri: yalnız kimlik; e-posta içeriği tüketicide DB'den kurulur. */
export interface NoticeEventPayload {
  noticeId: string;
}

/**
 * İstemci başına sabit pencereli limit (`DSA_NOTICE_MAX_PER_WINDOW`). Redis erişilemezse
 * fail-open: yasal bildirim kanalı kapanmamalı (proxy genel limiti yine geçerli).
 */
export async function assertNoticeRateLimit(
  redis: Pick<RedisClient, "incrWithTtl">,
  client: string
): Promise<void> {
  const { DSA_NOTICE_MAX_PER_WINDOW, DSA_NOTICE_WINDOW_SECONDS } = getConfig();
  let count: number;
  try {
    count = await redis.incrWithTtl(`dsa:notice:${client}`, DSA_NOTICE_WINDOW_SECONDS);
  } catch (error) {
    logger.warn(errorFields(error), "dsa notice rate limit unavailable; allowing");
    return;
  }
  if (count > DSA_NOTICE_MAX_PER_WINDOW) {
    throw new HttpError(
      429,
      "NOTICE_RATE_LIMITED",
      "Çok fazla bildirim; lütfen daha sonra deneyin"
    );
  }
}

/** Bildirimi kaydeder ve alındı onayını outbox'a yazar (tek işlem). */
export async function submitNotice(input: NoticeInput): Promise<Notice> {
  const notice = await withSerializableRetry(async (tx) => {
    if (input.propertyId) {
      const exists = await tx.property.findUnique({
        where: { id: input.propertyId },
        select: { id: true },
      });
      if (!exists) throw new ValidationError("Bildirilen ilan bulunamadı");
    }
    const row = await tx.notice.create({
      data: {
        propertyId: input.propertyId,
        contentUrl: input.contentUrl,
        category: input.category,
        explanation: input.explanation,
        reporterName: input.reporterName,
        reporterEmail: input.reporterEmail.toLowerCase(),
        goodFaith: input.goodFaith,
        locale: input.locale,
      },
    });
    await appendOutbox(
      tx,
      makeEvent<NoticeEventPayload>(EventTypes.NoticeReceived, row.id, "notice", {
        noticeId: row.id,
      })
    );
    return row;
  });
  noticesReceivedTotal.inc({ stage: "received", category: notice.category });
  return notice;
}

export const noticeDecisionSchema = z
  .object({
    decision: z.enum(["REMOVED", "NO_ACTION"]),
    ground: z.enum(["ILLEGAL_CONTENT", "TERMS_OF_SERVICE"]).optional(),
    /** Karara dayanak olan olgular ve gerekçe (md. 17(3)(b)). */
    facts: z.string().trim().min(10).max(5000),
    /** Hukuki dayanak (ör. "7464 s. Kanun md. 5") veya ilgili koşul maddesi. */
    legalReference: z.string().trim().min(1).max(300).optional(),
  })
  .refine((d) => d.decision === "NO_ACTION" || d.ground !== undefined, {
    message: "Kaldırma kararı için dayanak (ground) zorunlu",
    path: ["ground"],
  });
export type NoticeDecisionInput = z.infer<typeof noticeDecisionSchema>;

const RESTRICTION: Record<NoticeDecision, string> = {
  REMOVED: "İlan yayından kaldırıldı (görünürlük kısıtlaması: tamamen) / Listing removed",
  NO_ACTION: "Kısıtlama uygulanmadı / No restriction applied",
};
const GROUND: Record<NoticeGround, string> = {
  ILLEGAL_CONTENT: "Hukuka aykırı içerik (DSA md. 17(3)(d)) / Illegal content",
  TERMS_OF_SERVICE: "Kullanım koşullarına aykırılık (DSA md. 17(3)(e)) / Terms of service",
};

/**
 * md. 17(3) gerekçeli karar bildirimi — denetlenebilir, dile bağımsız (TR/EN) düz metin.
 * Aynı metin DB'ye yazılır, e-postada gönderilir ve şeffaflık kaydında saklanır.
 */
export function buildStatementOfReasons(input: {
  noticeId: string;
  decision: NoticeDecision;
  ground?: NoticeGround | null;
  facts: string;
  legalReference?: string | null;
  automated: boolean;
  decidedAt: Date;
  contentUrl: string;
}): string {
  return [
    `Karar / Decision ID: ${input.noticeId}`,
    `Tarih / Date: ${input.decidedAt.toISOString()}`,
    `İçerik / Content: ${input.contentUrl}`,
    `Kısıtlama / Restriction: ${RESTRICTION[input.decision]}`,
    `Dayanak / Ground: ${input.ground ? GROUND[input.ground] : "-"}`,
    `Hukuki referans / Reference: ${input.legalReference ?? "-"}`,
    `Olgular ve gerekçe / Facts and reasoning: ${input.facts}`,
    `Otomatik araç / Automated means: ${input.automated ? "Evet / Yes" : "Hayır — insan incelemesi / No — human review"}`,
    "İtiraz yolları / Redress: platform içi şikâyet sistemi (support), DSA md. 21 mahkeme dışı uyuşmazlık çözümü ve yargı yolu / internal complaint handling, out-of-court dispute settlement (Art. 21) and judicial redress.",
  ].join("\n");
}

/** Yönetici kararı: kaldırmada ilan pasife alınır; karar bildirimi outbox'a yazılır. */
export async function decideNotice(
  noticeId: string,
  input: NoticeDecisionInput,
  actorId: string,
  now = new Date()
): Promise<Notice> {
  const notice = await withSerializableRetry(async (tx) => {
    const current = await tx.notice.findUnique({ where: { id: noticeId } });
    if (!current) throw new NotFoundError("Bildirim bulunamadı");
    if (current.status === "DECIDED") {
      throw new ConflictError("Bildirim için zaten karar verildi", "NOTICE_DECIDED");
    }
    if (input.decision === "REMOVED" && !current.propertyId) {
      throw new ValidationError("İlana bağlı olmayan bildirimde kaldırma uygulanamaz");
    }
    const statementOfReasons = buildStatementOfReasons({
      noticeId,
      decision: input.decision,
      ground: input.ground,
      facts: input.facts,
      legalReference: input.legalReference,
      automated: false,
      decidedAt: now,
      contentUrl: current.contentUrl,
    });
    if (input.decision === "REMOVED" && current.propertyId) {
      await tx.property.update({ where: { id: current.propertyId }, data: { isActive: false } });
    }
    const row = await tx.notice.update({
      where: { id: noticeId },
      data: {
        status: "DECIDED",
        decision: input.decision,
        decisionGround: input.ground,
        legalReference: input.legalReference,
        statementOfReasons,
        automated: false,
        decidedAt: now,
        decidedById: actorId,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId,
        action: "dsa.notice_decided",
        entity: current.propertyId ? "Property" : "Notice",
        entityId: current.propertyId ?? noticeId,
        meta: { noticeId, decision: input.decision, ground: input.ground ?? null },
      },
    });
    await appendOutbox(
      tx,
      makeEvent<NoticeEventPayload>(EventTypes.NoticeDecided, noticeId, "notice", { noticeId })
    );
    return row;
  });
  noticesReceivedTotal.inc({ stage: "decided", category: notice.category });
  if (notice.decision === "REMOVED" && notice.propertyId) {
    await invalidatePropertySearchCache(notice.propertyId).catch(() => undefined);
  }
  return notice;
}

export async function listNotices(opts: { status?: "RECEIVED" | "DECIDED" } = {}) {
  return prisma.notice.findMany({
    where: opts.status ? { status: opts.status } : undefined,
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}

// ---------------------------------------------------------------------------
// Şeffaflık raporu (md. 15 / 24)
// ---------------------------------------------------------------------------

export interface TransparencyReport {
  period: { from: string; to: string };
  notices: {
    received: number;
    decided: number;
    pending: number;
    byCategory: Record<string, number>;
    byDecision: Record<string, number>;
    byGround: Record<string, number>;
    automatedDecisions: number;
    /** Karar verilenlerde alınma→karar medyanı (saat); karar yoksa null. */
    medianHoursToDecision: number | null;
  };
  takedowns: {
    received: number;
    bySource: Record<string, number>;
    slaBreaches: number;
    closed: number;
  };
}

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const tally = (keys: Array<string | null | undefined>) => {
  const out: Record<string, number> = {};
  for (const k of keys) if (k) out[k] = (out[k] ?? 0) + 1;
  return out;
};

/** [from, to) aralığı için toplulaştırılmış rapor; kişisel veri içermez. */
export async function buildTransparencyReport(from: Date, to: Date): Promise<TransparencyReport> {
  if (!(from < to)) throw new ValidationError("from < to olmalı");
  const [notices, takedowns] = await Promise.all([
    prisma.notice.findMany({
      where: { createdAt: { gte: from, lt: to } },
      select: {
        category: true,
        status: true,
        decision: true,
        decisionGround: true,
        automated: true,
        createdAt: true,
        decidedAt: true,
      },
    }),
    prisma.takedownRequest.findMany({
      where: { receivedAt: { gte: from, lt: to } },
      select: { source: true, slaBreachedAt: true, status: true },
    }),
  ]);
  const decided = notices.filter((n) => n.status === "DECIDED");
  const hours = decided
    .filter((n) => n.decidedAt)
    .map(
      (n) => Math.round(((n.decidedAt!.getTime() - n.createdAt.getTime()) / 3_600_000) * 100) / 100
    );
  return {
    period: { from: from.toISOString(), to: to.toISOString() },
    notices: {
      received: notices.length,
      decided: decided.length,
      pending: notices.length - decided.length,
      byCategory: tally(notices.map((n) => n.category)),
      byDecision: tally(decided.map((n) => n.decision)),
      byGround: tally(decided.map((n) => n.decisionGround)),
      automatedDecisions: decided.filter((n) => n.automated).length,
      medianHoursToDecision: median(hours),
    },
    takedowns: {
      received: takedowns.length,
      bySource: tally(takedowns.map((t) => t.source)),
      slaBreaches: takedowns.filter((t) => t.slaBreachedAt).length,
      closed: takedowns.filter((t) => t.status === "CLOSED").length,
    },
  };
}

/** Düz `metric,key,value` CSV (tablo araçlarına doğrudan yüklenebilir). */
export function transparencyReportCsv(report: TransparencyReport): string {
  const rows: Array<[string, string, string | number]> = [
    ["period", "from", report.period.from],
    ["period", "to", report.period.to],
    ["notices", "received", report.notices.received],
    ["notices", "decided", report.notices.decided],
    ["notices", "pending", report.notices.pending],
    ["notices", "automated_decisions", report.notices.automatedDecisions],
    ["notices", "median_hours_to_decision", report.notices.medianHoursToDecision ?? ""],
  ];
  for (const [k, v] of Object.entries(report.notices.byCategory))
    rows.push(["notices_by_category", k, v]);
  for (const [k, v] of Object.entries(report.notices.byDecision))
    rows.push(["notices_by_decision", k, v]);
  for (const [k, v] of Object.entries(report.notices.byGround))
    rows.push(["notices_by_ground", k, v]);
  rows.push(["takedowns", "received", report.takedowns.received]);
  rows.push(["takedowns", "sla_breaches", report.takedowns.slaBreaches]);
  rows.push(["takedowns", "closed", report.takedowns.closed]);
  for (const [k, v] of Object.entries(report.takedowns.bySource))
    rows.push(["takedowns_by_source", k, v]);
  return ["metric,key,value", ...rows.map((r) => r.join(","))].join("\n") + "\n";
}
