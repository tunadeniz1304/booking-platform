import { Prisma, type Claim, type ClaimStatus, type ClaimType } from "@prisma/client";
import { z } from "zod";
import type { AccessClaims } from "@/lib/auth";
import { getConfig } from "@/lib/config/app-config";
import { appendOutbox } from "@/lib/cqrs/outbox";
import { withSerializableRetry } from "@/lib/db/transactions";
import { createRedlock, LockError } from "@/lib/distributed-lock/redlock";
import { EventTypes, makeEvent, type ClaimEventPayload } from "@/lib/events/events";
import { ConflictError, HttpError, NotFoundError, ValidationError } from "@/lib/http/errors";
import { postRefundFromEscrow } from "@/lib/ledger";
import { minorFromDb, money } from "@/lib/money/money";
import { errorFields, logger } from "@/lib/observability/logger";
import { counter } from "@/lib/observability/metrics";
import { getPaymentProvider, PaymentProviderError } from "@/lib/payment";
import { prisma } from "@/lib/prisma";
import { getQueue, QUEUE_NAMES } from "@/lib/queue";
import { redis } from "@/lib/redis";
import { checkInAt, checkOutAt, clockOf, fromDate } from "@/lib/time/nights";
import { captureDeposit, depositAuthValid, releaseDeposit, toDepositView } from "./deposit";
import { sanitizeEvidence } from "./evidence";

/**
 * P1-5 çözüm merkezi (Airbnb Resolution Center benzeri).
 *
 *  - GUEST_REFUND: misafir, konaklama başladıktan sonra (yerel giriş) çıkış +
 *    CLAIM_GUEST_WINDOW_DAYS içinde iade ister; karşı taraf ev sahibi.
 *  - HOST_DAMAGE: ev sahibi, girişten sonra depozito tutma süresi (çıkış + DEPOSIT_HOLD_DAYS)
 *    içinde hasar tazmini ister; karşı taraf misafir. Açık talep depozitoyu tutar (void yok).
 *  - CHARGEBACK: PSP itirazı (webhook) — taraflar açamaz, yönetici karar vermez (PSP sonucu).
 *
 * Açılışta durum AWAITING_RESPONSE, `slaDueAt = şimdi + CLAIM_RESPONSE_SLA_HOURS`; BullMQ
 * gecikmeli işi bitişte hâlâ yanıt yoksa talebi ESCALATED yapar (+ yönetici bildirimi +
 * `claim_sla_breach_total`). Karşı taraf yanıt verince OPEN (yönetici kararı bekler).
 * Karar deterministik kodda: yönetici onay/kısmi/ret + tutar + gerekçe (LLM yok).
 */

export const CLAIM_SLA_CHECK_JOB = "claim-sla-check";
export const CLAIM_SLA_SWEEP_JOB = "claim-sla-sweep";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const OPEN_STATUSES: ClaimStatus[] = ["OPEN", "AWAITING_RESPONSE", "ESCALATED"];
const SYSTEM_ACTOR = "system:claim-sla";

const redlock = createRedlock(redis);

export const claimSlaBreachTotal = counter(
  "claim_sla_breach_total",
  "Çözüm merkezi taleplerinde yanıt SLA aşımı (otomatik eskalasyon)",
  ["type"] as const
);
export const claimsTotal = counter("claims_total", "Çözüm merkezi talep olayları", [
  "type",
  "stage",
] as const);

export class ClaimError extends HttpError {
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(status, code, message, details);
    this.name = "ClaimError";
  }
}

// ---------------------------------------------------------------------------
// Şemalar
// ---------------------------------------------------------------------------

export const openClaimSchema = z.object({
  bookingId: z.string().trim().min(1).max(64),
  type: z.enum(["GUEST_REFUND", "HOST_DAMAGE"]),
  amountMinor: z.number().int().positive().max(1_000_000_000),
  description: z.string().trim().min(10).max(4000),
});
export type OpenClaimInput = z.infer<typeof openClaimSchema>;

export const claimMessageSchema = z.object({
  body: z.string().trim().min(1).max(4000),
});

