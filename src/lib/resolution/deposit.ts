import type { DamageDeposit, Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { AccessClaims } from "@/lib/auth";
import { getConfig } from "@/lib/config/app-config";
import { withSerializableRetry } from "@/lib/db/transactions";
import { assertPropertyAccess } from "@/lib/host/host-service";
import { HttpError, NotFoundError, ValidationError } from "@/lib/http/errors";
import { post } from "@/lib/ledger";
import { minorFromDb, money } from "@/lib/money/money";
import { errorFields, logger } from "@/lib/observability/logger";
import { counter } from "@/lib/observability/metrics";
import { getPaymentProvider, PaymentProviderError } from "@/lib/payment";
import { prisma } from "@/lib/prisma";
import { getQueue, QUEUE_NAMES } from "@/lib/queue";
import { checkInAt, checkOutAt, clockOf, fromDate } from "@/lib/time/nights";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * P1-5 hasar depozitosu (ADR 0021 §Depozito).
 *
 * Ev sahibi ilan geneli ya da oda tipine özel depozito tutarı belirler. Onaylı rezervasyon
 * için tesisin YEREL giriş anından `DEPOSIT_PREAUTH_HOURS_BEFORE` saat önce, asıl tahsilatın
 * kartıyla AYRI bir ön provizyon (manuel capture) alınır. Yerel çıkış + `DEPOSIT_HOLD_DAYS`
 * sonra açık hasar talebi yoksa provizyon bırakılır (BullMQ gecikmeli iş + yedek süpürücü).
 * Hasar talebi onaylanınca en fazla ön provizyon kadar tahsil edilir (DB CHECK + kod + PSP);
 * aşan tazmin yalnız talep kaydında tutulur. PSP provizyonu `DEPOSIT_AUTH_VALID_DAYS` sonra
 * düşer → EXPIRED (tahsil edilemez).
 */

export const DEPOSIT_VOID_JOB = "deposit-void";
export const DEPOSIT_SWEEP_JOB = "deposit-sweep";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
/** UTC ön filtresi için saat dilimi payı (en uç dilim farkı + giriş saati). */
const TIMEZONE_SLACK_MS = 36 * HOUR_MS;
const OPEN_CLAIM_STATUSES = ["OPEN", "AWAITING_RESPONSE", "ESCALATED"] as const;

export const depositEventsTotal = counter(
  "damage_deposit_events_total",
  "Hasar depozitosu olayları (authorized/declined/captured/voided/expired)",
  ["outcome"] as const
);

export class DepositCaptureError extends HttpError {
  constructor(code: string, message: string, details?: unknown) {
    super(422, code, message, details);
    this.name = "DepositCaptureError";
  }
}

// ---------------------------------------------------------------------------
// Ayarlar (ev sahibi)
// ---------------------------------------------------------------------------

export const depositSettingSchema = z.object({
  /** null → oda tipi (ya da ilan geneli) ayarını kaldır. */
  amountMinor: z.number().int().positive().nullable(),
  roomTypeId: z.string().trim().min(1).max(64).nullable().optional(),
});
export type DepositSettingInput = z.infer<typeof depositSettingSchema>;

export interface DepositSettingView {
  roomTypeId: string | null;
  roomName: string | null;
  amountMinor: number | null;
}

export async function listDepositSettings(
  actor: AccessClaims,
  propertyId: string
): Promise<{ currency: string; settings: DepositSettingView[]; maxMinor: number }> {
  const property = await assertPropertyAccess(actor, propertyId);
  const [rooms, rows] = await Promise.all([
    prisma.roomType.findMany({
      where: { propertyId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.damageDepositSetting.findMany({ where: { propertyId } }),
  ]);
  const byRoom = new Map(rows.map((r) => [r.roomTypeId, minorFromDb(r.amountMinor)]));
  return {
    currency: property.currency,
    maxMinor: getConfig().DEPOSIT_MAX_MINOR,
    settings: [
      { roomTypeId: null, roomName: null, amountMinor: byRoom.get(null) ?? null },
      ...rooms.map((r) => ({
        roomTypeId: r.id,
        roomName: r.name,
        amountMinor: byRoom.get(r.id) ?? null,
      })),
    ],
  };
}

export async function setDepositSetting(
  actor: AccessClaims,
  propertyId: string,
  input: DepositSettingInput
): Promise<DepositSettingView> {
  await assertPropertyAccess(actor, propertyId);
  const roomTypeId = input.roomTypeId ?? null;
  let roomName: string | null = null;
  if (roomTypeId) {
    const room = await prisma.roomType.findUnique({
      where: { id: roomTypeId },
      select: { propertyId: true, name: true },
    });
    if (!room || room.propertyId !== propertyId) throw new NotFoundError("Oda tipi bulunamadı");
    roomName = room.name;
  }
  const max = getConfig().DEPOSIT_MAX_MINOR;
  if (input.amountMinor !== null && input.amountMinor > max) {
    throw new ValidationError(`Depozito en fazla ${max} (minor-unit) olabilir`);
  }
  await withSerializableRetry(async (tx) => {
    const existing = await tx.damageDepositSetting.findFirst({
      where: { propertyId, roomTypeId },
      select: { id: true },
    });
    if (input.amountMinor === null) {
      if (existing) await tx.damageDepositSetting.delete({ where: { id: existing.id } });
    } else if (existing) {
      await tx.damageDepositSetting.update({
        where: { id: existing.id },
        data: { amountMinor: BigInt(input.amountMinor), updatedById: actor.userId },
      });
    } else {
      await tx.damageDepositSetting.create({
        data: {
          propertyId,
          roomTypeId,
          amountMinor: BigInt(input.amountMinor),
          updatedById: actor.userId,
        },
      });
    }
  });
  return { roomTypeId, roomName, amountMinor: input.amountMinor };
}

/** Rezervasyonun depozito tutarı: oda tipi ayarı ilan genelini ezer; oda adedi ile çarpılır. */
export async function depositAmountFor(
  db: Db,
  booking: { propertyId: string; roomId: string; units: number }
): Promise<bigint | null> {
  const rows = await db.damageDepositSetting.findMany({
    where: {
      propertyId: booking.propertyId,
      OR: [{ roomTypeId: booking.roomId }, { roomTypeId: null }],
    },
    select: { roomTypeId: true, amountMinor: true },
  });
  const chosen = rows.find((r) => r.roomTypeId === booking.roomId) ?? rows[0];
  if (!chosen) return null;
  return chosen.amountMinor * BigInt(Math.max(1, booking.units));
}

// ---------------------------------------------------------------------------
// Yaşam döngüsü
// ---------------------------------------------------------------------------

export function depositWindow(
  booking: { checkIn: Date; checkOut: Date },
  property: { timeZone: string | null; checkInTime: string | null; checkOutTime: string | null },
  cfg = getConfig()
): { authorizeAfter: Date; voidAfter: Date } {
  const clock = clockOf(property);
  const inAt = checkInAt(fromDate(booking.checkIn), clock);
  const outAt = checkOutAt(fromDate(booking.checkOut), clock);
  return {
    authorizeAfter: new Date(inAt.getTime() - cfg.DEPOSIT_PREAUTH_HOURS_BEFORE * HOUR_MS),
    voidAfter: new Date(outAt.getTime() + cfg.DEPOSIT_HOLD_DAYS * DAY_MS),
  };
}

/** Provizyon PSP'de hâlâ geçerli mi (Stripe kart provizyonu ~7 gün). */
export function depositAuthValid(
  d: Pick<DamageDeposit, "authorizedAt">,
  now: Date,
  cfg = getConfig()
): boolean {
  return (
    !!d.authorizedAt &&
    d.authorizedAt.getTime() + cfg.DEPOSIT_AUTH_VALID_DAYS * DAY_MS > now.getTime()
  );
}

/**
 * Girişi yaklaşan onaylı rezervasyonlar için depozito kaydı açar (SCHEDULED). Ayarı olmayan
 * ilan için kayıt yok. İdempotent (bookingId tekil).
 */
export async function ensureDeposits(
  now = new Date(),
  opts: { bookingIds?: string[]; limit?: number } = {}
): Promise<number> {
  const cfg = getConfig();
  const horizon = new Date(
    now.getTime() + cfg.DEPOSIT_PREAUTH_HOURS_BEFORE * HOUR_MS + TIMEZONE_SLACK_MS
  );
  const propertyIds = (
    await prisma.damageDepositSetting.findMany({
      distinct: ["propertyId"],
      select: { propertyId: true },
    })
  ).map((r) => r.propertyId);
  if (propertyIds.length === 0) return 0;
  const candidates = await prisma.booking.findMany({
    where: {
      status: "CONFIRMED",
      checkIn: { lte: horizon },
      checkOut: { gte: new Date(now.getTime() - DAY_MS) },
      propertyId: { in: propertyIds },
      ...(opts.bookingIds ? { id: { in: opts.bookingIds } } : {}),
    },
    select: {
      id: true,
      propertyId: true,
      roomId: true,
      units: true,
      checkIn: true,
      checkOut: true,
      currency: true,
      property: { select: { timeZone: true, checkInTime: true, checkOutTime: true } },
    },
    take: opts.limit ?? 500,
  });
  if (candidates.length === 0) return 0;
  const existing = new Set(
    (
      await prisma.damageDeposit.findMany({
        where: { bookingId: { in: candidates.map((c) => c.id) } },
        select: { bookingId: true },
      })
    ).map((d) => d.bookingId)
  );
  const provider = getPaymentProvider().name;
  let created = 0;
  for (const b of candidates) {
    if (existing.has(b.id)) continue;
    const amount = await depositAmountFor(prisma, b);
    if (!amount || amount <= 0n) continue;
    const window = depositWindow(b, b.property, cfg);
    const res = await prisma.damageDeposit.createMany({
      data: [
        {
          bookingId: b.id,
          amountMinor: amount,
          currency: b.currency,
          provider,
          authorizeAfter: window.authorizeAfter,
          voidAfter: window.voidAfter,
        },
      ],
      skipDuplicates: true,
    });
    created += res.count;
  }
  return created;
}

/**
 * Depozitonun kartı: rezervasyonun kendi tahsilatı, sepet tahsilatı ya da (fix-sweep-2)
 * bölünmüş ödemede ORGANİZATÖRÜN payı. Gerekçe: rezervasyonların sahibi ve konaklamadan
 * sorumlu taraf organizatördür; katılımcı kartları yalnız kendi payları için yetkilendirildi
 * (depozito onayı vermediler). Organizatörün asıl payı ödenmediyse yedek (fallback) payı.
 */
async function sourcePaymentRef(bookingId: string): Promise<string | null> {
  const payment = await prisma.payment.findUnique({
    where: { bookingId },
    select: {
      providerRef: true,
      status: true,
      cartPayment: { select: { id: true, providerRef: true } },
    },
  });
  if (!payment || !["PAID", "PARTIALLY_REFUNDED"].includes(payment.status)) return null;
  const direct = payment.providerRef ?? payment.cartPayment?.providerRef ?? null;
  if (direct || !payment.cartPayment) return direct;
  const share = await prisma.paymentShare.findFirst({
    where: {
      cartPaymentId: payment.cartPayment.id,
      plan: { status: "SETTLED" },
      OR: [{ position: 0 }, { isFallback: true }],
      status: { in: ["CAPTURED", "REFUNDED"] },
      providerRef: { not: null },
    },
    orderBy: [{ status: "asc" }, { position: "asc" }],
    select: { providerRef: true },
  });
  return share?.providerRef ?? null;
}

export type AuthorizeOutcome = "authorized" | "declined" | "failed" | "skipped" | "not_due";

/**
 * Tek depozitoyu ön provizyona alır (PSP çağrısı tx dışında, idempotency anahtarı
 * `deposit:<id>` → yarışan süpürücüler aynı PSP kaydını görür; koşullu güncelleme tek yazar).
 */
export async function authorizeDeposit(
  depositId: string,
  now = new Date()
): Promise<AuthorizeOutcome> {
  const deposit = await prisma.damageDeposit.findUnique({ where: { id: depositId } });
  if (!deposit || deposit.status !== "SCHEDULED") return "skipped";
  if (deposit.authorizeAfter.getTime() > now.getTime()) return "not_due";
  const booking = await prisma.booking.findUnique({
    where: { id: deposit.bookingId },
    select: { status: true },
  });
  if (!booking || !["CONFIRMED", "COMPLETED"].includes(booking.status)) {
    await prisma.damageDeposit.updateMany({
      where: { id: deposit.id, status: "SCHEDULED" },
      data: { status: "VOIDED", voidedAt: now, failureCode: "BOOKING_NOT_ACTIVE" },
    });
    return "skipped";
  }
  const provider = getPaymentProvider();
  const source = await sourcePaymentRef(deposit.bookingId);
  const fail = async (code: string): Promise<AuthorizeOutcome> => {
    await prisma.damageDeposit.updateMany({
      where: { id: deposit.id, status: "SCHEDULED" },
      data: { status: "FAILED", failureCode: code, sourcePaymentRef: source },
    });
    depositEventsTotal.inc({ outcome: "declined" });
    logger.warn({ depositId: deposit.id, code }, "damage deposit pre-auth failed");
    return code === "card_declined" ? "declined" : "failed";
  };
  if (!source) return fail("NO_SOURCE_PAYMENT");
  if (!provider.authorizeHold) return fail("PROVIDER_UNSUPPORTED");
  let result;
  try {
    result = await provider.authorizeHold({
      amount: money(minorFromDb(deposit.amountMinor), deposit.currency),
      sourceProviderRef: source,
      idempotencyKey: `deposit:${deposit.id}`,
      metadata: { bookingId: deposit.bookingId, depositId: deposit.id },
    });
  } catch (error) {
    if (error instanceof PaymentProviderError) return fail(error.code);
    throw error;
  }
  if (result.status !== "authorized") {
    return fail(result.status === "declined" ? result.declineCode : "requires_action");
  }
  const updated = await prisma.damageDeposit.updateMany({
    where: { id: deposit.id, status: "SCHEDULED" },
    data: {
      status: "AUTHORIZED",
      providerRef: result.providerRef,
      sourcePaymentRef: source,
      authorizedAt: now,
    },
  });
  if (updated.count === 1) {
    depositEventsTotal.inc({ outcome: "authorized" });
    await scheduleDepositVoid({ id: deposit.id, voidAfter: deposit.voidAfter }, now);
    return "authorized";
  }
  return "skipped";
}

/** Çıkış + DEPOSIT_HOLD_DAYS anında void kontrolü (depozito başına tek gecikmeli iş). */
export async function scheduleDepositVoid(
  deposit: Pick<DamageDeposit, "id" | "voidAfter">,
  now = new Date()
): Promise<void> {
  try {
    await getQueue(QUEUE_NAMES.resolution).add(
      DEPOSIT_VOID_JOB,
      { depositId: deposit.id },
      {
        jobId: `deposit-void-${deposit.id}`,
        delay: Math.max(0, deposit.voidAfter.getTime() - now.getTime()),
        attempts: 5,
        backoff: { type: "exponential", delay: 10_000 },
        removeOnComplete: true,
        removeOnFail: 1000,
      }
    );
  } catch (error) {
    logger.warn(
      { depositId: deposit.id, ...errorFields(error) },
      "deposit void job could not be scheduled; sweep will handle it"
    );
  }
}

async function hasOpenDamageClaim(bookingId: string): Promise<boolean> {
  return (
    (await prisma.claim.count({
      where: { bookingId, type: "HOST_DAMAGE", status: { in: [...OPEN_CLAIM_STATUSES] } },
    })) > 0
  );
}

export type ReleaseOutcome = "voided" | "expired" | "held_by_claim" | "not_due" | "skipped";

/**
 * Void kontrolü: (a) rezervasyon iptal edildiyse hemen, (b) süre dolduysa ve açık hasar
 * talebi yoksa bırakılır. Açık talep varken tutulur (karar sonrası bırakılır). PSP provizyonu
 * zaten düşmüşse EXPIRED.
 */
export async function releaseDeposit(
  depositId: string,
  now = new Date(),
  opts: { force?: boolean } = {}
): Promise<ReleaseOutcome> {
  const deposit = await prisma.damageDeposit.findUnique({ where: { id: depositId } });
  if (!deposit || deposit.status !== "AUTHORIZED" || !deposit.providerRef) return "skipped";
  const booking = await prisma.booking.findUnique({
    where: { id: deposit.bookingId },
    select: { status: true },
  });
  const cancelled = !booking || ["CANCELLED", "EXPIRED"].includes(booking.status);
  if (!opts.force && !cancelled && deposit.voidAfter.getTime() > now.getTime()) return "not_due";
  if (!cancelled && (await hasOpenDamageClaim(deposit.bookingId))) return "held_by_claim";

  if (!depositAuthValid(deposit, now)) {
    const res = await prisma.damageDeposit.updateMany({
      where: { id: deposit.id, status: "AUTHORIZED" },
      data: { status: "EXPIRED", expiredAt: now },
    });
    if (res.count === 1) depositEventsTotal.inc({ outcome: "expired" });
    return res.count === 1 ? "expired" : "skipped";
  }
  await getPaymentProvider().void(deposit.providerRef);
  const res = await prisma.damageDeposit.updateMany({
    where: { id: deposit.id, status: "AUTHORIZED" },
    data: { status: "VOIDED", voidedAt: now },
  });
  if (res.count === 1) depositEventsTotal.inc({ outcome: "voided" });
  return res.count === 1 ? "voided" : "skipped";
}

export interface CaptureResult {
  capturedMinor: bigint;
  status: "CAPTURED" | "CAPTURED_PARTIAL";
}

/**
 * Hasar talebi kararı: depozitodan `amountMinor` tahsil eder. Tutar ön provizyonu AŞAMAZ
 * (422 DEPOSIT_CAPTURE_EXCEEDS_AUTH; ayrıca DB CHECK). PSP capture tx dışında; ardından aynı
 * SERIALIZABLE tx'te koşullu durum geçişi + `depositCaptured` jurnali.
 */
export async function captureDeposit(
  depositId: string,
  amountMinor: bigint,
  now = new Date()
): Promise<CaptureResult> {
  const deposit = await prisma.damageDeposit.findUnique({ where: { id: depositId } });
  if (!deposit) throw new NotFoundError("Depozito bulunamadı");
  if (amountMinor <= 0n) throw new ValidationError("Tahsil tutarı pozitif olmalı");
  if (deposit.status !== "AUTHORIZED" || !deposit.providerRef) {
    throw new DepositCaptureError("DEPOSIT_NOT_AUTHORIZED", "Depozito provizyonda değil", {
      status: deposit.status,
    });
  }
  if (amountMinor > deposit.amountMinor - deposit.capturedMinor) {
    throw new DepositCaptureError(
      "DEPOSIT_CAPTURE_EXCEEDS_AUTH",
      "Tahsil tutarı ön provizyon tutarını aşamaz",
      { authorizedMinor: deposit.amountMinor.toString(), requestedMinor: amountMinor.toString() }
    );
  }
  if (!depositAuthValid(deposit, now)) {
    await prisma.damageDeposit.updateMany({
      where: { id: deposit.id, status: "AUTHORIZED" },
      data: { status: "EXPIRED", expiredAt: now },
    });
    depositEventsTotal.inc({ outcome: "expired" });
    throw new DepositCaptureError("DEPOSIT_EXPIRED", "Depozito provizyonunun süresi dolmuş");
  }
  const property = await prisma.booking.findUnique({
    where: { id: deposit.bookingId },
    select: { property: { select: { hostId: true } } },
  });
  if (!property) throw new NotFoundError("Rezervasyon bulunamadı");

  await getPaymentProvider().capture(
    deposit.providerRef,
    money(minorFromDb(amountMinor), deposit.currency)
  );
  const status = amountMinor === deposit.amountMinor ? "CAPTURED" : "CAPTURED_PARTIAL";
  await withSerializableRetry(async (tx) => {
    const res = await tx.damageDeposit.updateMany({
      where: { id: deposit.id, status: "AUTHORIZED" },
      data: { status, capturedMinor: amountMinor, capturedAt: now },
    });
    if (res.count !== 1) {
      throw new DepositCaptureError("DEPOSIT_NOT_AUTHORIZED", "Depozito eşzamanlı değişti");
    }
    await post.depositCaptured(tx, {
      depositId: deposit.id,
      bookingId: deposit.bookingId,
      hostId: property.property.hostId,
      currency: deposit.currency,
      amountMinor,
      occurredAt: now,
    });
  });
  depositEventsTotal.inc({ outcome: "captured" });
  return { capturedMinor: amountMinor, status };
}

export interface DepositSweepResult {
  created: number;
  authorized: number;
  failed: number;
  voided: number;
  expired: number;
}

/** Tekrarlayan süpürücü: kayıt aç → vadesi gelenleri provizyona al → vadesi geçenleri bırak. */
export async function sweepDeposits(
  now = new Date(),
  opts: { bookingIds?: string[] } = {}
): Promise<DepositSweepResult> {
  const out: DepositSweepResult = { created: 0, authorized: 0, failed: 0, voided: 0, expired: 0 };
  out.created = await ensureDeposits(now, opts);
  const scope = opts.bookingIds ? { bookingId: { in: opts.bookingIds } } : {};
  const due = await prisma.damageDeposit.findMany({
    where: { status: "SCHEDULED", authorizeAfter: { lte: now }, ...scope },
    select: { id: true },
    take: 200,
  });
  for (const { id } of due) {
    try {
      const r = await authorizeDeposit(id, now);
      if (r === "authorized") out.authorized++;
      else if (r === "declined" || r === "failed") out.failed++;
    } catch (error) {
      logger.error({ depositId: id, ...errorFields(error) }, "deposit pre-auth errored");
    }
  }
  const held = await prisma.damageDeposit.findMany({
    where: { status: "AUTHORIZED", ...scope },
    select: { id: true, voidAfter: true, authorizedAt: true, bookingId: true },
    orderBy: { voidAfter: "asc" },
    take: 500,
  });
  for (const d of held) {
    try {
      const r = await releaseDeposit(d.id, now);
      if (r === "voided") out.voided++;
      else if (r === "expired") out.expired++;
    } catch (error) {
      logger.error({ depositId: d.id, ...errorFields(error) }, "deposit release errored");
    }
  }
  return out;
}

export interface DepositView {
  id: string;
  amountMinor: number;
  capturedMinor: number;
  currency: string;
  status: DamageDeposit["status"];
  authorizeAfter: string;
  voidAfter: string;
  authorizedAt: string | null;
}

export function toDepositView(d: DamageDeposit): DepositView {
  return {
    id: d.id,
    amountMinor: minorFromDb(d.amountMinor),
    capturedMinor: minorFromDb(d.capturedMinor),
    currency: d.currency,
    status: d.status,
    authorizeAfter: d.authorizeAfter.toISOString(),
    voidAfter: d.voidAfter.toISOString(),
    authorizedAt: d.authorizedAt?.toISOString() ?? null,
  };
}

export { OPEN_CLAIM_STATUSES };
