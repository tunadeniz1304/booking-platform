import { Prisma, type PrismaClient } from "@prisma/client";
import { getConfig } from "@/lib/config/app-config";
import { withSerializableRetry } from "@/lib/db/transactions";
import { account as ledgerAccount, getAccountBalance, JournalKinds, post } from "@/lib/ledger";
import { roundHalfUp } from "@/lib/money/currencies";
import { logger } from "@/lib/observability/logger";
import { counter } from "@/lib/observability/metrics";
import { prisma } from "@/lib/prisma";
import { checkInAt, clockOf, fromDate } from "@/lib/time/nights";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Escrow serbest bırakma (P1-4, ADR 0021). Tahsilatta emanete alınan tutar (vergi hariç),
 * tesisin YEREL giriş anından `PAYOUT_RELEASE_HOURS` sonra ev sahibine ayrılır:
 *
 *   Dr escrow  (rezervasyonun emanet bakiyesi)
 *   Cr platform_revenue     komisyon  = tutar × PLATFORM_COMMISSION_BPS
 *   Cr host_reserve:<host>  rezerv    = (tutar − komisyon) × rezerv bps
 *   Cr host_payable:<host>  kalan
 *
 * Tutar jurnalden okunur (rezervasyonun escrow satırları toplamı) → kısmi iade düşülmüş,
 * tam iade edilmiş/iptal rezervasyonda 0 olur ve serbest bırakma YAPILMAZ (payout üretmez).
 * İptalde emanette kalan (iade edilmeyen) pay da aynı zamanlamayla ev sahibine geçer.
 */

export const escrowReleaseTotal = counter(
  "escrow_release_total",
  "Serbest bırakılan emanet ve rezerv jurnalleri",
  ["kind"] as const
);

const BPS_DENOMINATOR = 10_000n;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
/** Aday ön filtresi (UTC) için saat dilimi payı: en uç dilim farkı + giriş saati. */
const TIMEZONE_SLACK_MS = 36 * HOUR_MS;

export interface ReleaseSplit {
  feeMinor: bigint;
  reserveMinor: bigint;
  hostNetMinor: bigint;
}

/** Saf bölüşüm: komisyon, rezerv (komisyon sonrası paydan), kalan. Tek yuvarlama half-up. */
export function computeReleaseSplit(
  amountMinor: bigint,
  commissionBps: number,
  reserveBps: number
): ReleaseSplit {
  if (amountMinor < 0n) throw new RangeError("Tutar negatif olamaz");
  if (!Number.isInteger(commissionBps) || commissionBps < 0 || commissionBps > 10_000)
    throw new RangeError(`Geçersiz komisyon bps: ${commissionBps}`);
  if (!Number.isInteger(reserveBps) || reserveBps < 0 || reserveBps > 10_000)
    throw new RangeError(`Geçersiz rezerv bps: ${reserveBps}`);
  const feeMinor = roundHalfUp(amountMinor * BigInt(commissionBps), BPS_DENOMINATOR);
  const reserveMinor = roundHalfUp((amountMinor - feeMinor) * BigInt(reserveBps), BPS_DENOMINATOR);
  return { feeMinor, reserveMinor, hostNetMinor: amountMinor - feeMinor - reserveMinor };
}

/** Rezervasyonun jurnaldeki emanet bakiyesi (para birimi başına, alacak − borç). */
export async function bookingEscrowMinor(db: Db, bookingId: string): Promise<Map<string, bigint>> {
  const rows = await db.$queryRaw<Array<{ currency: string; bal: bigint }>>`
    SELECT l."currency",
           SUM(CASE WHEN l."side" = 'CREDIT' THEN l."amountMinor" ELSE -l."amountMinor" END)::bigint AS bal
      FROM "JournalLine" l
      JOIN "JournalEntry" e ON e."id" = l."entryId"
      JOIN "LedgerAccount" a ON a."id" = l."accountId"
     WHERE e."bookingId" = ${bookingId} AND a."kind" = 'ESCROW'
     GROUP BY l."currency"`;
  return new Map(rows.map((r) => [r.currency, BigInt(r.bal)]));
}