export const claimDecisionSchema = z
  .object({
    decision: z.enum(["APPROVE", "PARTIAL", "REJECT"]),
    /** PARTIAL için zorunlu (0 < tutar < talep). */
    amountMinor: z.number().int().positive().optional(),
    note: z.string().trim().min(3).max(4000),
  })
  .refine((d) => d.decision !== "PARTIAL" || d.amountMinor !== undefined, {
    message: "Kısmi kararda tutar zorunlu",
    path: ["amountMinor"],
  });
export type ClaimDecisionInput = z.infer<typeof claimDecisionSchema>;

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------

type Tx = Prisma.TransactionClient;

const bookingSelect = {
  id: true,
  userId: true,
  status: true,
  checkIn: true,
  checkOut: true,
  currency: true,
  priceBreakdown: true,
  property: {
    select: {
      id: true,
      title: true,
      hostId: true,
      timeZone: true,
      checkInTime: true,
      checkOutTime: true,
    },
  },
  payment: {
    select: {
      id: true,
      status: true,
      amountMinor: true,
      refundedAmountMinor: true,
      providerRef: true,
      cartPayment: { select: { providerRef: true } },
    },
  },
} satisfies Prisma.BookingSelect;

type BookingRow = Prisma.BookingGetPayload<{ select: typeof bookingSelect }>;

async function loadBooking(bookingId: string): Promise<BookingRow | null> {
  return prisma.booking.findUnique({ where: { id: bookingId }, select: bookingSelect });
}

function refundableMinor(b: BookingRow): bigint {
  const p = b.payment;
  if (!p || !["PAID", "PARTIALLY_REFUNDED"].includes(p.status)) return 0n;
  const rest = p.amountMinor - p.refundedAmountMinor;
  return rest > 0n ? rest : 0n;
}

function stayWindow(b: BookingRow) {
  const clock = clockOf(b.property);
  return {
    checkInAt: checkInAt(fromDate(b.checkIn), clock),
    checkOutAt: checkOutAt(fromDate(b.checkOut), clock),
  };
}

function isParty(claim: Pick<Claim, "openedById" | "respondentId">, userId: string): boolean {
  return claim.openedById === userId || claim.respondentId === userId;
}

async function emit(tx: Tx, type: string, claimId: string): Promise<void> {
  await appendOutbox(
    tx,
    makeEvent<ClaimEventPayload>(
      type as (typeof EventTypes)[keyof typeof EventTypes],
      claimId,
      "claim",
      { claimId }
    )
  );
}

export function claimSlaDueAt(from: Date, hours = getConfig().CLAIM_RESPONSE_SLA_HOURS): Date {
  return new Date(from.getTime() + hours * HOUR_MS);
}

/** SLA bitişinde çalışacak gecikmeli iş (talep başına tek). Kuyruk yoksa süpürücü yakalar. */
export async function scheduleClaimSlaCheck(
  claim: Pick<Claim, "id" | "slaDueAt">,
  now = new Date()
): Promise<void> {
  if (!claim.slaDueAt) return;
  try {
    await getQueue(QUEUE_NAMES.resolution).add(
      CLAIM_SLA_CHECK_JOB,
      { claimId: claim.id },
      {
        jobId: `claim-sla-${claim.id}`,
        delay: Math.max(0, claim.slaDueAt.getTime() - now.getTime()),
        attempts: 5,
        backoff: { type: "exponential", delay: 10_000 },
        removeOnComplete: true,
        removeOnFail: 1000,
      }
    );
  } catch (error) {
    logger.warn(
      { claimId: claim.id, ...errorFields(error) },
      "claim SLA job could not be scheduled; sweep will check it"
    );
  }
}

// ---------------------------------------------------------------------------
// Talep açma / yanıt / geri çekme
// ---------------------------------------------------------------------------

