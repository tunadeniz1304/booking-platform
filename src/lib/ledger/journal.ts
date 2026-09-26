import { createHash, randomUUID } from "crypto";
import type { JournalSide, Prisma } from "@prisma/client";
import { HttpError } from "@/lib/http/errors";
import { isCurrencyCode } from "@/lib/money/money";
import { counter } from "@/lib/observability/metrics";
import { accountCode, resolveAccountIds, type AccountRef } from "./accounts";

/** Dengesiz jurnal denemeleri: `app` = assertBalanced, `db` = tetik, `reconciliation` = günlük tarama. */
export const ledgerImbalanceTotal = counter(
  "ledger_imbalance_total",
  "Dengesiz (Σborç ≠ Σalacak) jurnal denemeleri / bulguları",
  ["source"] as const
);

export class LedgerError extends HttpError {
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(status, code, message, details);
    this.name = "LedgerError";
  }
}

export interface JournalLineInput {
  account: AccountRef;
  side: JournalSide;
  /** Pozitif minor-unit tutar (bigint; TRY: kuruş). */
  amountMinor: bigint;
  currency: string;
}

export interface JournalInput {
  /** İş olayının doğal anahtarı; aynı anahtar ikinci kez yazılmaz. */
  idempotencyKey: string;
  /** Şablon adı (BOOKING_CAPTURED, REFUND_ISSUED, …). */
  kind: string;
  lines: readonly JournalLineInput[];
  bookingId?: string | null;
  paymentId?: string | null;
  transferId?: string | null;
  occurredAt?: Date;
  memo?: string | null;
}

export interface PostResult {
  entryId: string;
  /** false → aynı anahtarla aynı içerik zaten yazılmıştı (idempotent tekrar). */
  created: boolean;
}

/**
 * Uygulama seviyesi denge kontrolü (DB tetiği ikinci savunma hattı):
 * en az iki satır, her tutar pozitif bigint, desteklenen para birimi ve
 * para birimi başına Σborç = Σalacak.
 */
export function assertBalanced(lines: readonly JournalLineInput[]): void {
  const fail = (message: string, details?: unknown): never => {
    ledgerImbalanceTotal.inc({ source: "app" });
    throw new LedgerError(500, "LEDGER_UNBALANCED", message, details);
  };
  if (lines.length < 2) fail("Jurnal en az iki satır içermeli");
  const net = new Map<string, bigint>();
  for (const line of lines) {
    if (typeof line.amountMinor !== "bigint" || line.amountMinor <= 0n) {
      fail("Jurnal satır tutarı pozitif bigint olmalı");
    }
    if (!isCurrencyCode(line.currency)) fail(`Desteklenmeyen para birimi: ${line.currency}`);
    const signed = line.side === "DEBIT" ? line.amountMinor : -line.amountMinor;
    net.set(line.currency, (net.get(line.currency) ?? 0n) + signed);
  }
  for (const [currency, diff] of net) {
    if (diff !== 0n) {
      fail(`Jurnal dengesiz: ${currency} farkı ${diff}`, { currency, diff: diff.toString() });
    }
  }
}

/** Satırların sıradan bağımsız kanonik özeti (idempotency içerik karşılaştırması). */
export function linesHash(kind: string, lines: readonly JournalLineInput[]): string {
  const canonical = lines
    .map((l) => `${accountCode(l.account)}|${l.side}|${l.currency}|${l.amountMinor}`)
    .sort();
  return createHash("sha256")
    .update(JSON.stringify([kind, canonical]))
    .digest("hex");
}

/**
 * Dengeli jurnali yazar. İşlem (tx) dışarıdan verilir — çağıran iş kaydıyla aynı
 * SERIALIZABLE işlemde (`withSerializableRetry`) çağırır; böylece iş durumu ve defter
 * birlikte ya yazılır ya yazılmaz.
 *
 * Idempotent: aynı `idempotencyKey` + aynı içerik → `{created:false}`; farklı içerik →
 * 409 `LEDGER_IDEMPOTENCY_CONFLICT`. Eşzamanlı iki yazıcıda INSERT ON CONFLICT DO
 * NOTHING kullanılır; SERIALIZABLE çakışması yeniden denemede tekrar olarak görülür.
 */
export async function postJournal(
  tx: Prisma.TransactionClient,
  input: JournalInput
): Promise<PostResult> {
  assertBalanced(input.lines);
  const hash = linesHash(input.kind, input.lines);

  const existing = await tx.journalEntry.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    select: { id: true, linesHash: true },
  });
  if (existing) return replayed(existing, hash, input.idempotencyKey);

  const accountIds = await resolveAccountIds(
    tx,
    input.lines.map((l) => l.account)
  );
  const id = randomUUID();
  const inserted = await tx.journalEntry.createMany({
    data: [
      {
        id,
        idempotencyKey: input.idempotencyKey,
        kind: input.kind,
        linesHash: hash,
        bookingId: input.bookingId ?? null,
        paymentId: input.paymentId ?? null,
        transferId: input.transferId ?? null,
        occurredAt: input.occurredAt ?? new Date(),
        memo: input.memo ?? null,
      },
    ],
    skipDuplicates: true,
  });
  if (inserted.count === 0) {
    const winner = await tx.journalEntry.findUniqueOrThrow({
      where: { idempotencyKey: input.idempotencyKey },
      select: { id: true, linesHash: true },
    });
    return replayed(winner, hash, input.idempotencyKey);
  }
  await tx.journalLine.createMany({
    data: input.lines.map((l) => ({
      entryId: id,
      accountId: accountIds.get(accountCode(l.account))!,
      side: l.side,
      amountMinor: l.amountMinor,
      currency: l.currency,
    })),
  });
  await checkBalanceNow(tx);
  return { entryId: id, created: true };
}

/**
 * Ertelenmiş denge tetiğini hemen çalıştırır, sonra yeniden erteler. Gerekçe: Prisma 5
 * etkileşimli işlemde COMMIT hatasını çağırana iletmiyor (işlem geri alınır ama
 * `$transaction` başarılı döner) — tetik hatası işlem içinde görünür olmalı.
 * Yeniden DEFERRED: aynı işlemdeki sonraki jurnalin başlığı satırlarından önce yazılır.
 */
async function checkBalanceNow(tx: Prisma.TransactionClient): Promise<void> {
  try {
    await tx.$executeRawUnsafe(
      `SET CONSTRAINTS "JournalLine_balanced", "JournalEntry_balanced" IMMEDIATE`
    );
  } catch (error) {
    noteLedgerTriggerViolation(error);
    throw error;
  }
  await tx.$executeRawUnsafe(
    `SET CONSTRAINTS "JournalLine_balanced", "JournalEntry_balanced" DEFERRED`
  );
}

function replayed(
  existing: { id: string; linesHash: string },
  hash: string,
  key: string
): PostResult {
  if (existing.linesHash !== hash) {
    throw new LedgerError(
      409,
      "LEDGER_IDEMPOTENCY_CONFLICT",
      "Aynı idempotency anahtarıyla farklı jurnal içeriği",
      { idempotencyKey: key }
    );
  }
  return { entryId: existing.id, created: false };
}

/**
 * Hata DB denge tetiğinden mi geliyor? Öyleyse `ledger_imbalance_total{source="db"}`
 * artırılır. Jurnal yazan işlemin `catch` bloğunda çağrılır.
 */
export function noteLedgerTriggerViolation(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  const unbalanced = text.includes("ledger_unbalanced");
  if (unbalanced) ledgerImbalanceTotal.inc({ source: "db" });
  return unbalanced;
}
