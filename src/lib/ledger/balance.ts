import type { LedgerAccountKind, Prisma, PrismaClient } from "@prisma/client";
import { accountCode, isDebitNormal, type AccountRef } from "./accounts";

type Db = PrismaClient | Prisma.TransactionClient;

export interface AccountBalance {
  code: string;
  kind: LedgerAccountKind;
  currency: string;
  debitMinor: bigint;
  creditMinor: bigint;
  /** Doğal yöne göre bakiye: varlıkta borç − alacak, yükümlülük/gelirde alacak − borç. */
  balanceMinor: bigint;
}

function toBalance(
  code: string,
  kind: LedgerAccountKind,
  currency: string,
  debitMinor: bigint,
  creditMinor: bigint
): AccountBalance {
  const balanceMinor = isDebitNormal(kind) ? debitMinor - creditMinor : creditMinor - debitMinor;
  return { code, kind, currency, debitMinor, creditMinor, balanceMinor };
}

/** Tek hesabın (tek para birimi) bakiyesi; hesap hiç açılmamışsa sıfır. */
export async function getAccountBalance(
  db: Db,
  ref: AccountRef,
  currency: string
): Promise<AccountBalance> {
  const code = accountCode(ref);
  const acct = await db.ledgerAccount.findUnique({ where: { code }, select: { id: true } });
  if (!acct) return toBalance(code, ref.kind, currency, 0n, 0n);
  const sums = await db.journalLine.groupBy({
    by: ["side"],
    where: { accountId: acct.id, currency },
    _sum: { amountMinor: true },
  });
  const of = (side: "DEBIT" | "CREDIT") =>
    sums.find((s) => s.side === side)?._sum.amountMinor ?? 0n;
  return toBalance(code, ref.kind, currency, of("DEBIT"), of("CREDIT"));
}

/**
 * Mizan: her (hesap, para birimi) için borç/alacak toplamı. Dengeli defterde para birimi
 * başına Σborç = Σalacak (`isTrialBalanced`).
 */
export async function trialBalance(db: Db): Promise<AccountBalance[]> {
  const rows = await db.$queryRaw<
    Array<{
      code: string;
      kind: LedgerAccountKind;
      currency: string;
      debit: bigint;
      credit: bigint;
    }>
  >`
    SELECT a."code", a."kind", l."currency",
           COALESCE(SUM(l."amountMinor") FILTER (WHERE l."side" = 'DEBIT'), 0)::bigint AS debit,
           COALESCE(SUM(l."amountMinor") FILTER (WHERE l."side" = 'CREDIT'), 0)::bigint AS credit
      FROM "JournalLine" l
      JOIN "LedgerAccount" a ON a."id" = l."accountId"
     GROUP BY a."code", a."kind", l."currency"
     ORDER BY a."code", l."currency"`;
  return rows.map((r) => toBalance(r.code, r.kind, r.currency, BigInt(r.debit), BigInt(r.credit)));
}

export function isTrialBalanced(rows: readonly AccountBalance[]): boolean {
  const net = new Map<string, bigint>();
  for (const r of rows) {
    net.set(r.currency, (net.get(r.currency) ?? 0n) + r.debitMinor - r.creditMinor);
  }
  return [...net.values()].every((v) => v === 0n);
}