export async function openClaim(
  actor: AccessClaims,
  input: OpenClaimInput,
  now = new Date()
): Promise<Claim> {
  const cfg = getConfig();
  const booking = await loadBooking(input.bookingId);
  // IDOR: taraf değilse rezervasyonun varlığı bile sızmaz.
  if (!booking) throw new NotFoundError("Rezervasyon bulunamadı");
  const isGuest = booking.userId === actor.userId;
  const isHost = booking.property.hostId === actor.userId;
  if ((input.type === "GUEST_REFUND" && !isGuest) || (input.type === "HOST_DAMAGE" && !isHost)) {
    throw new NotFoundError("Rezervasyon bulunamadı");
  }
  if (!["CONFIRMED", "COMPLETED"].includes(booking.status)) {
    throw new ClaimError(409, "CLAIM_BOOKING_NOT_ELIGIBLE", "Bu rezervasyon için talep açılamaz");
  }
  const window = stayWindow(booking);
  if (now.getTime() < window.checkInAt.getTime()) {
    throw new ClaimError(409, "CLAIM_TOO_EARLY", "Talep konaklama başladıktan sonra açılabilir");
  }
  const amount = BigInt(input.amountMinor);
  let respondentId: string;
  if (input.type === "GUEST_REFUND") {
    const deadline = window.checkOutAt.getTime() + cfg.CLAIM_GUEST_WINDOW_DAYS * DAY_MS;
    if (now.getTime() > deadline) {
      throw new ClaimError(409, "CLAIM_WINDOW_CLOSED", "İade talebi süresi doldu");
    }
    const transferred = await prisma.bookingTransfer.count({
      where: { bookingId: booking.id, status: "COMPLETED" },
    });
    if (transferred > 0) {
      throw new ClaimError(
        409,
        "CLAIM_TRANSFERRED_BOOKING",
        "Devredilmiş rezervasyonda iade talebi açılamaz"
      );
    }
    const refundable = refundableMinor(booking);
    if (amount > refundable) {
      throw new ClaimError(
        422,
        "CLAIM_AMOUNT_EXCEEDS_REFUNDABLE",
        "Talep, iade edilebilir tutarı aşıyor",
        {
          refundableMinor: refundable.toString(),
        }
      );
    }
    respondentId = booking.property.hostId;
  } else {
    const deposit = await prisma.damageDeposit.findUnique({ where: { bookingId: booking.id } });
    const deadline =
      deposit?.voidAfter.getTime() ?? window.checkOutAt.getTime() + cfg.DEPOSIT_HOLD_DAYS * DAY_MS;
    if (now.getTime() > deadline) {
      throw new ClaimError(409, "CLAIM_WINDOW_CLOSED", "Hasar talebi süresi doldu");
    }
    respondentId = booking.userId;
  }

  let claim: Claim;
  try {
    claim = await withSerializableRetry(async (tx) => {
      const row = await tx.claim.create({
        data: {
          bookingId: booking.id,
          type: input.type,
          openedById: actor.userId,
          respondentId,
          amountRequestedMinor: amount,
          currency: booking.currency,
          description: input.description,
          status: "AWAITING_RESPONSE",
          slaDueAt: claimSlaDueAt(now),
          createdAt: now,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.userId,
          action: "claim.opened",
          entity: "Claim",
          entityId: row.id,
          meta: { bookingId: booking.id, type: row.type, amountMinor: amount.toString() },
        },
      });
      await emit(tx, EventTypes.ClaimOpened, row.id);
      return row;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ClaimError(
        409,
        "CLAIM_ALREADY_OPEN",
        "Bu rezervasyon için açık bir talep zaten var"
      );
    }
    throw error;
  }
  claimsTotal.inc({ type: claim.type, stage: "opened" });
  await scheduleClaimSlaCheck(claim, now);
  return claim;
}

async function loadClaimForActor(actor: AccessClaims, claimId: string): Promise<Claim> {
  const claim = await prisma.claim.findUnique({ where: { id: claimId } });
  if (!claim || (actor.role !== "ADMIN" && !isParty(claim, actor.userId))) {
    throw new NotFoundError("Talep bulunamadı");
  }
  return claim;
}

function assertOpen(claim: Claim): void {
  if (!OPEN_STATUSES.includes(claim.status)) {
    throw new ClaimError(409, "CLAIM_CLOSED", "Talep kapanmış");
  }
}

/** Mesaj / yanıt. Karşı tarafın ilk yanıtı talebi AWAITING_RESPONSE → OPEN yapar. */
export async function addClaimMessage(
  actor: AccessClaims,
  claimId: string,
  body: string,
  now = new Date()
): Promise<{ status: ClaimStatus }> {
  const claim = await loadClaimForActor(actor, claimId);
  assertOpen(claim);
  const role =
    claim.respondentId === actor.userId
      ? "RESPONDENT"
      : claim.openedById === actor.userId
        ? "OPENER"
        : "ADMIN";
  return withSerializableRetry(async (tx) => {
    await tx.claimMessage.create({
      data: { claimId, authorId: actor.userId, role, body, createdAt: now },
    });
    if (role === "RESPONDENT" && claim.status === "AWAITING_RESPONSE") {
      const res = await tx.claim.updateMany({
        where: { id: claimId, status: "AWAITING_RESPONSE" },
        data: { status: "OPEN", respondedAt: now },
      });
      if (res.count === 1) return { status: "OPEN" as const };
    }
    const fresh = await tx.claim.findUniqueOrThrow({
      where: { id: claimId },
      select: { status: true },
    });
    return { status: fresh.status };
  });
}

/** Açan taraf talebi geri çeker (CLOSED). */
export async function withdrawClaim(
  actor: AccessClaims,
  claimId: string,
  now = new Date()
): Promise<void> {
  const claim = await loadClaimForActor(actor, claimId);
  if (claim.openedById !== actor.userId) throw new NotFoundError("Talep bulunamadı");
  assertOpen(claim);
  const res = await prisma.claim.updateMany({
    where: { id: claimId, status: { in: OPEN_STATUSES } },
    data: { status: "CLOSED", decidedAt: now, decisionNote: "withdrawn" },
  });
  if (res.count !== 1) throw new ClaimError(409, "CLAIM_CLOSED", "Talep kapanmış");
  claimsTotal.inc({ type: claim.type, stage: "withdrawn" });
  if (claim.type === "HOST_DAMAGE") await releaseAfterDamageClaim(claim.bookingId, now);
}

// ---------------------------------------------------------------------------
// Kanıt
// ---------------------------------------------------------------------------

export async function uploadClaimEvidence(
  actor: AccessClaims,
  claimId: string,
  file: Buffer,
  now = new Date()
): Promise<{
  id: string;
  contentType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
}> {
  const claim = await loadClaimForActor(actor, claimId);
  assertOpen(claim);
  const count = await prisma.claimEvidence.count({ where: { claimId } });
  if (count >= getConfig().CLAIM_EVIDENCE_MAX_FILES) {
    throw new ClaimError(409, "CLAIM_EVIDENCE_LIMIT", "Talep başına kanıt sınırına ulaşıldı");
  }
  const clean = await sanitizeEvidence(file);
  const row = await prisma.claimEvidence.create({
    data: {
      claimId,
      uploaderId: actor.userId,
      contentType: clean.contentType,
      byteSize: clean.data.byteLength,
      width: clean.width,
      height: clean.height,
      sha256: clean.sha256,
      data: clean.data,
      createdAt: now,
    },
    select: { id: true, contentType: true, byteSize: true, width: true, height: true },
  });
  return row;
}

export async function getClaimEvidence(
  actor: AccessClaims,
  claimId: string,
  evidenceId: string
): Promise<{ data: Buffer; contentType: string; sha256: string }> {
  await loadClaimForActor(actor, claimId);
  const row = await prisma.claimEvidence.findUnique({ where: { id: evidenceId } });
  if (!row || row.claimId !== claimId) throw new NotFoundError("Kanıt bulunamadı");
  return { data: Buffer.from(row.data), contentType: row.contentType, sha256: row.sha256 };
}

// ---------------------------------------------------------------------------
// Görünümler
// ---------------------------------------------------------------------------

export interface ClaimSummary {
  id: string;
  bookingId: string;
  type: ClaimType;
  status: ClaimStatus;
  amountRequestedMinor: number;
  awardedMinor: number | null;
  currency: string;
  slaDueAt: string | null;
  createdAt: string;
  role: "OPENER" | "RESPONDENT" | "ADMIN";
  propertyTitle: string | null;
}

function viewRole(claim: Claim, actor: AccessClaims): ClaimSummary["role"] {
  if (claim.openedById === actor.userId) return "OPENER";
  if (claim.respondentId === actor.userId) return "RESPONDENT";
  return "ADMIN";
}

async function propertyTitles(bookingIds: string[]): Promise<Map<string, string>> {
  const rows = await prisma.booking.findMany({
    where: { id: { in: bookingIds } },
    select: { id: true, property: { select: { title: true } } },
  });
  return new Map(rows.map((r) => [r.id, r.property.title]));
}

function toSummary(c: Claim, actor: AccessClaims, titles: Map<string, string>): ClaimSummary {
  return {
    id: c.id,
    bookingId: c.bookingId,
    type: c.type,
    status: c.status,
    amountRequestedMinor: minorFromDb(c.amountRequestedMinor),
    awardedMinor: c.awardedMinor === null ? null : minorFromDb(c.awardedMinor),
    currency: c.currency,
    slaDueAt: c.slaDueAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
    role: viewRole(c, actor),
    propertyTitle: titles.get(c.bookingId) ?? null,
  };
}

/** Kullanıcının taraf olduğu talepler (yönetici: `all` ile tümü, durum süzgeci). */
export async function listClaims(
  actor: AccessClaims,
  opts: { all?: boolean; status?: ClaimStatus; bookingId?: string } = {}
): Promise<ClaimSummary[]> {
  const where: Prisma.ClaimWhereInput = {
    ...(opts.status ? { status: opts.status } : {}),
    ...(opts.bookingId ? { bookingId: opts.bookingId } : {}),
    ...(opts.all && actor.role === "ADMIN"
      ? {}
      : { OR: [{ openedById: actor.userId }, { respondentId: actor.userId }] }),
  };
  const rows = await prisma.claim.findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    take: 200,
  });
  const titles = await propertyTitles([...new Set(rows.map((r) => r.bookingId))]);
  return rows.map((r) => toSummary(r, actor, titles));
}

