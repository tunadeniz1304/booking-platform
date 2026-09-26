import "server-only";
import { prisma } from "@/lib/prisma";
import { withSerializableRetry } from "@/lib/db/transactions";
import { appendOutbox } from "@/lib/cqrs/outbox";
import {
  EventTypes,
  makeEvent,
  type BookingCreatedPayload,
  type PartyRiskFlaggedPayload,
} from "@/lib/events/events";
import { getConfig } from "@/lib/config/app-config";
import { counter } from "@/lib/observability/metrics";
import { logger } from "@/lib/observability/logger";
import type { AccessClaims } from "@/lib/auth/tokens";
import { scorePartyRisk, type PartyRiskReason } from "./party-risk";

/**
 * Parti riski — rezervasyon akışına dokunmadan bağlanır: `booking.created` outbox olayının
 * tüketicisi değerlendirir (booking-service değişmez). Eşik üstünde aynı işlemde
 * `trust.party_risk_flagged` outbox olayı yazılır → ev sahibine e-posta
 * (`notifyHostPartyRisk`) ve host panelinde listeleme.
 *
 * Karar: "host onay adımı" UYGULANMADI — mevcut HELD→CONFIRMED durum makinesine yeni bir
 * bekleme durumu eklemek ödeme sagasını/iade akışını etkiler. Şimdilik yalnızca uyarı +
 * host paneli; ev sahibi mevcut iptal politikalarıyla hareket edebilir.
 */

const assessed = counter("party_risk_assessments_total", "Parti riski değerlendirmeleri", [
  "outcome",
] as const);

export interface PartyRiskAssessmentView {
  bookingId: string;
  score: number;
  reasons: PartyRiskReason[];
  flagged: boolean;
}

/** `booking.created` tüketicisi: idempotent (rezervasyon başına tek satır). */
export async function assessBookingPartyRisk(
  bookingId: string
): Promise<PartyRiskAssessmentView | null> {
  const cfg = getConfig();
  if (!cfg.PARTY_RISK_ENABLED) return null;
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      userId: true,
      propertyId: true,
      checkIn: true,
      checkOut: true,
      guestCount: true,
      createdAt: true,
      user: { select: { createdAt: true } },
      property: { select: { hostId: true } },
    },
  });
  if (!booking) return null;
  const result = scorePartyRisk(
    {
      accountCreatedAt: booking.user.createdAt,
      bookedAt: booking.createdAt,
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
      guestCount: booking.guestCount,
    },
    cfg
  );
  const row = await withSerializableRetry(async (tx) => {
    const existing = await tx.partyRiskAssessment.findUnique({ where: { bookingId } });
    if (existing) return { row: existing, created: false };
    const created = await tx.partyRiskAssessment.create({
      data: {
        bookingId,
        propertyId: booking.propertyId,
        hostId: booking.property.hostId,
        guestId: booking.userId,
        score: result.score,
        reasons: result.reasons,
        flagged: result.flagged,
      },
    });
    if (result.flagged) {
      await tx.auditLog.create({
        data: {
          actorId: "system:party-risk",
          action: "booking.party_risk_flagged",
          entity: "booking",
          entityId: bookingId,
          meta: { score: result.score, contributions: result.contributions },
        },
      });
      await appendOutbox(
        tx,
        makeEvent<PartyRiskFlaggedPayload>(EventTypes.PartyRiskFlagged, bookingId, "booking", {
          bookingId,
          hostId: booking.property.hostId,
          propertyId: booking.propertyId,
        })
      );
    }
    return { row: created, created: true };
  });
  if (row.created) assessed.inc({ outcome: result.flagged ? "flagged" : "clear" });
  return {
    bookingId,
    score: row.row.score,
    reasons: row.row.reasons as PartyRiskReason[],
    flagged: row.row.flagged,
  };
}

/** Outbox tüketicisi (`booking.created`). */
export async function onBookingCreatedPartyRisk(p: BookingCreatedPayload): Promise<void> {
  const res = await assessBookingPartyRisk(p.bookingId);
  if (res?.flagged) {
    logger.info(
      { bookingId: p.bookingId, score: res.score, reasons: res.reasons },
      "party risk flagged"
    );
  }
}

/** Ev sahibi paneli: sahibi olduğu ilanlardaki işaretli, iptal edilmemiş rezervasyonlar. */
export async function listHostPartyRisks(actor: AccessClaims, now = new Date()) {
  const rows = await prisma.partyRiskAssessment.findMany({
    where: { flagged: true, ...(actor.role === "ADMIN" ? {} : { hostId: actor.userId }) },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  if (rows.length === 0) return [];
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const bookings = await prisma.booking.findMany({
    where: {
      id: { in: rows.map((r) => r.bookingId) },
      status: { in: ["HELD", "CONFIRMED"] },
      checkOut: { gte: today },
    },
    select: {
      id: true,
      status: true,
      checkIn: true,
      checkOut: true,
      guestCount: true,
      property: { select: { title: true } },
    },
  });
  const byId = new Map(bookings.map((b) => [b.id, b]));
  return rows.flatMap((r) => {
    const b = byId.get(r.bookingId);
    if (!b) return [];
    return [
      {
        bookingId: r.bookingId,
        propertyTitle: b.property.title,
        status: b.status,
        checkIn: b.checkIn.toISOString().slice(0, 10),
        checkOut: b.checkOut.toISOString().slice(0, 10),
        guestCount: b.guestCount,
        score: r.score,
        reasons: r.reasons,
        notifiedAt: r.notifiedAt?.toISOString() ?? null,
      },
    ];
  });
}
