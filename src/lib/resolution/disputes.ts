import type { ClaimStatus } from "@prisma/client";
import { appendOutbox } from "@/lib/cqrs/outbox";
import { withSerializableRetry } from "@/lib/db/transactions";
import { EventTypes, makeEvent, type ClaimEventPayload } from "@/lib/events/events";
import { isCurrencyCode } from "@/lib/money/money";
import { logger } from "@/lib/observability/logger";
import { counter } from "@/lib/observability/metrics";
import { signWebhook, type WebhookEvent } from "@/lib/payment/webhook";
import { prisma } from "@/lib/prisma";

/**
 * P1-5: PSP itirazı (Stripe `charge.dispute.created|updated|closed`) → CHARGEBACK talebi.
 * İmza doğrulaması webhook route'unda aktif sağlayıcının şemasıyla yapılır (v4#16); burada
 * yalnız doğrulanmış iç olay işlenir. Olay kimliği `PaymentEvent`'e AYNI tx'te yazılır
 * (replay etkisiz). Talep itiraz kimliğiyle (`externalRef`) tekildir → sıra dışı gelen olaylar
 * (closed önce) de doğru son durumu üretir.
 *
 * Kapanış eşlemesi: `won` → RESOLVED_REJECTED (itiraz reddedildi, para platformda kaldı),
 * `lost` → RESOLVED_APPROVED (para karta döndü; tutar `awardedMinor`), diğer (`warning_closed`
 * vb.) → CLOSED. Açılışta ESCALATED + yönetici bildirimi (itiraz kanıt süresi PSP'dedir).
 */

export const chargebackEventsTotal = counter(
  "chargeback_events_total",
  "PSP itiraz (chargeback) webhook olayları",
  ["type", "outcome"] as const
);

const SYSTEM_ACTOR = "system:psp-dispute";

export function closedStatusFor(disputeStatus: string | undefined): ClaimStatus {
  if (disputeStatus === "won") return "RESOLVED_REJECTED";
  if (disputeStatus === "lost") return "RESOLVED_APPROVED";
  return "CLOSED";
}

async function bookingForRef(
  providerRef: string
): Promise<{ bookingId: string; hostId: string; currency: string } | null> {
  const payment = await prisma.payment.findUnique({
    where: { providerRef },
    select: {
      bookingId: true,
      booking: { select: { currency: true, property: { select: { hostId: true } } } },
    },
  });
  if (payment) {
    return {
      bookingId: payment.bookingId,
      hostId: payment.booking.property.hostId,
      currency: payment.booking.currency,
    };
  }
  // P1-1 sepet: tek PSP tahsilatı → itiraz sepetin ilk rezervasyonuna bağlanır. P1-2 bölünmüş
  // ödemede her pay ayrı PSP işlemidir → payın sepetine bağlanır.
  const share = await prisma.paymentShare.findUnique({
    where: { providerRef },
    select: { cartPaymentId: true },
  });
  const cart = await prisma.cartPayment.findFirst({
    where: share ? { id: share.cartPaymentId } : { providerRef },
    select: { cartId: true },
  });
  if (!cart) return null;
  const booking = await prisma.booking.findFirst({
    where: { cartId: cart.cartId },
    orderBy: { createdAt: "asc" },
    select: { id: true, currency: true, property: { select: { hostId: true } } },
  });
  return booking
    ? { bookingId: booking.id, hostId: booking.property.hostId, currency: booking.currency }
    : null;
}

export function isDisputeEvent(event: WebhookEvent): boolean {
  return event.type.startsWith("dispute.");
}

