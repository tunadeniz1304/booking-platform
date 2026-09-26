import { createHash } from "node:crypto";
import { Prisma, type CheckoutSession } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getConfig } from "@/lib/config/app-config";
import { ConflictError, NotFoundError } from "@/lib/http/errors";
import { createQuote, type Quote } from "@/lib/pricing/quote";
import { createBooking } from "@/lib/booking-service";
import { payForBooking, type PayOutcome } from "@/lib/payment/payment-service";
import type { PaymentChallenge } from "@/lib/payment/provider";
import { logger } from "@/lib/observability/logger";
import { authorizeMandate, type AuthorizeMandateDeps } from "./mandate";
import { activeSptProvider, sptToCardToken } from "./spt";

export { sptToCardToken } from "./spt";

/**
 * Ajan checkout oturumları (P1-11, Agentic Commerce Protocol benzeri).
 *
 * Akış: create (teklif) → update (tarih/misafir değişirse yeniden teklif) → complete
 * (ödeme). Tamamlama, web checkout'u ile AYNI saga yolundan geçer:
 * `createQuote` → `createBooking` (HELD, idempotency `acs:<id>`) → `payForBooking`.
 * Ajan fiyat belirlemez; tutarlar her zaman deterministik teklif servisinden gelir.
 *
 * Güvenlik:
 *  - Oturum yalnızca sahibine görünür (başkası için 404, varlık sızdırılmaz).
 *  - Oluşturma `Idempotency-Key` ile tekildir; aynı anahtar + farklı gövde → 409.
 *  - Ödeme verisi yalnızca paylaşılan ödeme token'ı (SPT): Stripe aktifse gerçek Stripe
 *    Shared Payment Token (`spt.ts`), değilse demo `spt_mock_<ok|decline|3ds>` (ADR 0023).
 *  - Tamamlama, kullanıcının imzaladığı AP2 intent mandate'i ister (`mandate.ts`): tutar,
 *    para birimi, ilan ve süre mandate'e karşı doğrulanır; platform merchant-of-record kalır.
 */

export type CheckoutStatus = "ready_for_payment" | "in_progress" | "completed" | "canceled";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD bekleniyor");

export const createCheckoutSchema = z
  .object({
    room_id: z.string().min(1).max(64),
    check_in: isoDate,
    check_out: isoDate,
    guests: z.number().int().min(1).max(20),
  })
  .strict();

export const updateCheckoutSchema = createCheckoutSchema.partial().strict();

export const completeCheckoutSchema = z
  .object({
    payment_data: z.object({
      token: z.string().min(1).max(200),
      provider: z.enum(["mock", "stripe"]),
    }),
    /** AP2 intent mandate (kompakt JWS). */
    mandate: z.string().min(1).max(4096).optional(),
  })
  .strict();

type CreateInput = z.infer<typeof createCheckoutSchema>;
type UpdateInput = z.infer<typeof updateCheckoutSchema>;

interface Totals {
  subtotal: number;
  fees: number;
  taxes: number;
  total: number;
}

/** İstek gövdesinin kanonik özeti (idempotency anahtarı ↔ gövde bağı; booking-service de kullanır). */
export function hashRequest(input: CreateInput): string {
  const canonical = JSON.stringify([input.room_id, input.check_in, input.check_out, input.guests]);
  return createHash("sha256").update(canonical).digest("hex");
}

function totalsOf(quote: Quote): Totals {
  return {
    subtotal: quote.subtotal,
    fees: quote.fees.filter((f) => !f.inclusive).reduce((acc, f) => acc + f.amount, 0),
    taxes: quote.taxes.filter((t) => !t.inclusive).reduce((acc, t) => acc + t.amount, 0),
    total: quote.total,
  };
}

function quoteFor(stay: { roomId: string; checkIn: string; checkOut: string; guests: number }) {
  return createQuote({
    roomId: stay.roomId,
    checkIn: stay.checkIn,
    checkOut: stay.checkOut,
    guests: stay.guests,
  });
}

export interface CheckoutSessionView {
  id: string;
  status: CheckoutStatus;
  currency: string;
  stay: {
    property_id: string;
    room_id: string;
    check_in: string;
    check_out: string;
    guests: number;
  };
  line_items: Array<{
    id: string;
    quantity: number;
    base_amount: number;
    tax: number;
    total: number;
  }>;
  totals: Array<{ type: "subtotal" | "fees" | "tax" | "total"; amount: number }>;
  payment_provider: { provider: "mock" | "stripe"; supported_payment_methods: ["card"] };
  order: { id: string } | null;
  expires_at: string;
  messages: Array<{ type: "info" | "error"; code: string; content: string }>;
  next_action?: { type: "three_ds"; challenge: PaymentChallenge };
}

