import type { Prisma, PrismaClient } from "@prisma/client";
import { toMinor } from "@/lib/money/money";
import { JournalKinds } from "./templates";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * v3 biçiminde rezervasyon para hareketleri görünümü (ADR 0020, ADR 0033). Eski `LedgerEntry`
 * tablosu kaldırıldı (contract adımı); satırlar yalnız çift girişli jurnalden türetilir:
 * CHARGE / REFUND (PSP parası) ve devirde TRANSFER_PAYMENT / TRANSFER_PAYOUT.
 */
export type LedgerKind = "CHARGE" | "REFUND" | "TRANSFER_PAYMENT" | "TRANSFER_PAYOUT";

export interface LedgerViewRow {
  source: "journal";
  bookingId: string;
  userId: string | null;
  kind: LedgerKind;
  amountMinor: bigint;
  currency: string;
  reference: string | null;
  createdAt: Date;
}

/** Decimal/string/bigint → minor-unit bigint (şema geçişinden bağımsız tek dönüşüm noktası). */
export function toMinorBigint(value: unknown, currency: string): bigint {
  if (typeof value === "bigint") return value;
  return BigInt(toMinor(value as string | number | { toString(): string }, currency));
}

export async function listBookingLedger(db: Db, bookingId: string): Promise<LedgerViewRow[]> {
  const rows = await deriveFromJournal(db, bookingId);
  return rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

/** v3 anlamında net tahsilat: Σ CHARGE − Σ REFUND (para birimi başına). */
export function netChargedMinor(rows: readonly LedgerViewRow[], currency: string): bigint {
  return rows
    .filter((r) => r.currency === currency)
    .reduce(
      (sum, r) =>
        r.kind === "CHARGE" ? sum + r.amountMinor : r.kind === "REFUND" ? sum - r.amountMinor : sum,
      0n
    );
}

async function deriveFromJournal(db: Db, bookingId: string): Promise<LedgerViewRow[]> {
  const entries = await db.journalEntry.findMany({
    where: {
      bookingId,
      kind: {
        in: [JournalKinds.BookingCaptured, JournalKinds.RefundIssued, JournalKinds.TransferSettled],
      },
    },
    include: { lines: { include: { account: { select: { kind: true, ownerId: true } } } } },
    orderBy: { occurredAt: "asc" },
  });
  if (entries.length === 0) return [];

  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    select: { userId: true },
  });
  const paymentIds = entries.map((e) => e.paymentId).filter((id): id is string => !!id);
  const payments = await db.payment.findMany({
    where: { id: { in: paymentIds } },
    select: { id: true, userId: true, providerRef: true },
  });
  const transferIds = entries.map((e) => e.transferId).filter((id): id is string => !!id);
  const transfers = await db.bookingTransfer.findMany({
    where: { id: { in: transferIds } },
    select: { id: true, claimedById: true, buyerPaymentRef: true },
  });
  // Devredilmiş rezervasyonun iptal iadesi alıcının devir ödemesine yapılır (refundTarget).
  const handedOver = booking
    ? await db.bookingTransfer.findFirst({
        where: {
          bookingId,
          status: "COMPLETED",
          claimedById: booking.userId,
          buyerPaymentRef: { not: null },
        },
        orderBy: { completedAt: "desc" },
        select: { claimedById: true, buyerPaymentRef: true, completedAt: true },
      })
    : null;

  const out: LedgerViewRow[] = [];
  for (const e of entries) {
    const psp = e.lines.find((l) => l.account.kind === "PSP_CLEARING");
    // P1-7: krediye yapılan iade (Cr guest_credit) PSP parası değildir → eski görünümde yok.
    if (e.kind === JournalKinds.RefundIssued && !psp) continue;
    const any = psp ?? e.lines[0];
    const currency = any.currency;
    const sumSide = (side: "DEBIT" | "CREDIT") =>
      e.lines.filter((l) => l.side === side).reduce((s, l) => s + l.amountMinor, 0n);
    const base = { source: "journal" as const, bookingId, currency, createdAt: e.occurredAt };
    const payment = payments.find((p) => p.id === e.paymentId);
    if (e.kind === JournalKinds.BookingCaptured) {
      out.push({
        ...base,
        kind: "CHARGE",
        userId: payment?.userId ?? booking?.userId ?? null,
        amountMinor: sumSide("DEBIT"),
        reference: payment?.providerRef ?? null,
      });
    } else if (e.kind === JournalKinds.RefundIssued) {
      const toBuyer =
        handedOver?.completedAt && e.occurredAt >= handedOver.completedAt ? handedOver : null;
      out.push({
        ...base,
        kind: "REFUND",
        userId: toBuyer?.claimedById ?? payment?.userId ?? booking?.userId ?? null,
        amountMinor: sumSide("CREDIT"),
        reference: toBuyer?.buyerPaymentRef ?? payment?.providerRef ?? null,
      });
    } else {
      const transfer = transfers.find((t) => t.id === e.transferId);
      const seller = e.lines.find((l) => l.account.kind === "HOST_PAYABLE")?.account.ownerId;
      const ask = sumSide("DEBIT");
      out.push(
        {
          ...base,
          kind: "TRANSFER_PAYMENT",
          userId: transfer?.claimedById ?? null,
          amountMinor: ask,
          reference: transfer?.buyerPaymentRef ?? null,
        },
        {
          ...base,
          kind: "TRANSFER_PAYOUT",
          userId: seller ?? null,
          amountMinor: ask,
          reference: e.transferId,
        }
      );
    }
  }
  return out;
}