export async function getClaimDetail(actor: AccessClaims, claimId: string) {
  const claim = await loadClaimForActor(actor, claimId);
  const [messages, evidence, booking, deposit] = await Promise.all([
    prisma.claimMessage.findMany({ where: { claimId }, orderBy: { createdAt: "asc" } }),
    prisma.claimEvidence.findMany({
      where: { claimId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        uploaderId: true,
        contentType: true,
        byteSize: true,
        width: true,
        height: true,
        createdAt: true,
      },
    }),
    loadBooking(claim.bookingId),
    prisma.damageDeposit.findUnique({ where: { bookingId: claim.bookingId } }),
  ]);
  const titles = new Map(booking ? [[booking.id, booking.property.title]] : []);
  const roleOf = (userId: string) =>
    userId === claim.openedById ? "OPENER" : userId === claim.respondentId ? "RESPONDENT" : "ADMIN";
  return {
    claim: {
      ...toSummary(claim, actor, titles),
      description: claim.description,
      respondedAt: claim.respondedAt?.toISOString() ?? null,
      escalatedAt: claim.escalatedAt?.toISOString() ?? null,
      settledMinor: claim.settledMinor === null ? null : minorFromDb(claim.settledMinor),
      uncollectedMinor:
        claim.uncollectedMinor === null ? null : minorFromDb(claim.uncollectedMinor),
      platformCoveredMinor:
        claim.platformCoveredMinor === null ? null : minorFromDb(claim.platformCoveredMinor),
      decisionNote: claim.decisionNote,
      decidedAt: claim.decidedAt?.toISOString() ?? null,
      externalStatus: claim.externalStatus,
      externalReason: claim.externalReason,
    },
    booking: booking
      ? {
          id: booking.id,
          checkIn: fromDate(booking.checkIn),
          checkOut: fromDate(booking.checkOut),
          status: booking.status,
          refundableMinor: minorFromDb(refundableMinor(booking)),
        }
      : null,
    deposit: deposit ? toDepositView(deposit) : null,
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      body: m.body,
      mine: m.authorId === actor.userId,
      createdAt: m.createdAt.toISOString(),
    })),
    evidence: evidence.map((e) => ({
      id: e.id,
      role: roleOf(e.uploaderId),
      contentType: e.contentType,
      byteSize: e.byteSize,
      width: e.width,
      height: e.height,
      createdAt: e.createdAt.toISOString(),
    })),
  };
}