export function toView(
  s: CheckoutSession,
  extra: Pick<CheckoutSessionView, "messages" | "next_action"> = { messages: [] }
): CheckoutSessionView {
  const t = s.totals as unknown as Totals;
  return {
    id: s.id,
    status: s.status as CheckoutStatus,
    currency: s.currency,
    stay: {
      property_id: s.propertyId,
      room_id: s.roomId,
      check_in: s.checkIn,
      check_out: s.checkOut,
      guests: s.guests,
    },
    line_items: [
      { id: s.roomId, quantity: 1, base_amount: t.subtotal + t.fees, tax: t.taxes, total: t.total },
    ],
    totals: [
      { type: "subtotal", amount: t.subtotal },
      { type: "fees", amount: t.fees },
      { type: "tax", amount: t.taxes },
      { type: "total", amount: t.total },
    ],
    payment_provider: { provider: activeSptProvider(), supported_payment_methods: ["card"] },
    order: s.bookingId ? { id: s.bookingId } : null,
    expires_at: s.expiresAt.toISOString(),
    ...extra,
  };
}

function expiryFrom(now: Date): Date {
  return new Date(now.getTime() + getConfig().CHECKOUT_SESSION_TTL_MINUTES * 60_000);
}

/**
 * Oturum ↔ rezervasyon uzlaştırması (v4#10): her okumada bağlı rezervasyonun GÜNCEL
 * durumuna bakılır — yalnızca `in_progress`'te değil. Ödeme reddi sonrası
 * `ready_for_payment` kalan oturumun hold'u düşmüşse (EXPIRED/CANCELLED ya da HELD ama
 * `holdExpiresAt` geçmiş) oturum `canceled` olur; ajan yeni oturum açar. Aksi hâlde
 * oturum TTL'e kadar ölü bir rezervasyona kilitli kalırdı.
 */
export function reconcileCheckoutStatus(
  status: CheckoutStatus,
  booking: { status: string; holdExpiresAt: Date | null } | null,
  now: Date
): CheckoutStatus | null {
  if (status === "completed" || status === "canceled") return null;
  if (!booking) return "canceled";
  if (booking.status === "CONFIRMED" || booking.status === "COMPLETED") return "completed";
  if (booking.status === "EXPIRED" || booking.status === "CANCELLED") return "canceled";
  if (booking.status === "HELD" && booking.holdExpiresAt && booking.holdExpiresAt <= now) {
    return "canceled";
  }
  return null;
}

/** Sahiplik kontrollü okuma; süresi dolmuş açık oturumu iptal eder, rezervasyon durumunu yansıtır. */
async function loadOwned(userId: string, id: string, now = new Date()): Promise<CheckoutSession> {
  const session = await prisma.checkoutSession.findFirst({ where: { id, userId } });
  if (!session) throw new NotFoundError("Checkout oturumu bulunamadı");
  if (session.bookingId) {
    const booking = await prisma.booking.findUnique({
      where: { id: session.bookingId },
      select: { status: true, holdExpiresAt: true },
    });
    const next = reconcileCheckoutStatus(session.status as CheckoutStatus, booking, now);
    if (next) {
      logger.info(
        { checkoutSessionId: id, bookingId: session.bookingId, from: session.status, to: next },
        "agentic checkout reconciled"
      );
      return prisma.checkoutSession.update({ where: { id }, data: { status: next } });
    }
  }
  if (session.status === "ready_for_payment" && session.expiresAt <= now) {
    return prisma.checkoutSession.update({ where: { id }, data: { status: "canceled" } });
  }
  return session;
}

export async function createCheckoutSession(
  userId: string,
  idempotencyKey: string,
  input: CreateInput,
  now = new Date()
): Promise<{ session: CheckoutSessionView; created: boolean }> {
  const requestHash = hashRequest(input);
  const existing = await prisma.checkoutSession.findUnique({
    where: { userId_idempotencyKey: { userId, idempotencyKey } },
  });
  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw new ConflictError(
        "Bu Idempotency-Key farklı bir istekle kullanılmış",
        "IDEMPOTENCY_KEY_REUSED"
      );
    }
    return { session: toView(await loadOwned(userId, existing.id, now)), created: false };
  }

  const quote = await quoteFor({
    roomId: input.room_id,
    checkIn: input.check_in,
    checkOut: input.check_out,
    guests: input.guests,
  });
  try {
    const row = await prisma.checkoutSession.create({
      data: {
        userId,
        idempotencyKey,
        requestHash,
        status: "ready_for_payment",
        propertyId: quote.propertyId,
        roomId: quote.roomId,
        checkIn: quote.checkIn,
        checkOut: quote.checkOut,
        guests: quote.guests,
        quoteId: quote.quoteId,
        currency: quote.currency,
        totals: totalsOf(quote) as unknown as Prisma.InputJsonValue,
        expiresAt: expiryFrom(now),
      },
    });
    return { session: toView(row), created: true };
  } catch (error) {
    // Aynı anahtarla eşzamanlı iki istek: kaybeden, kazananın oturumunu döner.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const winner = await prisma.checkoutSession.findUnique({
        where: { userId_idempotencyKey: { userId, idempotencyKey } },
      });
      if (winner && winner.requestHash === requestHash) {
        return { session: toView(winner), created: false };
      }
    }
    throw error;
  }
}

