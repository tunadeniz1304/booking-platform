import { BookingStatus, PaymentStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getConfig } from "@/lib/config/app-config";
import { withSerializableRetry } from "@/lib/db/transactions";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/http/errors";
import { post, postRefundFromEscrow, taxShareMinor } from "@/lib/ledger";
import { minorFromDb } from "@/lib/money/money";
import { logger } from "@/lib/observability/logger";
import { counter } from "@/lib/observability/metrics";
import type { BookingCompletedPayload } from "@/lib/events/events";
import { cashbackMinor, pickLots, splitCreditRefund, staysToNextTier, tierFor } from "./rules";

/**
 * Cüzdan & sadakat (P1-7, ADR 0020 §Kredi). Para hareketi YALNIZ jurnalde
 * (`guest_credit:<userId>`); lot'lar (WalletCredit) harcama sırası ve son kullanma izi.
 *
 * Değişmez (kullanıcı + para birimi başına):
 *   guest_credit bakiyesi = Σ lot.remainingMinor + Σ RESERVED harcama.amountMinor
 * - cashback verme: creditIssued (Dr platform_revenue) + yeni lot
 * - rezerv: lot kalanları düşer, harcama RESERVED (jurnal yok — para henüz çıkmadı)
 * - onay: creditSpent (Dr guest_credit / Cr escrow + tax_payable), harcama SPENT
 * - bırakma: lot kalanları geri, harcama RELEASED
 * - iade: refundIssued to:"guest_credit" + orijinal son kullanma tarihli yeni lot(lar)
 * - süre dolumu: creditExpired (Dr guest_credit / Cr platform_revenue), lot kalanı 0
 */

type Tx = Prisma.TransactionClient;

export const walletEventsTotal = counter(
  "wallet_credit_events_total",
  "Cüzdan kredi olayları (issued/reserved/spent/released/refunded/expired)",
  ["event"] as const
);

export class InsufficientCreditError extends ConflictError {
  constructor(availableMinor: number) {
    super("Kullanılabilir kredi yetersiz", "INSUFFICIENT_CREDIT", { availableMinor });
    this.name = "InsufficientCreditError";
  }
}

// ---------------------------------------------------------------------------
// Rezerv / onay / bırakma (ödeme sagası)
// ---------------------------------------------------------------------------

/** Rezervasyonun etkin (RESERVED | SPENT) kredi harcaması. */
export function activeCreditSpend(db: Tx | typeof prisma, bookingId: string) {
  return db.creditSpend.findFirst({
    where: { bookingId, status: { in: ["RESERVED", "SPENT"] } },
    select: {
      id: true,
      userId: true,
      currency: true,
      amountMinor: true,
      taxMinor: true,
      refundedMinor: true,
      status: true,
    },
  });
}

/** Kullanıcının para birimindeki harcanabilir kredisi (süresi dolmamış lot kalanları). */
export async function availableCreditMinor(
  db: Tx | typeof prisma,
  userId: string,
  currency: string,
  now = new Date()
): Promise<number> {
  const agg = await db.walletCredit.aggregate({
    where: { userId, currency, remainingMinor: { gt: 0 }, expiresAt: { gt: now } },
    _sum: { remainingMinor: true },
  });
  return minorFromDb(agg._sum.remainingMinor ?? 0n);
}

/**
 * Rezervasyonun kredi bırakması (kart reddi, saga telafisi, tutma süresi dolumu, iptal):
 * RESERVED harcamanın lot kalanları geri yazılır. SPENT'e dokunmaz; idempotent.
 */
export async function releaseBookingCreditInTx(
  tx: Tx,
  bookingId: string,
  reason: string,
  now = new Date()
): Promise<number> {
  const spend = await tx.creditSpend.findFirst({
    where: { bookingId, status: "RESERVED" },
    select: { id: true, allocations: { select: { creditId: true, amountMinor: true } } },
  });
  if (!spend) return 0;
  const marked = await tx.creditSpend.updateMany({
    where: { id: spend.id, status: "RESERVED" },
    data: { status: "RELEASED", releaseReason: reason, releasedAt: now },
  });
  if (marked.count !== 1) return 0;
  let released = 0n;
  for (const a of spend.allocations) {
    await tx.walletCredit.update({
      where: { id: a.creditId },
      data: { remainingMinor: { increment: a.amountMinor } },
    });
    released += a.amountMinor;
  }
  walletEventsTotal.inc({ event: "released" });
  return minorFromDb(released);
}

