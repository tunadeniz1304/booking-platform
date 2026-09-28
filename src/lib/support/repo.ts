import type { SupportHandoffReason, SupportTicketStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withSerializableRetry } from "@/lib/db/transactions";
import { minorFromDb } from "@/lib/money/money";
import { SETTLED_STATUSES } from "@/lib/payment/payment-core";

/**
 * v5 P1-4 — destek ajanının veri erişimi. Ajanın göreceği TEK yazma `createTicket`'tır;
 * geri kalan her şey salt-okur. Arayüz, birim testleri ve eval koşucusunun (demo) bellek-içi
 * fixture ile çalışabilmesi için soyutlanmıştır.
 */

export interface PolicyView {
  kind: string;
  version: number;
  rules: unknown;
}

export interface PropertyView {
  id: string;
  title: string;
  timeZone: string;
  checkInTime: string;
  checkOutTime: string;
  policy: PolicyView | null;
}

export interface BookingView {
  id: string;
  userId: string;
  status: string;
  checkIn: Date;
  checkOut: Date;
  guestCount: number;
  totalPriceMinor: number;
  currency: string;
  createdAt: Date;
  /** Rezervasyon anındaki iptal politikası anlık görüntüsü (bağlayıcı olan). */
  policySnapshot: unknown;
  /** Ödenmiş ve henüz iade edilmemiş tutar (minor); ödeme yoksa 0. */
  paidMinor: number;
  property: PropertyView;
}

export interface NewSupportTicket {
  userId: string;
  bookingId: string | null;
  reason: SupportHandoffReason;
  intent: string;
  confidence: number;
  summary: string;
  locale: string;
}

export interface SupportRepo {
  /** Kullanıcının rezervasyonu; `bookingId` yoksa en yakın (gelecek, yoksa en yeni) olanı. */
  findBookingForUser(userId: string, bookingId?: string): Promise<BookingView | null>;
  findProperty(propertyId: string): Promise<PropertyView | null>;
  createTicket(input: NewSupportTicket): Promise<{ id: string }>;
}

const propertySelect = {
  id: true,
  title: true,
  timeZone: true,
  checkInTime: true,
  checkOutTime: true,
  cancellationPolicy: { select: { kind: true, version: true, rules: true } },
} as const;

type PropertyRow = {
  id: string;
  title: string;
  timeZone: string;
  checkInTime: string;
  checkOutTime: string;
  cancellationPolicy: { kind: string; version: number; rules: unknown } | null;
};

function toPropertyView(p: PropertyRow): PropertyView {
  return {
    id: p.id,
    title: p.title,
    timeZone: p.timeZone,
    checkInTime: p.checkInTime,
    checkOutTime: p.checkOutTime,
    policy: p.cancellationPolicy,
  };
}

export const prismaSupportRepo: SupportRepo = {
  async findBookingForUser(userId, bookingId) {
    const select = {
      id: true,
      userId: true,
      status: true,
      checkIn: true,
      checkOut: true,
      guestCount: true,
      totalPriceMinor: true,
      currency: true,
      createdAt: true,
      policySnapshot: true,
      payment: { select: { status: true, amountMinor: true, refundedAmountMinor: true } },
      property: { select: propertySelect },
    } as const;
    const row = bookingId
      ? await prisma.booking.findFirst({ where: { id: bookingId, userId }, select })
      : ((await prisma.booking.findFirst({
          where: { userId, checkOut: { gte: new Date() } },
          orderBy: { checkIn: "asc" },
          select,
        })) ??
        (await prisma.booking.findFirst({
          where: { userId },
          orderBy: { createdAt: "desc" },
          select,
        })));
    if (!row) return null;
    const settled = row.payment !== null && SETTLED_STATUSES.includes(row.payment.status);
    const paidMinor = settled
      ? Math.max(
          0,
          minorFromDb(row.payment!.amountMinor) - minorFromDb(row.payment!.refundedAmountMinor)
        )
      : 0;
    return {
      id: row.id,
      userId: row.userId,
      status: row.status,
      checkIn: row.checkIn,
      checkOut: row.checkOut,
      guestCount: row.guestCount,
      totalPriceMinor: minorFromDb(row.totalPriceMinor),
      currency: row.currency,
      createdAt: row.createdAt,
      policySnapshot: row.policySnapshot,
      paidMinor,
      property: toPropertyView(row.property),
    };
  },

  async findProperty(propertyId) {
    const row = await prisma.property.findFirst({
      where: { id: propertyId, isActive: true },
      select: propertySelect,
    });
    return row ? toPropertyView(row) : null;
  },

  async createTicket(input) {
    return withSerializableRetry(
      (tx) => tx.supportTicket.create({ data: input, select: { id: true } }),
      { label: "support.ticket.create" }
    );
  },
};

// --- Yönetici kuyruğu (/admin/support) -------------------------------------------------

export interface SupportTicketRow {
  id: string;
  userId: string;
  bookingId: string | null;
  status: SupportTicketStatus;
  reason: SupportHandoffReason;
  intent: string;
  confidence: number;
  summary: string;
  locale: string;
  createdAt: Date;
  resolvedAt: Date | null;
}

const TICKET_LIST_LIMIT = 100;

export async function listSupportTickets(
  status?: SupportTicketStatus
): Promise<SupportTicketRow[]> {
  return prisma.supportTicket.findMany({
    where: status ? { status } : {},
    orderBy: { createdAt: "asc" },
    take: TICKET_LIST_LIMIT,
    select: {
      id: true,
      userId: true,
      bookingId: true,
      status: true,
      reason: true,
      intent: true,
      confidence: true,
      summary: true,
      locale: true,
      createdAt: true,
      resolvedAt: true,
    },
  });
}

/** Yönetici durum geçişi (insan kararı). Kayıt yoksa `null`. */
export async function updateSupportTicketStatus(
  id: string,
  status: SupportTicketStatus,
  adminId: string
): Promise<{ id: string; status: SupportTicketStatus } | null> {
  return withSerializableRetry(
    async (tx) => {
      const existing = await tx.supportTicket.findUnique({ where: { id }, select: { id: true } });
      if (!existing) return null;
      const resolved = status === "RESOLVED";
      return tx.supportTicket.update({
        where: { id },
        data: {
          status,
          resolvedById: resolved ? adminId : null,
          resolvedAt: resolved ? new Date() : null,
        },
        select: { id: true, status: true },
      });
    },
    { label: "support.ticket.status" }
  );
}