/** Emanetin serbest bırakılabileceği an: yerel giriş + PAYOUT_RELEASE_HOURS. */
export function releaseAt(
  checkIn: Date,
  property: { timeZone: string | null; checkInTime: string | null },
  releaseHours = getConfig().PAYOUT_RELEASE_HOURS
): Date {
  const at = checkInAt(fromDate(checkIn), clockOf(property));
  return new Date(at.getTime() + releaseHours * HOUR_MS);
}

interface Candidate {
  id: string;
  checkIn: Date;
  hostId: string;
  timeZone: string | null;
  checkInTime: string | null;
}

export interface EscrowReleaseResult {
  released: number;
  reservesReleased: number;
}

/**
 * Vadesi gelen emanetleri serbest bırakır, sonra süresi dolan rezervleri açar. İdempotent:
 * jurnal anahtarları `escrow-released:<bookingId>` / `reserve-released:<bookingId>`.
 * `bookingIds` / `hostIds` yalnızca testlerde kapsamı daraltmak içindir.
 */
export async function runEscrowRelease(
  now: Date = new Date(),
  opts: { bookingIds?: string[]; hostIds?: string[]; limit?: number } = {}
): Promise<EscrowReleaseResult> {
  const cfg = getConfig();
  const limit = opts.limit ?? 500;
  const horizon = new Date(now.getTime() - cfg.PAYOUT_RELEASE_HOURS * HOUR_MS + TIMEZONE_SLACK_MS);
  const bookingFilter = opts.bookingIds
    ? Prisma.sql`AND b."id" = ANY(${opts.bookingIds}::text[])`
    : Prisma.empty;
  const hostFilter = opts.hostIds
    ? Prisma.sql`AND p."hostId" = ANY(${opts.hostIds}::text[])`
    : Prisma.empty;
  const candidates = await prisma.$queryRaw<Candidate[]>`
    WITH esc AS (
      SELECT e."bookingId"
        FROM "JournalLine" l
        JOIN "JournalEntry" e ON e."id" = l."entryId"
        JOIN "LedgerAccount" a ON a."id" = l."accountId"
       WHERE a."kind" = 'ESCROW' AND e."bookingId" IS NOT NULL
       GROUP BY e."bookingId"
      HAVING SUM(CASE WHEN l."side" = 'CREDIT' THEN l."amountMinor" ELSE -l."amountMinor" END) > 0
    )
    SELECT b."id", b."checkIn", p."hostId", p."timeZone", p."checkInTime"
      FROM esc
      JOIN "Booking" b ON b."id" = esc."bookingId"
      JOIN "Property" p ON p."id" = b."propertyId"
     WHERE b."status" IN ('CONFIRMED', 'COMPLETED', 'CANCELLED')
       AND b."checkIn" <= ${horizon}
       AND NOT EXISTS (
         SELECT 1 FROM "JournalEntry" r WHERE r."idempotencyKey" = 'escrow-released:' || b."id"
       )
       ${bookingFilter} ${hostFilter}
     ORDER BY b."checkIn" ASC
     LIMIT ${limit}`;

  let released = 0;
  for (const c of candidates) {
    if (releaseAt(c.checkIn, c, cfg.PAYOUT_RELEASE_HOURS).getTime() > now.getTime()) continue;
    try {
      if (await releaseBookingEscrow(c.id, c.hostId, now)) released += 1;
    } catch (error) {
      logger.error({ bookingId: c.id, err: (error as Error).message }, "escrow release failed");
    }
  }
  if (released > 0) {
    escrowReleaseTotal.inc({ kind: "escrow" }, released);
    logger.info({ released }, "escrow released");
  }
  const reservesReleased = await releaseDueReserves(now, opts);
  return { released, reservesReleased };
}

/** Tek rezervasyonun emanetini serbest bırakır (SERIALIZABLE; iptal ile satır kilidinde sıralanır). */
async function releaseBookingEscrow(
  bookingId: string,
  hostId: string,
  now: Date
): Promise<boolean> {
  const cfg = getConfig();
  return withSerializableRetry(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Booking" WHERE id = ${bookingId} FOR UPDATE`;
    const booking = await tx.booking.findUnique({
      where: { id: bookingId },
      select: { status: true },
    });
    if (!booking || !["CONFIRMED", "COMPLETED", "CANCELLED"].includes(booking.status)) return false;
    const balances = [...(await bookingEscrowMinor(tx, bookingId)).entries()].filter(
      ([, v]) => v > 0n
    );
    if (balances.length === 0) return false;
    if (balances.length > 1) {
      logger.warn({ bookingId, currencies: balances.length }, "multi-currency escrow; first used");
    }
    const [currency, amountMinor] = balances[0];
    const account = await tx.hostAccount.findUnique({
      where: { userId: hostId },
      select: { reservePercentBps: true },
    });
    const split = computeReleaseSplit(
      amountMinor,
      cfg.PLATFORM_COMMISSION_BPS,
      account?.reservePercentBps ?? cfg.PAYOUT_RESERVE_BPS
    );
    const res = await post.escrowReleased(tx, {
      bookingId,
      hostId,
      currency,
      amountMinor,
      platformFeeMinor: split.feeMinor,
      reserveMinor: split.reserveMinor,
      occurredAt: now,
    });
    return res.created;
  });
}