/** Tek işlemde bırakma (saga telafisi / ret yolları). */
export function releaseBookingCredit(bookingId: string, reason: string): Promise<number> {
  return withSerializableRetry((tx) => releaseBookingCreditInTx(tx, bookingId, reason));
}

/**
 * Kredi rezervi: son kullanma tarihi en yakın lot'lardan (FIFO) düşer. Lot satırları
 * `FOR UPDATE` ile kilitlenir → aynı krediyi harcamaya çalışan eşzamanlı iki ödeme
 * sıralanır; ikincisi güncel kalanı görür (yetmezse 409 INSUFFICIENT_CREDIT).
 * Önce rezervasyonun eski RESERVED harcaması bırakılır (tutar değişen yeniden deneme).
 */
export async function reserveBookingCreditInTx(
  tx: Tx,
  i: { bookingId: string; userId: string; currency: string; amountMinor: number },
  now = new Date()
): Promise<{ spendId: string | null; amountMinor: number }> {
  await releaseBookingCreditInTx(tx, i.bookingId, "replaced", now);
  if (i.amountMinor <= 0) return { spendId: null, amountMinor: 0 };
  const lots = await tx.$queryRaw<Array<{ id: string; remainingMinor: bigint; expiresAt: Date }>>`
    SELECT id, "remainingMinor", "expiresAt" FROM "WalletCredit"
    WHERE "userId" = ${i.userId} AND currency = ${i.currency}
      AND "remainingMinor" > 0 AND "expiresAt" > ${now}
    ORDER BY "expiresAt" ASC, id ASC
    FOR UPDATE`;
  const picks = pickLots(
    lots.map((l) => ({
      id: l.id,
      remainingMinor: minorFromDb(l.remainingMinor),
      expiresAt: l.expiresAt,
    })),
    i.amountMinor
  );
  if (!picks) {
    throw new InsufficientCreditError(lots.reduce((s, l) => s + minorFromDb(l.remainingMinor), 0));
  }
  for (const p of picks) {
    const updated = await tx.walletCredit.updateMany({
      where: { id: p.id, remainingMinor: { gte: BigInt(p.amountMinor) } },
      data: { remainingMinor: { decrement: BigInt(p.amountMinor) } },
    });
    if (updated.count !== 1) throw new InsufficientCreditError(0);
  }
  const spend = await tx.creditSpend.create({
    data: {
      userId: i.userId,
      bookingId: i.bookingId,
      currency: i.currency,
      amountMinor: BigInt(i.amountMinor),
      allocations: {
        create: picks.map((p) => ({ creditId: p.id, amountMinor: BigInt(p.amountMinor) })),
      },
    },
    select: { id: true },
  });
  walletEventsTotal.inc({ event: "reserved" });
  return { spendId: spend.id, amountMinor: i.amountMinor };
}

/**
 * Checkout'ta istenen krediyi doğrular ve rezerve eder (tek rezervasyon; ödeme kilidi altında).
 * Kartla en az `WALLET_MIN_CARD_MINOR` ödenmeli (tam kredi ödemesi yok).
 */
export async function reserveCreditForCheckout(i: {
  bookingId: string;
  userId: string;
  currency: string;
  totalMinor: number;
  creditMinor: number;
}): Promise<number> {
  if (!Number.isSafeInteger(i.creditMinor) || i.creditMinor < 0) {
    throw new ValidationError("Kredi tutarı negatif olmayan tamsayı olmalı");
  }
  const max = Math.max(0, i.totalMinor - getConfig().WALLET_MIN_CARD_MINOR);
  if (i.creditMinor > max) {
    throw new ConflictError(
      "Kredi, kartla ödenecek asgari tutarı bırakmalı",
      "CREDIT_EXCEEDS_LIMIT",
      {
        maxCreditMinor: max,
      }
    );
  }
  const res = await withSerializableRetry((tx) =>
    reserveBookingCreditInTx(tx, {
      bookingId: i.bookingId,
      userId: i.userId,
      currency: i.currency,
      amountMinor: i.creditMinor,
    })
  );
  return res.amountMinor;
}

