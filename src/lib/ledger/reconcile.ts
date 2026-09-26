import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { counter } from "@/lib/observability/metrics";
import { ledgerImbalanceTotal } from "./journal";
import { JournalKinds } from "./templates";

type Db = PrismaClient | Prisma.TransactionClient;

export const reconciliationRunsTotal = counter(
  "ledger_reconciliation_runs_total",
  "Günlük mutabakat koşuları (clean = fark yok)",
  ["outcome"] as const
);

export type ReconKind = "capture" | "refund" | "transfer" | "deposit";

export interface ReconDiffRow {
  subject: "payment" | "transfer" | "deposit";
  subjectId: string;
  bookingId: string | null;
  kind: ReconKind;
  currency: string;
  /** PSP kaydına göre beklenen minor-unit tutar. */
  pspMinor: bigint;
  /** Jurnalde psp_clearing hesabına yazılan tutar. */
  journalMinor: bigint;
  diffMinor: bigint;
}

export interface ReconciliationReport {
  date: string;
  from: Date;
  to: Date;
  /** Kontrol edilen (özne, tür) çifti sayısı. */
  checked: number;
  differences: ReconDiffRow[];
  /** Gün içinde oluşmuş dengesiz jurnal sayısı (tetik varken 0 olmalı). */
  imbalancedEntries: number;
  /** Payment/devir kaydıyla eşleşmeyen PSP webhook olayları. */
  orphanEvents: Array<{ id: string; type: string; providerRef: string | null }>;
  ok: boolean;
}

/** "YYYY-MM-DD" (UTC) → [gün başı, ertesi gün başı). */
export function dayWindow(date: string | Date): { date: string; from: Date; to: Date } {
  const text = typeof date === "string" ? date : date.toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new RangeError(`Geçersiz tarih: ${text}`);
  const from = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(from.getTime()) || from.toISOString().slice(0, 10) !== text) {
    throw new RangeError(`Geçersiz tarih: ${text}`);
  }
  return { date: text, from, to: new Date(from.getTime() + 86_400_000) };
}

/**
 * Günlük mutabakat: o gün PSP tarafında hareket görmüş (tahsil/iade/devir) ya da o gün
 * jurnali oluşmuş her ödeme/devir için PSP kaydındaki TOPLAM tutar ile jurnaldeki
 * psp_clearing tutarını (tüm zamanlar) karşılaştırır. Fark satırları raporlanır.
 *
 * - capture: Payment.amountMinor (paidAt doluysa) ↔ BOOKING_CAPTURED Dr psp_clearing
 * - refund:  Payment.refundedAmountMinor ↔ REFUND_ISSUED Cr psp_clearing (krediye iade hariç)
 * - transfer: COMPLETED devrin askPriceMinor'ı ↔ TRANSFER_SETTLED Dr psp_clearing
 * - deposit: hasar depozitosunun capturedMinor'ı ↔ DEPOSIT_CAPTURED Dr psp_clearing (P1-5)
 */