// ---------------------------------------------------------------------------
// SLA
// ---------------------------------------------------------------------------

export type ClaimSlaOutcome = "breached" | "responded" | "not_due" | "closed";

/** SLA kontrolü (gecikmeli iş + süpürücü): yanıt yoksa ESCALATED + bildirim + metrik. */
export async function checkClaimSla(claimId: string, now = new Date()): Promise<ClaimSlaOutcome> {
  const claim = await prisma.claim.findUnique({ where: { id: claimId } });
  if (!claim) throw new NotFoundError("Talep bulunamadı");
  if (claim.status !== "AWAITING_RESPONSE") {
    return OPEN_STATUSES.includes(claim.status) ? "responded" : "closed";
  }
  if (!claim.slaDueAt || claim.slaDueAt.getTime() > now.getTime()) return "not_due";
  const escalated = await withSerializableRetry(async (tx) => {
    // Koşullu güncelleme: gecikmeli iş ile süpürücü yarışırsa yalnız biri eskale eder.
    const res = await tx.claim.updateMany({
      where: { id: claim.id, status: "AWAITING_RESPONSE" },
      data: { status: "ESCALATED", escalatedAt: now },
    });
    if (res.count !== 1) return false;
    await tx.claimMessage.create({
      data: {
        claimId: claim.id,
        authorId: SYSTEM_ACTOR,
        role: "SYSTEM",
        body: "SLA_BREACH",
        createdAt: now,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: SYSTEM_ACTOR,
        action: "claim.sla_breach",
        entity: "Claim",
        entityId: claim.id,
        meta: { type: claim.type, slaDueAt: claim.slaDueAt!.toISOString() },
      },
    });
    await emit(tx, EventTypes.ClaimEscalated, claim.id);
    return true;
  });
  if (!escalated) return "responded";
  claimSlaBreachTotal.inc({ type: claim.type });
  logger.warn(
    { alert: "CLAIM_SLA_BREACH", claimId: claim.id, type: claim.type, bookingId: claim.bookingId },
    "claim response SLA breached; escalated to admins"
  );
  return "breached";
}

