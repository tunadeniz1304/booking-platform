import type { LedgerKind, Prisma, PrismaClient } from "@prisma/client";
import { toMinor } from "@/lib/money/money";
import { JournalKinds } from "./templates";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Eski `LedgerEntry` okuma uyumluluğu (ADR 0020). v3 okuyucuları (CHARGE − REFUND net,
 * devir satırları) tek biçimde okur: eski tablodaki satırlar + jurnalden türetilen
 * eşdeğerleri. Geçiş boyunca servisler iki yere de yazabilir (dual-write); aynı olay iki
 * kez sayılmasın diye (tür, referans, tutar) eşleşen türetilmiş satır atlanır.
 */
export interface LedgerViewRow {
  source: "legacy" | "journal";
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
  const legacy = await db.ledgerEntry.findMany({
    where: { bookingId },
    orderBy: { createdAt: "asc" },
  });
  const rows: LedgerViewRow[] = legacy.map((r) => ({
    source: "legacy",
    bookingId: r.bookingId,
    userId: r.userId,
    kind: r.kind,
    amountMinor: r.amountMinor,
    currency: r.currency,
    reference: r.reference,
    createdAt: r.createdAt,
  }));
  const derived = await deriveFromJournal(db, bookingId);
  const unmatched = [...rows];
  const same = (r: LedgerViewRow, d: LedgerViewRow) =>
    r.kind === d.kind && r.amountMinor === d.amountMinor && r.currency === d.currency;
  for (const d of derived) {
    // Önce referans da eşleşen satır; yoksa (ör. devredilmiş rezervasyonun iadesi eski
    // defterde alıcının devir ödemesine referanslı) aynı tür + tutar + para birimi.
    let i = unmatched.findIndex((r) => same(r, d) && r.reference === d.reference);
    if (i < 0) i = unmatched.findIndex((r) => same(r, d));
    if (i >= 0) unmatched.splice(i, 1);
    else rows.push(d);
  }
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
      out.push({
        ...base,
        kind: "REFUND",
        userId: payment?.userId ?? booking?.userId ?? null,
        amountMinor: sumSide("CREDIT"),
        reference: payment?.providerRef ?? null,
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