export async function getCheckoutSession(userId: string, id: string): Promise<CheckoutSessionView> {
  return toView(await loadOwned(userId, id));
}

export async function updateCheckoutSession(
  userId: string,
  id: string,
  patch: UpdateInput,
  now = new Date()
): Promise<CheckoutSessionView> {
  const session = await loadOwned(userId, id, now);
  if (session.status !== "ready_for_payment") {
    throw new ConflictError("Oturum artık güncellenemez", "CHECKOUT_NOT_MODIFIABLE");
  }
  const quote = await quoteFor({
    roomId: patch.room_id ?? session.roomId,
    checkIn: patch.check_in ?? session.checkIn,
    checkOut: patch.check_out ?? session.checkOut,
    guests: patch.guests ?? session.guests,
  });
  const row = await prisma.checkoutSession.update({
    where: { id },
    data: {
      propertyId: quote.propertyId,
      roomId: quote.roomId,
      checkIn: quote.checkIn,
      checkOut: quote.checkOut,
      guests: quote.guests,
      quoteId: quote.quoteId,
      currency: quote.currency,
      totals: totalsOf(quote) as unknown as Prisma.InputJsonValue,
      expiresAt: expiryFrom(now),
    },
  });
  return toView(row);
}

/**
 * Tamamlama: yeniden teklif (fiyat değiştiyse 409 PRICE_CHANGED + oturum güncellenir,
 * kullanıcı yeni tutarı onaylamalı) → HELD rezervasyon (idempotent) → ödeme.
 * Aynı `Idempotency-Key` ile tekrar → aynı ödeme sonucu; tamamlanmış oturum aynen döner.
 */
export interface CompletePayment {
  /** Paylaşılan ödeme token'ı (SPT). */
  token: string;
  /** AP2 intent mandate (JWS); `AGENT_MANDATE_REQUIRED` iken zorunlu. */
  mandate?: string | null;
}

export async function completeCheckoutSession(
  userId: string,
  id: string,
  idempotencyKey: string,
  payment: CompletePayment,
  context: Parameters<typeof payForBooking>[0]["context"] = {},
  now = new Date(),
  mandateDeps: AuthorizeMandateDeps = {}
): Promise<CheckoutSessionView> {
  let session = await loadOwned(userId, id, now);
  if (session.status === "completed") return toView(session);
  if (session.status === "canceled") {
    throw new ConflictError("Oturum iptal edilmiş veya süresi dolmuş", "CHECKOUT_CANCELED");
  }
  // Mandate kapısı PSP'ye gitmeden önce: tutar/para birimi/ilan oturumun GÜNCEL teklifinden.
  const amountMinor = (session.totals as unknown as Totals).total;
  await authorizeMandate(
    payment.mandate,
    {
      userId,
      checkoutSessionId: session.id,
      amountMinor,
      currency: session.currency,
      propertyId: session.propertyId,
    },
    { now, ...mandateDeps }
  );
  const cardToken = await sptToCardToken(payment.token, {
    amountMinor,
    currency: session.currency,
  });

  if (!session.bookingId) {
    const quote = await quoteFor(session);
    const before = session.totals as unknown as Totals;
    if (quote.total !== before.total || quote.currency !== session.currency) {
      session = await prisma.checkoutSession.update({
        where: { id },
        data: {
          quoteId: quote.quoteId,
          currency: quote.currency,
          totals: totalsOf(quote) as unknown as Prisma.InputJsonValue,
        },
      });
      throw new ConflictError("Fiyat değişti; yeni tutarı kullanıcıya onaylatın", "PRICE_CHANGED", {
        session: toView(session),
      });
    }
    const { booking } = await createBooking({
      userId,
      propertyId: session.propertyId,
      roomId: session.roomId,
      checkIn: session.checkIn,
      checkOut: session.checkOut,
      guestCount: session.guests,
      quoteId: quote.quoteId,
      idempotencyKey: `acs:${session.id}`,
    });
    session = await prisma.checkoutSession.update({
      where: { id },
      data: { bookingId: booking.id, quoteId: quote.quoteId },
    });
  }

  const outcome: PayOutcome = await payForBooking({
    bookingId: session.bookingId!,
    userId,
    cardToken,
    idempotencyKey: `acs:${session.id}:${idempotencyKey}`,
    context,
  });
  if (outcome.status === "confirmed") {
    const row = await prisma.checkoutSession.update({
      where: { id },
      data: { status: "completed" },
    });
    logger.info(
      { checkoutSessionId: id, bookingId: outcome.bookingId },
      "agentic checkout completed"
    );
    return toView(row);
  }
  const row = await prisma.checkoutSession.update({
    where: { id },
    data: { status: "in_progress" },
  });
  return toView(row, {
    messages: [
      {
        type: "info",
        code: "REQUIRES_ACTION",
        content: "Ödeme için kullanıcının 3DS doğrulamasını tamamlaması gerekiyor",
      },
    ],
    next_action: { type: "three_ds", challenge: outcome.challenge },
  });
}
