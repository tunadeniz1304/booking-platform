import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import type { NoticeAppeal, NoticeAppealRole, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withSerializableRetry } from "@/lib/db/transactions";
import { ConflictError, HttpError, NotFoundError, ValidationError } from "@/lib/http/errors";
import { appendOutbox } from "@/lib/cqrs/outbox";
import { EventTypes, makeEvent } from "@/lib/events/events";
import { getConfig } from "@/lib/config/app-config";
import { getJwtSecret } from "@/lib/auth/tokens";
import { counter } from "@/lib/observability/metrics";
import { invalidatePropertySearchCache } from "@/lib/search";

/**
 * P2-1a — DSA (AB 2022/2065) md. 20 iç şikâyet (itiraz) sistemi.
 *
 * - Karar e-postasındaki bağlantı rol başına (bildiren / ev sahibi) HMAC ile imzalıdır:
 *   bildirenin hesabı olmayabilir, bu yüzden itiraz oturum gerektirmez; bağlantıyı bilen
 *   yalnız o karar ve o rol için itiraz edebilir.
 * - md. 20(1): karardan sonra en az 6 ay (`DSA_APPEAL_WINDOW_DAYS`, varsayılan 180 gün).
 * - md. 20(4): itiraz haklıysa karar gecikmeksizin geri alınır — UPHELD:
 *   REMOVED → kısıtlama kalkar (ev sahibi yeniden yayına alabilir; ilan otomatik açılmaz),
 *   NO_ACTION → ilan kaldırılır (dayanak zorunlu).
 * - md. 20(6): kararı yalnız otomatik araçla değil, yönetici verir (admin API).
 * - Yeniden yayın engeli: ilan için yürürlükte bir DSA kaldırma kararı varsa
 *   `assertNoActiveDsaRestriction` → 409 DSA_RESTRICTION_ACTIVE (7565 TAKEDOWN_ACTIVE deseni).
 */

export const APPEAL_ROLES = ["REPORTER", "HOST"] as const satisfies readonly NoticeAppealRole[];

export const noticeAppealsTotal = counter(
  "dsa_notice_appeals_total",
  "DSA md. 20 itirazları (alınan / karar verilen)",
  ["stage", "role", "outcome"] as const
);

/** Olay yükü: yalnız kimlik; e-posta içeriği tüketicide DB'den kurulur. */
export interface NoticeAppealEventPayload {
  appealId: string;
}

// ---------------------------------------------------------------------------
// İmzalı itiraz bağlantısı
// ---------------------------------------------------------------------------

function appealKey(): Buffer {
  return Buffer.from(
    hkdfSync("sha256", getJwtSecret(), Buffer.alloc(0), "booking-platform:dsa-appeal:v1", 32)
  );
}

/** Karar + rol için sabit (deterministik) itiraz belirteci. Sızdırılırsa yalnız o itiraz açılır. */
export function appealToken(noticeId: string, role: NoticeAppealRole): string {
  return createHmac("sha256", appealKey()).update(`${noticeId}:${role}`).digest("base64url");
}

export function verifyAppealToken(
  noticeId: string,
  role: NoticeAppealRole,
  token: string
): boolean {
  const expected = Buffer.from(appealToken(noticeId, role));
  const given = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/+$/, "");
}

/** Karar bildirimindeki itiraz bağlantısı (`/report/appeal`). */
export function appealLink(noticeId: string, role: NoticeAppealRole): string {
  const params = new URLSearchParams({
    notice: noticeId,
    role: role.toLowerCase(),
    token: appealToken(noticeId, role),
  });
  return `${appBaseUrl()}/report/appeal?${params.toString()}`;
}

export const appealRoleSchema = z
  .string()
  .transform((r) => r.toUpperCase())
  .pipe(z.enum(APPEAL_ROLES));

class AppealTokenError extends HttpError {
  constructor() {
    super(403, "APPEAL_TOKEN_INVALID", "İtiraz bağlantısı geçersiz");
  }
}

// ---------------------------------------------------------------------------
// İtiraz başvurusu
// ---------------------------------------------------------------------------

export const appealInputSchema = z.object({
  role: appealRoleSchema,
  token: z.string().trim().min(10).max(200),
  reason: z.string().trim().min(20).max(5000),
  locale: z.enum(["tr", "en"]).default("tr"),
});
export type AppealInput = z.infer<typeof appealInputSchema>;

export interface AppealContext {
  noticeId: string;
  role: NoticeAppealRole;
  decision: "REMOVED" | "NO_ACTION";
  decidedAt: string;
  statementOfReasons: string;
  windowEndsAt: string;
  windowOpen: boolean;
  appeal: { id: string; status: NoticeAppeal["status"]; createdAt: string } | null;
}