/**
 * Onay pivotunda (AYNI işlem): RESERVED harcama SPENT + creditSpent jurnali. Vergi payı
 * fark yöntemiyle: vergi(toplam) − vergi(kart) → kart + kredi vergisi = toplam vergi.
 * Harcama yoksa no-op. Kart tutarı + kredi ≠ toplam ise 409 (bırakılmış kredi; çağıran iade eder).
 */
export async function settleBookingCreditInTx(
  tx: Tx,
  i: {
    bookingId: string;
    totalMinor: bigint;
    cardMinor: bigint;
    priceBreakdown: unknown;
    currency: string;
  },
  now = new Date()
): Promise<void> {
  const spend = await activeCreditSpend(tx, i.bookingId);
  const creditMinor = spend?.amountMinor ?? 0n;
  if (i.cardMinor + creditMinor !== i.totalMinor && (spend || i.cardMinor < i.totalMinor)) {
    throw new ConflictError("Ödeme tutarı rezervasyonla eşleşmiyor", "PAYMENT_AMOUNT_MISMATCH");
  }
  if (!spend || spend.status !== "RESERVED") return;
  const rawTax =
    taxShareMinor(i.priceBreakdown, i.totalMinor) - taxShareMinor(i.priceBreakdown, i.cardMinor);
  const taxMinor = rawTax < 0n ? 0n : rawTax > spend.amountMinor ? spend.amountMinor : rawTax;
  await post.creditSpent(tx, {
    spendRef: spend.id,
    guestId: spend.userId,
    bookingId: i.bookingId,
    amountMinor: spend.amountMinor,
    taxMinor,
    currency: spend.currency,
    occurredAt: now,
  });
  await tx.creditSpend.update({
    where: { id: spend.id },
    data: { status: "SPENT", taxMinor, settledAt: now },
  });
  walletEventsTotal.inc({ event: "spent" });
}

/**
 * Kredi payının iadesi (iptal): orijinal lot'ların SON KULLANMA TARİHİYLE yeni lot(lar) +
 * refundIssued to:"guest_credit" (emanetten; serbest bırakılmışsa ev sahibi/komisyondan).
 * Vergi payı harcamadaki vergiden kümülatif oransal → tam iadede tam vergi geri döner.
 */
export async function refundBookingCreditInTx(
  tx: Tx,
  i: { bookingId: string; paymentId: string; refundMinor: number; priceBreakdown: unknown },
  now = new Date()
): Promise<number> {
  if (i.refundMinor <= 0) return 0;
  const spend = await tx.creditSpend.findFirst({
    where: { bookingId: i.bookingId, status: "SPENT" },
    select: {
      id: true,
      userId: true,
      currency: true,
      amountMinor: true,
      taxMinor: true,
      refundedMinor: true,
      allocations: {
        orderBy: { id: "asc" },
        select: {
          id: true,
          amountMinor: true,
          refundedMinor: true,
          credit: { select: { expiresAt: true } },
        },
      },
    },
  });
  if (!spend) return 0;
  const open = minorFromDb(spend.amountMinor - spend.refundedMinor);
  const amount = Math.min(i.refundMinor, open);
  if (amount <= 0) return 0;
  const refundedBefore = spend.refundedMinor;
  await postRefundFromEscrow(tx, {
    refundRef: `credit:${spend.id}:${refundedBefore}`,
    bookingId: i.bookingId,
    paymentId: i.paymentId,
    guestId: spend.userId,
    currency: spend.currency,
    grossMinor: spend.amountMinor,
    priceBreakdown: i.priceBreakdown,
    capturedTaxMinor: spend.taxMinor,
    refundedBeforeMinor: refundedBefore,
    refundMinor: BigInt(amount),
    to: "guest_credit",
    occurredAt: now,
  });
  const parts = splitCreditRefund(
    amount,
    spend.allocations.map((a) => ({
      id: a.id,
      openMinor: minorFromDb(a.amountMinor - a.refundedMinor),
    }))
  );
  for (const part of parts) {
    const alloc = spend.allocations.find((a) => a.id === part.id)!;
    await tx.walletCredit.create({
      data: {
        userId: spend.userId,
        currency: spend.currency,
        source: "REFUND",
        sourceRef: `refund:${spend.id}:${alloc.id}:${alloc.refundedMinor}`,
        amountMinor: BigInt(part.amountMinor),
        remainingMinor: BigInt(part.amountMinor),
        expiresAt: alloc.credit.expiresAt,
        bookingId: i.bookingId,
        createdAt: now,
      },
    });
    await tx.creditSpendAllocation.update({
      where: { id: alloc.id },
      data: { refundedMinor: { increment: BigInt(part.amountMinor) } },
    });
  }
  await tx.creditSpend.update({
    where: { id: spend.id },
    data: { refundedMinor: { increment: BigInt(amount) } },
  });
  walletEventsTotal.inc({ event: "refunded" });
  return amount;
}