export async function sweepClaimSla(now = new Date()): Promise<Record<ClaimSlaOutcome, number>> {
  const due = await prisma.claim.findMany({
    where: { status: "AWAITING_RESPONSE", slaDueAt: { lte: now } },
    select: { id: true },
    orderBy: { slaDueAt: "asc" },
    take: 200,
  });
  const counts: Record<ClaimSlaOutcome, number> = {
    breached: 0,
    responded: 0,
    not_due: 0,
    closed: 0,
  };
  for (const { id } of due) counts[await checkClaimSla(id, now)]++;
  return counts;
}

// ---------------------------------------------------------------------------
// Yönetici kararı
// ---------------------------------------------------------------------------

export interface DecisionResult {
  status: ClaimStatus;
  awardedMinor: bigint;
  settledMinor: bigint;
  uncollectedMinor: bigint;
  platformCoveredMinor: bigint;
}

async function withBookingLock<T>(bookingId: string, fn: () => Promise<T>): Promise<T> {
  try {
    // Ödeme/iptal ile aynı anahtar: iptal iadesi ve talep iadesi sıralanır.
    return await redlock.withLock(`pay:${bookingId}`, fn, {
      ttlMs: 30_000,
      retryCount: 100,
      retryDelayMs: 50,
    });
  } catch (error) {
    if (error instanceof LockError) {
      throw new ConflictError(
        "Rezervasyon üzerinde başka bir ödeme işlemi sürüyor",
        "PAYMENT_IN_PROGRESS"
      );
    }
    throw error;
  }
}

/** Hasar talebi kapandıktan sonra depozito tutma süresi dolmuşsa hemen bırak. */
async function releaseAfterDamageClaim(bookingId: string, now: Date): Promise<void> {
  const deposit = await prisma.damageDeposit.findUnique({ where: { bookingId } });
  if (deposit?.status !== "AUTHORIZED") return;
  try {
    await releaseDeposit(deposit.id, now);
  } catch (error) {
    logger.warn(
      { depositId: deposit.id, ...errorFields(error) },
      "deposit release after claim failed"
    );
  }
}