const windowEnd = (decidedAt: Date) =>
  new Date(decidedAt.getTime() + getConfig().DSA_APPEAL_WINDOW_DAYS * 86_400_000);

/**
 * İtiraz sayfası için karar özeti (imza doğrulanır). Karar yoksa 404; ev sahibi yalnız
 * ilanını kısıtlayan (REMOVED) kararlara itiraz edebilir.
 */
export async function getAppealContext(
  noticeId: string,
  role: NoticeAppealRole,
  token: string,
  now = new Date()
): Promise<AppealContext> {
  if (!verifyAppealToken(noticeId, role, token)) throw new AppealTokenError();
  const notice = await prisma.notice.findUnique({ where: { id: noticeId } });
  if (!notice || notice.status !== "DECIDED" || !notice.decision || !notice.decidedAt) {
    throw new NotFoundError("Karar bulunamadı");
  }
  if (role === "HOST" && (notice.decision !== "REMOVED" || !notice.propertyId)) {
    throw new NotFoundError("Karar bulunamadı");
  }
  const existing = await prisma.noticeAppeal.findUnique({
    where: { noticeId_appellantRole: { noticeId, appellantRole: role } },
  });
  const ends = windowEnd(notice.decidedAt);
  return {
    noticeId,
    role,
    decision: notice.decision,
    decidedAt: notice.decidedAt.toISOString(),
    statementOfReasons: notice.statementOfReasons ?? "",
    windowEndsAt: ends.toISOString(),
    windowOpen: now < ends,
    appeal: existing
      ? { id: existing.id, status: existing.status, createdAt: existing.createdAt.toISOString() }
      : null,
  };
}