// ---------------------------------------------------------------------------
// Sadakat: seviye + cashback
// ---------------------------------------------------------------------------

/**
 * `booking.completed` tüketicisi (idempotent): seviye TAMAMLANAN konaklamalar yeniden
 * sayılarak hesaplanır (artırma değil → tekrar teslim güvenli), cashback kaydı
 * (bookingId unique) yeni seviyenin oranıyla, iade/talep penceresi sonrasına vadelenir.
 */
export async function onStayCompleted(p: BookingCompletedPayload): Promise<void> {
  const cfg = getConfig();
  await withSerializableRetry(async (tx) => {
    const completedStays = await tx.booking.count({
      where: { userId: p.userId, status: BookingStatus.COMPLETED },
    });
    const tier = tierFor(completedStays, cfg.LOYALTY_TIER_THRESHOLDS);
    await tx.loyaltyAccount.upsert({
      where: { userId: p.userId },
      create: { userId: p.userId, completedStays, tier },
      update: { completedStays, tier },
    });
    const booking = await tx.booking.findUnique({
      where: { id: p.bookingId },
      select: { currency: true },
    });
    if (!booking) return;
    const completedAt = new Date(p.completedAt);
    await tx.loyaltyCashback.createMany({
      data: [
        {
          bookingId: p.bookingId,
          userId: p.userId,
          currency: booking.currency,
          tier,
          bps: cfg.LOYALTY_CASHBACK_BPS[tier] ?? 0,
          dueAt: new Date(completedAt.getTime() + cfg.LOYALTY_CASHBACK_DELAY_DAYS * 86_400_000),
        },
      ],
      skipDuplicates: true,
    });
  });
}

/**
 * Vadesi gelen cashback'leri krediye çevirir. Taban = kartla ödenen net tutar (ödeme −
 * iadeler; krediyle ödenen kısım cashback kazandırmaz). Devredilmiş rezervasyon (ödeme
 * başka kullanıcının) ya da iptal/iade ile taban 0 → SKIPPED.
 */