export async function handleDisputeEvent(
  event: WebhookEvent,
  now = new Date()
): Promise<{ duplicate: boolean; claimId?: string }> {
  if (await prisma.paymentEvent.findUnique({ where: { id: event.id }, select: { id: true } })) {
    return { duplicate: true };
  }
  const record = { id: event.id, type: event.type, providerRef: event.data.providerRef };
  const target = await bookingForRef(event.data.providerRef);
  const disputeId = event.data.disputeId;
  if (!target || !disputeId) {
    logger.warn({ eventId: event.id, type: event.type }, "dispute for unknown payment");
    await prisma.paymentEvent.create({ data: record });
    chargebackEventsTotal.inc({ type: event.type, outcome: "unknown_payment" });
    return { duplicate: false };
  }
  const amount = BigInt(Math.max(0, event.data.amount ?? 0));
  const currency =
    event.data.currency && isCurrencyCode(event.data.currency)
      ? event.data.currency
      : target.currency;
  const closing = event.type === "dispute.closed";
  const closedStatus = closedStatusFor(event.data.disputeStatus);

  const claimId = await withSerializableRetry(async (tx) => {
    await tx.paymentEvent.create({ data: record });
    const existing = await tx.claim.findUnique({ where: { externalRef: disputeId } });
    let id: string;
    let created = false;
    if (!existing) {
      const row = await tx.claim.create({
        data: {
          bookingId: target.bookingId,
          type: "CHARGEBACK",
          openedById: null,
          respondentId: target.hostId,
          amountRequestedMinor: amount,
          currency,
          description: `PSP itirazı (${event.data.reason ?? "unspecified"})`,
          status: closing ? closedStatus : "ESCALATED",
          escalatedAt: now,
          externalRef: disputeId,
          externalStatus: event.data.disputeStatus ?? null,
          externalReason: event.data.reason ?? null,
          ...(closing
            ? { decidedAt: now, awardedMinor: closedStatus === "RESOLVED_APPROVED" ? amount : 0n }
            : {}),
          createdAt: now,
        },
      });
      id = row.id;
      created = true;
    } else {
      id = existing.id;
      const alreadyClosed = !["OPEN", "AWAITING_RESPONSE", "ESCALATED"].includes(existing.status);
      await tx.claim.update({
        where: { id },
        data: {
          externalStatus: event.data.disputeStatus ?? existing.externalStatus,
          externalReason: event.data.reason ?? existing.externalReason,
          ...(amount > 0n ? { amountRequestedMinor: amount } : {}),
          ...(closing && !alreadyClosed
            ? {
                status: closedStatus,
                decidedAt: now,
                awardedMinor:
                  closedStatus === "RESOLVED_APPROVED"
                    ? amount || existing.amountRequestedMinor
                    : 0n,
              }
            : {}),
        },
      });
    }
    await tx.claimMessage.create({
      data: {
        claimId: id,
        authorId: SYSTEM_ACTOR,
        role: "SYSTEM",
        body: `PSP_${event.type.toUpperCase().replace(".", "_")}:${event.data.disputeStatus ?? ""}`,
        createdAt: now,
      },
    });
    if (created && !closing) {
      await appendOutbox(
        tx,
        makeEvent<ClaimEventPayload>(EventTypes.ClaimEscalated, id, "claim", { claimId: id })
      );
    }
    if (closing) {
      await appendOutbox(
        tx,
        makeEvent<ClaimEventPayload>(EventTypes.ClaimResolved, id, "claim", { claimId: id })
      );
    }
    return id;
  });
  chargebackEventsTotal.inc({ type: event.type, outcome: "applied" });
  return { duplicate: false, claimId };
}

/**
 * Mock PSP için İMZALI itiraz olayı (demo/test): gövde + `x-psp-signature` başlığı.
 * Gerçek Stripe itirazıyla aynı iç biçim; webhook route'u aynı yoldan işler.
 */
export function mockDisputeWebhook(input: {
  eventId: string;
  type: "dispute.created" | "dispute.updated" | "dispute.closed";
  providerRef: string;
  disputeId: string;
  amountMinor: number;
  currency: string;
  status?: string;
  reason?: string;
  timestamp?: number;
  secret?: string;
}): { body: string; headers: Record<string, string> } {
  const body = JSON.stringify({
    id: input.eventId,
    type: input.type,
    data: {
      providerRef: input.providerRef,
      amount: input.amountMinor,
      currency: input.currency,
      disputeId: input.disputeId,
      disputeStatus: input.status,
      reason: input.reason,
    },
  });
  const ts = input.timestamp ?? Math.floor(Date.now() / 1000);
  const signature = input.secret ? signWebhook(body, ts, input.secret) : signWebhook(body, ts);
  return { body, headers: { "content-type": "application/json", "x-psp-signature": signature } };
}