export async function decideClaim(
  admin: AccessClaims,
  claimId: string,
  input: ClaimDecisionInput,
  now = new Date()
): Promise<DecisionResult> {
  const head = await prisma.claim.findUnique({
    where: { id: claimId },
    select: { bookingId: true },
  });
  if (!head) throw new NotFoundError("Talep bulunamadı");
  // Ödeme/iptal ile aynı kilit: çift tıklama ve eşzamanlı iptal iadesi sıralanır; talep kilit
  // İÇİNDE yeniden okunur (ikinci karar CLAIM_CLOSED alır).
  const result = await withBookingLock(head.bookingId, () =>
    decideLocked(admin, claimId, input, now)
  );
  if (result.type === "HOST_DAMAGE") await releaseAfterDamageClaim(head.bookingId, now);
  return result.decision;
}

async function decideLocked(
  admin: AccessClaims,
  claimId: string,
  input: ClaimDecisionInput,
  now: Date
): Promise<{ type: ClaimType; decision: DecisionResult }> {
  const claim = await prisma.claim.findUniqueOrThrow({ where: { id: claimId } });
  if (claim.type === "CHARGEBACK") {
    throw new ClaimError(409, "CLAIM_PSP_MANAGED", "PSP itirazı PSP sonucu ile kapanır");
  }
  assertOpen(claim);
  const requested = claim.amountRequestedMinor;
  let award = 0n;
  if (input.decision === "APPROVE") award = requested;
  if (input.decision === "PARTIAL") {
    award = BigInt(input.amountMinor!);
    if (award >= requested) {
      throw new ValidationError("Kısmi karar tutarı talepten küçük olmalı");
    }
  }
  const status: ClaimStatus =
    input.decision === "APPROVE"
      ? "RESOLVED_APPROVED"
      : input.decision === "PARTIAL"
        ? "RESOLVED_PARTIAL"
        : "RESOLVED_REJECTED";

  const decision =
    claim.type === "GUEST_REFUND"
      ? await settleGuestRefund(admin, claim, status, award, input.note, now)
      : await settleHostDamage(admin, claim, status, award, input.note, now);
  claimsTotal.inc({ type: claim.type, stage: status.toLowerCase() });
  return { type: claim.type, decision };
}

async function finalize(
  tx: Tx,
  admin: AccessClaims,
  claim: Claim,
  status: ClaimStatus,
  note: string,
  now: Date,
  amounts: Omit<DecisionResult, "status">
): Promise<void> {
  const res = await tx.claim.updateMany({
    where: { id: claim.id, status: { in: OPEN_STATUSES } },
    data: {
      status,
      awardedMinor: amounts.awardedMinor,
      settledMinor: amounts.settledMinor,
      uncollectedMinor: amounts.uncollectedMinor,
      platformCoveredMinor: amounts.platformCoveredMinor,
      decisionNote: note,
      decidedById: admin.userId,
      decidedAt: now,
    },
  });
  if (res.count !== 1) throw new ClaimError(409, "CLAIM_CLOSED", "Talep eşzamanlı olarak kapandı");
  await tx.auditLog.create({
    data: {
      actorId: admin.userId,
      action: "claim.decided",
      entity: "Claim",
      entityId: claim.id,
      meta: {
        status,
        awardedMinor: amounts.awardedMinor.toString(),
        settledMinor: amounts.settledMinor.toString(),
        uncollectedMinor: amounts.uncollectedMinor.toString(),
        platformCoveredMinor: amounts.platformCoveredMinor.toString(),
      },
    },
  });
  await emit(tx, EventTypes.ClaimResolved, claim.id);
}

/**
 * Misafir iadesi: PSP iadesi (idempotency `claim-refund:<id>`) → aynı tx'te Payment iade
 * toplamı + iade jurnali (`refund-issued:claim:<id>`). Emanet serbest bırakılmadıysa
 * emanetten; bırakıldıysa ev sahibi payı önce rezervden, sonra kullanılabilir bakiyeden,
 * yetmezse platform üstlenir (ev sahibi bakiyesi eksiye düşmez; `platformCoveredMinor`).
 */