export async function issueDueCashbacks(now = new Date(), limit = 200): Promise<number> {
  const cfg = getConfig();
  const due = await prisma.loyaltyCashback.findMany({
    where: { status: "PENDING", dueAt: { lte: now } },
    orderBy: { dueAt: "asc" },
    take: limit,
    select: { id: true },
  });
  let issued = 0;
  for (const { id } of due) {
    const ok = await withSerializableRetry(async (tx) => {
      const cb = await tx.loyaltyCashback.findUnique({ where: { id } });
      if (!cb || cb.status !== "PENDING") return false;
      const booking = await tx.booking.findUnique({
        where: { id: cb.bookingId },
        select: {
          userId: true,
          status: true,
          payment: {
            select: {
              userId: true,
              status: true,
              amountMinor: true,
              refundedAmountMinor: true,
              currency: true,
            },
          },
        },
      });
      const pay = booking?.payment;
      const skip = (reason: string) =>
        tx.loyaltyCashback.update({
          where: { id },
          data: { status: "SKIPPED", reason, amountMinor: 0n, issuedAt: now },
        });
      if (!booking || booking.status !== BookingStatus.COMPLETED || !pay) {
        await skip("NOT_ELIGIBLE");
        return false;
      }
      if (pay.userId !== cb.userId || booking.userId !== cb.userId) {
        await skip("TRANSFERRED");
        return false;
      }
      const paidStatuses: PaymentStatus[] = [PaymentStatus.PAID, PaymentStatus.PARTIALLY_REFUNDED];
      const base = paidStatuses.includes(pay.status)
        ? minorFromDb(pay.amountMinor - pay.refundedAmountMinor)
        : 0;
      const amount = cashbackMinor(base, cb.bps, pay.currency);
      if (amount <= 0) {
        await skip("ZERO_BASE");
        return false;
      }
      const lot = await tx.walletCredit.create({
        data: {
          userId: cb.userId,
          currency: pay.currency,
          source: "CASHBACK",
          sourceRef: `cashback:${cb.bookingId}`,
          amountMinor: BigInt(amount),
          remainingMinor: BigInt(amount),
          expiresAt: new Date(now.getTime() + cfg.WALLET_CREDIT_TTL_DAYS * 86_400_000),
          bookingId: cb.bookingId,
          createdAt: now,
        },
        select: { id: true },
      });
      await post.creditIssued(tx, {
        creditRef: `cashback:${cb.bookingId}`,
        guestId: cb.userId,
        amountMinor: BigInt(amount),
        fundedBy: "platform",
        bookingId: cb.bookingId,
        currency: pay.currency,
        occurredAt: now,
        memo: `cashback tier ${cb.tier} (${cb.bps} bps)`,
      });
      await tx.loyaltyCashback.update({
        where: { id },
        data: { status: "ISSUED", amountMinor: BigInt(amount), issuedAt: now, creditId: lot.id },
      });
      return true;
    });
    if (ok) {
      issued += 1;
      walletEventsTotal.inc({ event: "issued" });
    }
  }
  return issued;
}

/**
 * v5#20: cashback verildikten SONRA gelen iade / kaybedilen itiraz krediyi düşürür. Hak edilen
 * tutar güncel net kart tabanından (ödeme − iadeler − kaybedilen itirazlar − `extraOutMinor`)
 * yeniden hesaplanır; fazlası önce bu cashback lot'unun harcanmamış kısmından geri alınır,
 * yetmezse bakiye eksiye düşürülmez — kalan `platform_loss`'a yazılır (`creditClawback`).
 * `LoyaltyCashback.amountMinor` hak edilen tutara iner → tekrar çağrı yalnız yeni farkı işler.
 * Döner: geri alınan toplam (lot + zarar).
 */
export async function clawbackCashbackInTx(
  tx: Tx,
  bookingId: string,
  opts: { now?: Date; extraOutMinor?: bigint; excludeClaimId?: string } = {}
): Promise<bigint> {
  const cb = await tx.loyaltyCashback.findUnique({ where: { bookingId } });
  if (!cb || cb.status !== "ISSUED" || !cb.amountMinor || cb.amountMinor <= 0n) return 0n;
  const payment = await tx.payment.findUnique({
    where: { bookingId },
    select: { amountMinor: true, refundedAmountMinor: true, currency: true },
  });
  if (!payment) return 0n;
  const chargebacks = await tx.claim.aggregate({
    where: {
      bookingId,
      type: "CHARGEBACK",
      status: "RESOLVED_APPROVED",
      ...(opts.excludeClaimId ? { id: { not: opts.excludeClaimId } } : {}),
    },
    _sum: { awardedMinor: true },
  });
  const net =
    payment.amountMinor -
    payment.refundedAmountMinor -
    (chargebacks._sum.awardedMinor ?? 0n) -
    (opts.extraOutMinor ?? 0n);
  const entitled = BigInt(cashbackMinor(net > 0n ? minorFromDb(net) : 0, cb.bps, payment.currency));
  const excess = cb.amountMinor - entitled;
  if (excess <= 0n) return 0n;

  let recovered = 0n;
  if (cb.creditId) {
    const lot = await tx.walletCredit.findUnique({
      where: { id: cb.creditId },
      select: { remainingMinor: true },
    });
    const available = lot?.remainingMinor ?? 0n;
    recovered = available < excess ? available : excess;
    if (recovered > 0n) {
      const res = await tx.walletCredit.updateMany({
        where: { id: cb.creditId, remainingMinor: { gte: recovered } },
        data: { remainingMinor: { decrement: recovered } },
      });
      if (res.count !== 1) {
        throw new ConflictError("Kredi eşzamanlı değişti", "CONCURRENT_UPDATE");
      }
    }
  }
  await post.creditClawback(tx, {
    clawbackRef: `cashback:${bookingId}:${entitled}`,
    guestId: cb.userId,
    bookingId,
    currency: payment.currency,
    recoveredMinor: recovered,
    unrecoveredMinor: excess - recovered,
    occurredAt: opts.now,
  });
  await tx.loyaltyCashback.update({
    where: { id: cb.id },
    data: { amountMinor: entitled, reason: "CLAWED_BACK" },
  });
  walletEventsTotal.inc({ event: "cashback_clawback" });
  return excess;
}