/** Süresi dolan rezervleri host_payable'a geçirir. */
async function releaseDueReserves(
  now: Date,
  opts: { bookingIds?: string[]; hostIds?: string[]; limit?: number }
): Promise<number> {
  const cutoff = new Date(now.getTime() - getConfig().RESERVE_RELEASE_DAYS * DAY_MS);
  const bookingFilter = opts.bookingIds
    ? Prisma.sql`AND e."bookingId" = ANY(${opts.bookingIds}::text[])`
    : Prisma.empty;
  const hostFilter = opts.hostIds
    ? Prisma.sql`AND a."ownerId" = ANY(${opts.hostIds}::text[])`
    : Prisma.empty;
  // P1-5: serbest bırakma sonrası iadeler rezervi kullanabilir → açılan tutar, rezervasyona
  // atfedilen KALAN rezervdir (o rezervasyonun host_reserve satırları net toplamı) ve ev
  // sahibinin güncel rezerv bakiyesiyle sınırlanır (host_reserve eksiye düşmez).
  const due = await prisma.$queryRaw<
    Array<{ bookingId: string; hostId: string; currency: string; amountMinor: bigint }>
  >`
    SELECT x."bookingId", x."hostId", x."currency", x."amountMinor" FROM (
    SELECT e."bookingId", a."ownerId" AS "hostId", l."currency", e."occurredAt",
           (SELECT COALESCE(SUM(CASE WHEN l2."side" = 'CREDIT' THEN l2."amountMinor" ELSE -l2."amountMinor" END), 0)
              FROM "JournalLine" l2
              JOIN "JournalEntry" e2 ON e2."id" = l2."entryId"
             WHERE l2."accountId" = l."accountId" AND l2."currency" = l."currency"
               AND e2."bookingId" = e."bookingId")::bigint AS "amountMinor"
      FROM "JournalEntry" e
      JOIN "JournalLine" l ON l."entryId" = e."id"
      JOIN "LedgerAccount" a ON a."id" = l."accountId"
     WHERE e."kind" = ${JournalKinds.EscrowReleased}
       AND a."kind" = 'HOST_RESERVE' AND l."side" = 'CREDIT'
       AND e."occurredAt" <= ${cutoff}
       AND NOT EXISTS (
         SELECT 1 FROM "JournalEntry" r WHERE r."idempotencyKey" = 'reserve-released:' || e."bookingId"
       )
       ${bookingFilter} ${hostFilter}
    ) x
     WHERE x."amountMinor" > 0
     ORDER BY x."occurredAt" ASC
     LIMIT ${opts.limit ?? 500}`;
  let count = 0;
  for (const r of due) {
    if (BigInt(r.amountMinor) <= 0n) continue;
    try {
      const res = await withSerializableRetry(async (tx) => {
        const hostReserve = (
          await getAccountBalance(tx, ledgerAccount.hostReserve(r.hostId), r.currency)
        ).balanceMinor;
        const amountMinor =
          BigInt(r.amountMinor) < hostReserve ? BigInt(r.amountMinor) : hostReserve;
        if (amountMinor <= 0n) return { created: false };
        return post.reserveReleased(tx, {
          bookingId: r.bookingId,
          hostId: r.hostId,
          currency: r.currency,
          amountMinor,
          occurredAt: now,
        });
      });
      if (res.created) count += 1;
    } catch (error) {
      logger.error(
        { bookingId: r.bookingId, err: (error as Error).message },
        "reserve release failed"
      );
    }
  }
  if (count > 0) escrowReleaseTotal.inc({ kind: "reserve" }, count);
  return count;
}