export async function reconcile(
  date: string | Date,
  db: Db = prisma
): Promise<ReconciliationReport> {
  const { date: day, from, to } = dayWindow(date);
  const inDay = { gte: from, lt: to };

  const dayEntries = await db.journalEntry.findMany({
    where: {
      occurredAt: inDay,
      kind: {
        in: [JournalKinds.BookingCaptured, JournalKinds.RefundIssued, JournalKinds.TransferSettled],
      },
    },
    select: { paymentId: true, transferId: true },
  });
  const pspPayments = await db.payment.findMany({
    where: { OR: [{ paidAt: inDay }, { refundedAt: inDay }] },
    select: { id: true },
  });
  const pspTransfers = await db.bookingTransfer.findMany({
    where: { completedAt: inDay },
    select: { id: true },
  });

  const paymentIds = unique([
    ...pspPayments.map((p) => p.id),
    ...dayEntries.map((e) => e.paymentId),
  ]);
  const transferIds = unique([
    ...pspTransfers.map((t) => t.id),
    ...dayEntries.map((e) => e.transferId),
  ]);

  const differences: ReconDiffRow[] = [];
  let checked = 0;

  if (paymentIds.length > 0) {
    const payments = await db.payment.findMany({
      where: { id: { in: paymentIds } },
      select: {
        id: true,
        bookingId: true,
        currency: true,
        amountMinor: true,
        refundedAmountMinor: true,
        paidAt: true,
      },
    });
    const journal = await pspSums(db, "paymentId", paymentIds);
    for (const p of payments) {
      const captured = p.paidAt ? p.amountMinor : 0n;
      const refunded = p.refundedAmountMinor;
      const j = journal.get(p.id);
      checked += 2;
      push(
        differences,
        "payment",
        p.id,
        p.bookingId,
        "capture",
        p.currency,
        captured,
        j?.capture ?? 0n
      );
      push(
        differences,
        "payment",
        p.id,
        p.bookingId,
        "refund",
        p.currency,
        refunded,
        j?.refund ?? 0n
      );
    }
  }

  if (transferIds.length > 0) {
    const transfers = await db.bookingTransfer.findMany({
      where: { id: { in: transferIds } },
      select: { id: true, bookingId: true, currency: true, askPriceMinor: true, status: true },
    });
    const journal = await pspSums(db, "transferId", transferIds);
    for (const t of transfers) {
      const settled = t.status === "COMPLETED" ? t.askPriceMinor : 0n;
      checked += 1;
      push(
        differences,
        "transfer",
        t.id,
        t.bookingId,
        "transfer",
        t.currency,
        settled,
        journal.get(t.id)?.transfer ?? 0n
      );
    }
  }

  checked += await reconcileDeposits(db, inDay, differences);

  const imbalanced = await db.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*)::bigint AS n FROM (
      SELECT l."entryId"
        FROM "JournalLine" l
        JOIN "JournalEntry" e ON e."id" = l."entryId"
       WHERE e."occurredAt" >= ${from} AND e."occurredAt" < ${to}
       GROUP BY l."entryId", l."currency"
      HAVING SUM(CASE WHEN l."side" = 'DEBIT' THEN l."amountMinor" ELSE -l."amountMinor" END) <> 0
    ) x`;
  const imbalancedEntries = Number(imbalanced[0]?.n ?? 0);
  if (imbalancedEntries > 0)
    ledgerImbalanceTotal.inc({ source: "reconciliation" }, imbalancedEntries);

  const events = await db.paymentEvent.findMany({
    where: { receivedAt: inDay, providerRef: { not: null } },
    select: { id: true, type: true, providerRef: true },
  });
  const refs = unique(events.map((e) => e.providerRef));
  const known = new Set<string>();
  if (refs.length > 0) {
    const [pays, trs, carts, shares] = await Promise.all([
      db.payment.findMany({ where: { providerRef: { in: refs } }, select: { providerRef: true } }),
      db.bookingTransfer.findMany({
        where: { buyerPaymentRef: { in: refs } },
        select: { buyerPaymentRef: true },
      }),
      // P1-1: sepetin tek tahsilatı (paylar rezervasyon Payment'larında, ref sepet ödemesinde).
      db.cartPayment.findMany({
        where: { providerRef: { in: refs } },
        select: { providerRef: true },
      }),
      // P1-2: bölünmüş ödeme payları (her pay ayrı PSP işlemi).
      db.paymentShare.findMany({
        where: { providerRef: { in: refs } },
        select: { providerRef: true },
      }),
    ]);
    for (const p of pays) if (p.providerRef) known.add(p.providerRef);
    for (const c of carts) if (c.providerRef) known.add(c.providerRef);
    for (const s of shares) if (s.providerRef) known.add(s.providerRef);
    for (const t of trs) if (t.buyerPaymentRef) known.add(t.buyerPaymentRef);
  }
  const orphanEvents = events.filter((e) => !known.has(e.providerRef!));

  const ok = differences.length === 0 && imbalancedEntries === 0 && orphanEvents.length === 0;
  reconciliationRunsTotal.inc({ outcome: ok ? "clean" : "diff" });
  return { date: day, from, to, checked, differences, imbalancedEntries, orphanEvents, ok };
}

/**
 * P1-5 depozito mutabakatı: o gün tahsil edilmiş ya da o gün DEPOSIT_CAPTURED jurnali oluşmuş
 * her depozito için PSP tarafı (capturedMinor) ↔ jurnaldeki Dr psp_clearing (tüm zamanlar).
 */
async function reconcileDeposits(
  db: Db,
  inDay: { gte: Date; lt: Date },
  out: ReconDiffRow[]
): Promise<number> {
  const PREFIX = "deposit-captured:";
  const [captured, entries] = await Promise.all([
    db.damageDeposit.findMany({ where: { capturedAt: inDay }, select: { id: true } }),
    db.journalEntry.findMany({
      where: { occurredAt: inDay, kind: JournalKinds.DepositCaptured },
      select: { idempotencyKey: true },
    }),
  ]);
  const ids = unique([
    ...captured.map((d) => d.id),
    ...entries.map((e) => e.idempotencyKey.slice(PREFIX.length)),
  ]);
  if (ids.length === 0) return 0;
  const [deposits, lines] = await Promise.all([
    db.damageDeposit.findMany({
      where: { id: { in: ids } },
      select: { id: true, bookingId: true, currency: true, capturedMinor: true },
    }),
    db.journalLine.findMany({
      where: {
        side: "DEBIT",
        account: { kind: "PSP_CLEARING" },
        entry: {
          kind: JournalKinds.DepositCaptured,
          idempotencyKey: { in: ids.map((id) => `${PREFIX}${id}`) },
        },
      },
      select: { amountMinor: true, entry: { select: { idempotencyKey: true } } },
    }),
  ]);
  const journal = new Map<string, bigint>();
  for (const l of lines) {
    const id = l.entry.idempotencyKey.slice(PREFIX.length);
    journal.set(id, (journal.get(id) ?? 0n) + l.amountMinor);
  }
  for (const d of deposits) {
    push(
      out,
      "deposit",
      d.id,
      d.bookingId,
      "deposit",
      d.currency,
      d.capturedMinor,
      journal.get(d.id) ?? 0n
    );
  }
  return deposits.length;
}

function unique(values: ReadonlyArray<string | null | undefined>): string[] {
  return [...new Set(values.filter((v): v is string => !!v))];
}

function push(
  out: ReconDiffRow[],
  subject: ReconDiffRow["subject"],
  subjectId: string,
  bookingId: string | null,
  kind: ReconKind,
  currency: string,
  pspMinor: bigint,
  journalMinor: bigint
): void {
  if (pspMinor === journalMinor) return;
  out.push({
    subject,
    subjectId,
    bookingId,
    kind,
    currency,
    pspMinor,
    journalMinor,
    diffMinor: pspMinor - journalMinor,
  });
}

/** Özne başına jurnaldeki psp_clearing toplamları (tüm zamanlar). */
async function pspSums(
  db: Db,
  column: "paymentId" | "transferId",
  ids: string[]
): Promise<Map<string, { capture: bigint; refund: bigint; transfer: bigint }>> {
  const lines = await db.journalLine.findMany({
    where: {
      account: { kind: "PSP_CLEARING" },
      entry: { [column]: { in: ids } },
    },
    select: {
      side: true,
      amountMinor: true,
      entry: { select: { kind: true, paymentId: true, transferId: true } },
    },
  });
  const out = new Map<string, { capture: bigint; refund: bigint; transfer: bigint }>();
  for (const l of lines) {
    const id = l.entry[column];
    if (!id) continue;
    const acc = out.get(id) ?? { capture: 0n, refund: 0n, transfer: 0n };
    if (l.entry.kind === JournalKinds.BookingCaptured && l.side === "DEBIT")
      acc.capture += l.amountMinor;
    else if (l.entry.kind === JournalKinds.RefundIssued && l.side === "CREDIT")
      acc.refund += l.amountMinor;
    else if (l.entry.kind === JournalKinds.TransferSettled && l.side === "DEBIT")
      acc.transfer += l.amountMinor;
    out.set(id, acc);
  }
  return out;
}

/** JSON yanıtı için bigint → string. */
export function serializeReport(r: ReconciliationReport) {
  return {
    ...r,
    from: r.from.toISOString(),
    to: r.to.toISOString(),
    differences: r.differences.map((d) => ({
      ...d,
      pspMinor: d.pspMinor.toString(),
      journalMinor: d.journalMinor.toString(),
      diffMinor: d.diffMinor.toString(),
    })),
  };
}