/**
 * Süre dolumu (BullMQ `wallet-sweep`): son kullanma tarihi geçmiş lot'un KALANI ters
 * jurnalle (creditExpired) düşer. Anahtar lot + önceden düşülen tutar → aynı lot'a sonradan
 * (rezerv bırakma) dönen tutar ayrı jurnalle düşer; tekrar koşu no-op.
 */
export async function expireCredits(now = new Date(), limit = 500): Promise<number> {
  const lots = await prisma.walletCredit.findMany({
    where: { expiresAt: { lte: now }, remainingMinor: { gt: 0 } },
    orderBy: { expiresAt: "asc" },
    take: limit,
    select: { id: true },
  });
  let expired = 0;
  for (const { id } of lots) {
    const done = await withSerializableRetry(async (tx) => {
      const [lot] = await tx.$queryRaw<
        Array<{
          userId: string;
          currency: string;
          remainingMinor: bigint;
          expiredMinor: bigint;
          expiresAt: Date;
        }>
      >`SELECT "userId", currency, "remainingMinor", "expiredMinor", "expiresAt"
        FROM "WalletCredit" WHERE id = ${id} FOR UPDATE`;
      if (!lot || lot.remainingMinor <= 0n || lot.expiresAt.getTime() > now.getTime()) return false;
      await post.creditExpired(tx, {
        expiryRef: `${id}:${lot.expiredMinor}`,
        guestId: lot.userId,
        amountMinor: lot.remainingMinor,
        currency: lot.currency,
        occurredAt: now,
      });
      await tx.walletCredit.update({
        where: { id },
        data: { remainingMinor: 0n, expiredMinor: { increment: lot.remainingMinor } },
      });
      return true;
    });
    if (done) {
      expired += 1;
      walletEventsTotal.inc({ event: "expired" });
    }
  }
  return expired;
}

/**
 * Güvenlik ağı: rezervasyonu artık ödeme beklemeyen (HELD değil) RESERVED harcamaları
 * bırakır (ör. süreç ödeme ortasında çöktü). Normal yollar bunu işlem içinde yapar.
 */
export async function releaseStaleReservations(limit = 200): Promise<number> {
  const stale = await prisma.$queryRaw<Array<{ bookingId: string; status: string }>>`
    SELECT s."bookingId", b.status::text AS status FROM "CreditSpend" s
    JOIN "Booking" b ON b.id = s."bookingId"
    WHERE s.status = 'RESERVED' AND b.status <> 'HELD'
    LIMIT ${limit}`;
  let n = 0;
  for (const s of stale) {
    n += (await releaseBookingCredit(s.bookingId, `booking_${s.status.toLowerCase()}`)) > 0 ? 1 : 0;
  }
  return n;
}

/** Periyodik iş: cashback verme + süre dolumu + bayat rezerv temizliği. */
export async function runWalletSweep(now = new Date()) {
  const issued = await issueDueCashbacks(now);
  const expired = await expireCredits(now);
  const released = await releaseStaleReservations();
  if (issued + expired + released > 0) {
    logger.info({ issued, expired, released }, "wallet sweep");
  }
  return { issued, expired, released };
}

// ---------------------------------------------------------------------------
// Okuma (hesap sayfası / checkout)
// ---------------------------------------------------------------------------