async function settleGuestRefund(
  admin: AccessClaims,
  claim: Claim,
  status: ClaimStatus,
  award: bigint,
  note: string,
  now: Date
): Promise<DecisionResult> {
  const booking = await loadBooking(claim.bookingId);
  if (!booking?.payment)
    throw new ClaimError(409, "CLAIM_NO_PAYMENT", "Rezervasyonun tahsilatı yok");
  const payment = booking.payment;
  const refundable = refundableMinor(booking);
  if (award > refundable) {
    throw new ClaimError(
      422,
      "CLAIM_AMOUNT_EXCEEDS_REFUNDABLE",
      "Karar, iade edilebilir tutarı aşıyor",
      {
        refundableMinor: refundable.toString(),
      }
    );
  }
  const providerRef = payment.providerRef ?? payment.cartPayment?.providerRef ?? null;
  if (award > 0n) {
    if (!providerRef) throw new ClaimError(409, "CLAIM_NO_PAYMENT", "Ödeme referansı yok");
    try {
      await getPaymentProvider().refund(
        providerRef,
        money(minorFromDb(award), booking.currency),
        `claim-refund:${claim.id}`
      );
    } catch (error) {
      if (error instanceof PaymentProviderError) {
        throw new ClaimError(502, "CLAIM_REFUND_FAILED", "Ödeme sağlayıcısı iadeyi reddetti", {
          code: error.code,
        });
      }
      throw error;
    }
  }
  return withSerializableRetry(async (tx) => {
    let platformCover = 0n;
    if (award > 0n) {
      await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${payment.id} FOR UPDATE`;
      const fresh = await tx.payment.findUniqueOrThrow({
        where: { id: payment.id },
        select: { amountMinor: true, refundedAmountMinor: true },
      });
      const refundedAfter = fresh.refundedAmountMinor + award;
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          refundedAmountMinor: refundedAfter,
          refundedAt: now,
          status: refundedAfter >= fresh.amountMinor ? "REFUNDED" : "PARTIALLY_REFUNDED",
        },
      });
      const journal = await postRefundFromEscrow(tx, {
        refundRef: `claim:${claim.id}`,
        bookingId: booking.id,
        paymentId: payment.id,
        guestId: booking.userId,
        currency: booking.currency,
        grossMinor: fresh.amountMinor,
        priceBreakdown: booking.priceBreakdown,
        refundMinor: award,
        refundedBeforeMinor: fresh.refundedAmountMinor,
        occurredAt: now,
      });
      platformCover = journal?.recovery?.platformCoverMinor ?? 0n;
    }
    const amounts = {
      awardedMinor: award,
      settledMinor: award,
      uncollectedMinor: 0n,
      platformCoveredMinor: platformCover,
    };
    await finalize(tx, admin, claim, status, note, now, amounts);
    return { status, ...amounts };
  });
}

/**
 * Hasar tazmini: depozitodan en fazla ön provizyon kadar tahsil (captureDeposit), fazlası
 * yalnız kayıt (`uncollectedMinor`; defterde alacak YOK). Provizyon yok/süresi dolmuşsa tümü
 * tahsil edilemez olarak kaydedilir.
 */
async function settleHostDamage(
  admin: AccessClaims,
  claim: Claim,
  status: ClaimStatus,
  award: bigint,
  note: string,
  now: Date
): Promise<DecisionResult> {
  let settled = 0n;
  if (award > 0n) {
    const deposit = await prisma.damageDeposit.findUnique({
      where: { bookingId: claim.bookingId },
    });
    if (deposit?.status === "AUTHORIZED" && depositAuthValid(deposit, now)) {
      const available = deposit.amountMinor - deposit.capturedMinor;
      const capture = award < available ? award : available;
      if (capture > 0n) settled = (await captureDeposit(deposit.id, capture, now)).capturedMinor;
    }
  }
  const amounts = {
    awardedMinor: award,
    settledMinor: settled,
    uncollectedMinor: award - settled,
    platformCoveredMinor: 0n,
  };
  await withSerializableRetry((tx) => finalize(tx, admin, claim, status, note, now, amounts));
  return { status, ...amounts };
}