/** İtirazı kaydeder (tek işlem): audit + alındı onayı outbox'a. */
export async function submitAppeal(
  noticeId: string,
  input: AppealInput,
  now = new Date()
): Promise<NoticeAppeal> {
  if (!verifyAppealToken(noticeId, input.role, input.token)) throw new AppealTokenError();
  const appeal = await withSerializableRetry(async (tx) => {
    const notice = await tx.notice.findUnique({ where: { id: noticeId } });
    if (!notice) throw new NotFoundError("Karar bulunamadı");
    if (notice.status !== "DECIDED" || !notice.decision || !notice.decidedAt) {
      throw new ConflictError("Bildirim için henüz karar verilmedi", "NOTICE_NOT_DECIDED");
    }
    if (now >= windowEnd(notice.decidedAt)) {
      throw new ConflictError("İtiraz süresi doldu", "APPEAL_WINDOW_CLOSED");
    }
    let email = notice.reporterEmail;
    if (input.role === "HOST") {
      if (notice.decision !== "REMOVED" || !notice.propertyId) {
        throw new ValidationError("Ev sahibi yalnız ilanını kısıtlayan karara itiraz edebilir");
      }
      const property = await tx.property.findUnique({
        where: { id: notice.propertyId },
        select: { host: { select: { email: true } } },
      });
      if (!property) throw new NotFoundError("İlan bulunamadı");
      email = property.host.email;
    }
    const existing = await tx.noticeAppeal.findUnique({
      where: { noticeId_appellantRole: { noticeId, appellantRole: input.role } },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictError("Bu karar için itirazınız zaten alındı", "APPEAL_EXISTS");
    }
    const row = await tx.noticeAppeal.create({
      data: {
        noticeId,
        propertyId: notice.propertyId,
        appellantRole: input.role,
        appellantEmail: email,
        reason: input.reason,
        locale: input.locale,
        createdAt: now,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: `appellant:${input.role.toLowerCase()}`,
        action: "dsa.appeal_received",
        entity: "Notice",
        entityId: noticeId,
        meta: { appealId: row.id, role: input.role },
      },
    });
    await appendOutbox(
      tx,
      makeEvent<NoticeAppealEventPayload>(EventTypes.NoticeAppealReceived, row.id, "notice", {
        appealId: row.id,
      })
    );
    return row;
  });
  noticeAppealsTotal.inc({ stage: "received", role: appeal.appellantRole, outcome: "pending" });
  return appeal;
}

// ---------------------------------------------------------------------------
// Yönetici kararı
// ---------------------------------------------------------------------------

export const appealDecisionSchema = z.object({
  outcome: z.enum(["UPHELD", "REJECTED"]),
  /** İtiraz kararının gerekçesi (itiraz edene e-postayla gider). */
  response: z.string().trim().min(10).max(5000),
  /** Bildirenin NO_ACTION itirazı kabul edilip ilan kaldırılıyorsa zorunlu dayanak. */
  ground: z.enum(["ILLEGAL_CONTENT", "TERMS_OF_SERVICE"]).optional(),
});
export type AppealDecisionInput = z.infer<typeof appealDecisionSchema>;

export async function decideAppeal(
  appealId: string,
  input: AppealDecisionInput,
  actorId: string,
  now = new Date()
): Promise<NoticeAppeal> {
  let restrictedPropertyId: string | null = null;
  const appeal = await withSerializableRetry(async (tx) => {
    restrictedPropertyId = null;
    const current = await tx.noticeAppeal.findUnique({ where: { id: appealId } });
    if (!current) throw new NotFoundError("İtiraz bulunamadı");
    if (current.status !== "PENDING") {
      throw new ConflictError("İtiraz için zaten karar verildi", "APPEAL_DECIDED");
    }
    const notice = await tx.notice.findUniqueOrThrow({ where: { id: current.noticeId } });
    const imposesRestriction =
      input.outcome === "UPHELD" && notice.decision === "NO_ACTION" && !!notice.propertyId;
    if (imposesRestriction) {
      if (!input.ground) {
        throw new ValidationError("İlanı kaldıran itiraz kararı için dayanak (ground) zorunlu");
      }
      await tx.property.update({ where: { id: notice.propertyId! }, data: { isActive: false } });
      restrictedPropertyId = notice.propertyId;
    }
    const row = await tx.noticeAppeal.update({
      where: { id: appealId },
      data: {
        status: input.outcome,
        response: input.response,
        decisionGround: imposesRestriction ? input.ground : null,
        decidedAt: now,
        decidedById: actorId,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId,
        action: "dsa.appeal_decided",
        entity: notice.propertyId ? "Property" : "Notice",
        entityId: notice.propertyId ?? notice.id,
        meta: {
          appealId,
          noticeId: notice.id,
          outcome: input.outcome,
          originalDecision: notice.decision,
        } satisfies Prisma.InputJsonValue,
      },
    });
    await appendOutbox(
      tx,
      makeEvent<NoticeAppealEventPayload>(EventTypes.NoticeAppealDecided, appealId, "notice", {
        appealId,
      })
    );
    return row;
  });
  noticeAppealsTotal.inc({
    stage: "decided",
    role: appeal.appellantRole,
    outcome: appeal.status.toLowerCase(),
  });
  if (restrictedPropertyId) {
    await invalidatePropertySearchCache(restrictedPropertyId).catch(() => undefined);
  }
  return appeal;
}

export async function listAppeals(opts: { status?: NoticeAppeal["status"] } = {}) {
  const appeals = await prisma.noticeAppeal.findMany({
    where: opts.status ? { status: opts.status } : undefined,
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const notices = await prisma.notice.findMany({
    where: { id: { in: [...new Set(appeals.map((a) => a.noticeId))] } },
    select: {
      id: true,
      contentUrl: true,
      category: true,
      decision: true,
      decidedAt: true,
      statementOfReasons: true,
    },
  });
  const byId = new Map(notices.map((n) => [n.id, n]));
  return appeals.map((a) => ({ ...a, notice: byId.get(a.noticeId) ?? null }));
}

// ---------------------------------------------------------------------------
// Yeniden yayın engeli
// ---------------------------------------------------------------------------

/**
 * İlan için yürürlükte DSA kaldırma kısıtlaması var mı: REMOVED kararı (kabul edilmiş itirazla
 * geri alınmamış) ya da kabul edilmiş bir bildiren itirazıyla kaldırmaya dönüşen NO_ACTION.
 */
export async function hasActiveDsaRestriction(
  propertyId: string,
  db: Pick<Prisma.TransactionClient, "notice" | "noticeAppeal"> = prisma
): Promise<boolean> {
  const notices = await db.notice.findMany({
    where: { propertyId, status: "DECIDED" },
    select: { id: true, decision: true },
  });
  if (notices.length === 0) return false;
  const upheld = new Set(
    (
      await db.noticeAppeal.findMany({
        where: { noticeId: { in: notices.map((n) => n.id) }, status: "UPHELD" },
        select: { noticeId: true },
      })
    ).map((a) => a.noticeId)
  );
  return notices.some((n) => (n.decision === "REMOVED") !== upheld.has(n.id));
}

export async function assertNoActiveDsaRestriction(propertyId: string): Promise<void> {
  if (await hasActiveDsaRestriction(propertyId)) {
    throw new ConflictError(
      "İlan DSA kararıyla yayından kaldırıldı; itiraz kabul edilmeden yeniden yayına alınamaz",
      "DSA_RESTRICTION_ACTIVE"
    );
  }
}