export interface WalletView {
  tier: number;
  completedStays: number;
  cashbackBps: number;
  staysToNextTier: number | null;
  nextTierBps: number | null;
  balances: Array<{ currency: string; availableMinor: number; nextExpiryAt: string | null }>;
  lots: Array<{
    id: string;
    source: "CASHBACK" | "REFUND";
    currency: string;
    amountMinor: number;
    remainingMinor: number;
    expiresAt: string;
    expired: boolean;
    createdAt: string;
  }>;
  pendingCashback: Array<{ bookingId: string; currency: string; bps: number; dueAt: string }>;
}

export async function getWallet(userId: string, now = new Date()): Promise<WalletView> {
  const cfg = getConfig();
  const [account, lots, pending] = await Promise.all([
    prisma.loyaltyAccount.findUnique({ where: { userId } }),
    prisma.walletCredit.findMany({
      where: { userId },
      orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
      take: 100,
    }),
    prisma.loyaltyCashback.findMany({
      where: { userId, status: "PENDING" },
      orderBy: { dueAt: "asc" },
      take: 20,
      select: { bookingId: true, currency: true, bps: true, dueAt: true },
    }),
  ]);
  const completedStays = account?.completedStays ?? 0;
  const tier = tierFor(completedStays, cfg.LOYALTY_TIER_THRESHOLDS);
  const balances = new Map<string, { availableMinor: number; nextExpiryAt: Date | null }>();
  for (const l of lots) {
    const live = l.expiresAt.getTime() > now.getTime() && l.remainingMinor > 0n;
    if (!live) continue;
    const b = balances.get(l.currency) ?? { availableMinor: 0, nextExpiryAt: null };
    b.availableMinor += minorFromDb(l.remainingMinor);
    if (!b.nextExpiryAt || l.expiresAt < b.nextExpiryAt) b.nextExpiryAt = l.expiresAt;
    balances.set(l.currency, b);
  }
  return {
    tier,
    completedStays,
    cashbackBps: cfg.LOYALTY_CASHBACK_BPS[tier] ?? 0,
    staysToNextTier: staysToNextTier(completedStays, cfg.LOYALTY_TIER_THRESHOLDS),
    nextTierBps: cfg.LOYALTY_CASHBACK_BPS[tier + 1] ?? null,
    balances: [...balances.entries()].map(([currency, b]) => ({
      currency,
      availableMinor: b.availableMinor,
      nextExpiryAt: b.nextExpiryAt?.toISOString() ?? null,
    })),
    lots: lots.map((l) => ({
      id: l.id,
      source: l.source,
      currency: l.currency,
      amountMinor: minorFromDb(l.amountMinor),
      remainingMinor: minorFromDb(l.remainingMinor),
      expiresAt: l.expiresAt.toISOString(),
      expired: l.expiresAt.getTime() <= now.getTime(),
      createdAt: l.createdAt.toISOString(),
    })),
    pendingCashback: pending.map((p) => ({
      bookingId: p.bookingId,
      currency: p.currency,
      bps: p.bps,
      dueAt: p.dueAt.toISOString(),
    })),
  };
}

/** Checkout için: bu rezervasyonda kullanılabilecek azami kredi (+ mevcut rezerv). */
export async function creditOptionsForBooking(
  bookingId: string,
  userId: string,
  now = new Date()
): Promise<{
  currency: string;
  availableMinor: number;
  maxUsableMinor: number;
  reservedMinor: number;
}> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { userId: true, currency: true, totalPriceMinor: true, cartId: true },
  });
  if (!booking || booking.userId !== userId) {
    throw new NotFoundError("Rezervasyon bulunamadı");
  }
  const [available, spend] = await Promise.all([
    availableCreditMinor(prisma, userId, booking.currency, now),
    activeCreditSpend(prisma, bookingId),
  ]);
  const reserved = spend?.status === "RESERVED" ? minorFromDb(spend.amountMinor) : 0;
  const cap = Math.max(0, minorFromDb(booking.totalPriceMinor) - getConfig().WALLET_MIN_CARD_MINOR);
  const pool = available + reserved;
  return {
    currency: booking.currency,
    availableMinor: pool,
    maxUsableMinor: booking.cartId ? 0 : Math.min(pool, cap),
    reservedMinor: reserved,
  };
}
