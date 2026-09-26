import type { Prisma } from "@prisma/client";
import { account, type AccountRef } from "./accounts";
import {
  LedgerError,
  postJournal,
  type JournalInput,
  type JournalLineInput,
  type PostResult,
} from "./journal";

/**
 * Hazır jurnal şablonları (ADR 0020). Her şablon SAF bir `JournalInput` üretir (property
 * testleri DB'siz koşar) ve `post.*` aynı girdiyi `postJournal` ile yazar. Tutarlar
 * minor-unit bigint; sıfır tutarlı satırlar atlanır. Bölüşüm girdisi tutarı aşarsa 422.
 *
 * Akış:  capture → escrow (+vergi) → konaklama sonrası release → host_payable + gelir →
 *        payout ile psp_clearing'den çıkış. İade, paranın o an durduğu hesaptan düşer.
 */
export const JournalKinds = {
  BookingCaptured: "BOOKING_CAPTURED",
  RefundIssued: "REFUND_ISSUED",
  PayoutReleased: "PAYOUT_RELEASED",
  EscrowHeld: "ESCROW_HELD",
  EscrowReleased: "ESCROW_RELEASED",
  ReserveReleased: "RESERVE_RELEASED",
  TransferSettled: "TRANSFER_SETTLED",
  CreditIssued: "CREDIT_ISSUED",
  CreditSpent: "CREDIT_SPENT",
  CreditExpired: "CREDIT_EXPIRED",
  DepositCaptured: "DEPOSIT_CAPTURED",
  ChargebackLost: "CHARGEBACK_LOST",
} as const;

interface Common {
  currency: string;
  occurredAt?: Date;
  memo?: string;
}

function dr(acc: AccountRef, amountMinor: bigint, currency: string): JournalLineInput {
  return { account: acc, side: "DEBIT", amountMinor, currency };
}
function cr(acc: AccountRef, amountMinor: bigint, currency: string): JournalLineInput {
  return { account: acc, side: "CREDIT", amountMinor, currency };
}

function nonNegative(name: string, value: bigint): bigint {
  if (value < 0n) {
    throw new LedgerError(422, "LEDGER_INVALID_AMOUNT", `${name} negatif olamaz`, {
      [name]: value.toString(),
    });
  }
  return value;
}

function positive(name: string, value: bigint): bigint {
  if (nonNegative(name, value) === 0n) {
    throw new LedgerError(422, "LEDGER_INVALID_AMOUNT", `${name} sıfırdan büyük olmalı`);
  }
  return value;
}

/** total − parçalar; negatifse bölüşüm hatası. */
function remainder(total: bigint, parts: Record<string, bigint>): bigint {
  let rest = total;
  for (const [name, v] of Object.entries(parts)) rest -= nonNegative(name, v);
  if (rest < 0n) {
    throw new LedgerError(422, "LEDGER_INVALID_SPLIT", "Bölüşüm toplamı tutarı aşıyor", {
      total: total.toString(),
    });
  }
  return rest;
}

function entry(
  base: Common,
  meta: Omit<JournalInput, "lines" | "occurredAt" | "memo">,
  lines: JournalLineInput[]
): JournalInput {
  return {
    ...meta,
    occurredAt: base.occurredAt,
    memo: base.memo,
    lines: lines.filter((l) => l.amountMinor !== 0n),
  };
}

export interface BookingCapturedInput extends Common {
  bookingId: string;
  paymentId: string;
  grossMinor: bigint;
  taxMinor?: bigint;
}

/** PSP tahsilatı: Dr psp_clearing brüt / Cr escrow (brüt − vergi) / Cr tax_payable vergi. */
export function bookingCaptured(i: BookingCapturedInput): JournalInput {
  const gross = positive("grossMinor", i.grossMinor);
  const tax = i.taxMinor ?? 0n;
  const held = remainder(gross, { taxMinor: tax });
  return entry(
    i,
    {
      idempotencyKey: `booking-captured:${i.paymentId}`,
      kind: JournalKinds.BookingCaptured,
      bookingId: i.bookingId,
      paymentId: i.paymentId,
    },
    [
      dr(account.pspClearing(), gross, i.currency),
      cr(account.escrow(), held, i.currency),
      cr(account.taxPayable(), tax, i.currency),
    ]
  );
}

export interface EscrowHeldInput extends Common {
  /** Tutmanın doğal anahtarı (örn. depozito kimliği). */
  reference: string;
  amountMinor: bigint;
  bookingId?: string;
  paymentId?: string;
}

/** Ek tahsilatı emanete al: Dr psp_clearing / Cr escrow. */
export function escrowHeld(i: EscrowHeldInput): JournalInput {
  const amount = positive("amountMinor", i.amountMinor);
  return entry(
    i,
    {
      idempotencyKey: `escrow-held:${i.reference}`,
      kind: JournalKinds.EscrowHeld,
      bookingId: i.bookingId,
      paymentId: i.paymentId,
    },
    [dr(account.pspClearing(), amount, i.currency), cr(account.escrow(), amount, i.currency)]
  );
}

export interface EscrowReleasedInput extends Common {
  bookingId: string;
  hostId: string;
  /** Emanetten çıkan tutar (vergi hariç brüt = ev sahibi payı + platform komisyonu). */
  amountMinor: bigint;
  platformFeeMinor?: bigint;
  /** Ev sahibi payından rezerve ayrılan kısım (P1-4) → host_reserve(host). */
  reserveMinor?: bigint;
}

/**
 * Konaklama sonrası serbest bırakma: Dr escrow / Cr host_payable(host) / Cr platform_revenue
 * / Cr host_reserve(host).
 */
export function escrowReleased(i: EscrowReleasedInput): JournalInput {
  const amount = positive("amountMinor", i.amountMinor);
  const fee = i.platformFeeMinor ?? 0n;
  const reserve = i.reserveMinor ?? 0n;
  const hostNet = remainder(amount, { platformFeeMinor: fee, reserveMinor: reserve });
  return entry(
    i,
    {
      idempotencyKey: `escrow-released:${i.bookingId}`,
      kind: JournalKinds.EscrowReleased,
      bookingId: i.bookingId,
    },
    [
      dr(account.escrow(), amount, i.currency),
      cr(account.hostPayable(i.hostId), hostNet, i.currency),
      cr(account.platformRevenue(), fee, i.currency),
      cr(account.hostReserve(i.hostId), reserve, i.currency),
    ]
  );
}

export interface ReserveReleasedInput extends Common {
  bookingId: string;
  hostId: string;
  amountMinor: bigint;
}

/** Rezerv süresi doldu (P1-4): Dr host_reserve(host) / Cr host_payable(host). */
export function reserveReleased(i: ReserveReleasedInput): JournalInput {
  const amount = positive("amountMinor", i.amountMinor);
  return entry(
    i,
    {
      idempotencyKey: `reserve-released:${i.bookingId}`,
      kind: JournalKinds.ReserveReleased,
      bookingId: i.bookingId,
    },
    [
      dr(account.hostReserve(i.hostId), amount, i.currency),
      cr(account.hostPayable(i.hostId), amount, i.currency),
    ]
  );
}

export interface RefundIssuedInput extends Common {
  /** İadenin doğal anahtarı (PSP iade kimliği veya `cancel:<bookingId>`). */
  refundRef: string;
  bookingId: string;
  paymentId?: string;
  guestId: string;
  amountMinor: bigint;
  /** İade edilen vergi payı (tax_payable'dan düşer). */
  taxMinor?: bigint;
  /**
   * Para nerede duruyor: `escrow` (serbest bırakılmadan önce) ya da `released`
   * (sonra; ev sahibi payı + platform komisyonu geri alınır).
   */
  from: "escrow" | "released";
  hostId?: string;
  /** `released` iadede platform komisyonundan geri alınan pay. */
  platformFeeMinor?: bigint;
  /** `released` iadede ev sahibi payının ÖNCE rezervden (host_reserve) karşılanan kısmı (P1-5). */
  hostReserveMinor?: bigint;
  /**
   * `released` iadede ev sahibinin rezervi + kullanılabilir bakiyesi yetmediğinde platformun
   * üstlendiği kısım (platform_revenue'dan; ev sahibi bakiyesi eksiye düşmez, P1-5).
   */
  platformCoverMinor?: bigint;
  /** Nereye: kartına (`psp`) ya da misafir kredisine (`guest_credit`). */
  to?: "psp" | "guest_credit";
}

/**
 * İade: Dr (escrow | host_reserve + host_payable + platform_revenue) + tax_payable
 *       / Cr psp_clearing | guest_credit.
 */
export function refundIssued(i: RefundIssuedInput): JournalInput {
  const amount = positive("amountMinor", i.amountMinor);
  const tax = i.taxMinor ?? 0n;
  const debits: JournalLineInput[] = [dr(account.taxPayable(), tax, i.currency)];
  if (i.from === "escrow") {
    debits.push(dr(account.escrow(), remainder(amount, { taxMinor: tax }), i.currency));
  } else {
    if (!i.hostId) {
      throw new LedgerError(422, "LEDGER_INVALID_SPLIT", "Serbest bırakılmış iade hostId ister");
    }
    const fee = i.platformFeeMinor ?? 0n;
    const reserve = i.hostReserveMinor ?? 0n;
    const cover = i.platformCoverMinor ?? 0n;
    const hostPart = remainder(amount, {
      taxMinor: tax,
      platformFeeMinor: fee,
      hostReserveMinor: reserve,
      platformCoverMinor: cover,
    });
    debits.push(
      dr(account.hostReserve(i.hostId), reserve, i.currency),
      dr(account.hostPayable(i.hostId), hostPart, i.currency),
      dr(account.platformRevenue(), fee + cover, i.currency)
    );
  }
  const target = i.to === "guest_credit" ? account.guestCredit(i.guestId) : account.pspClearing();
  return entry(
    i,
    {
      idempotencyKey: `refund-issued:${i.refundRef}`,
      kind: JournalKinds.RefundIssued,
      bookingId: i.bookingId,
      paymentId: i.paymentId,
    },
    [...debits, cr(target, amount, i.currency)]
  );
}

export interface ChargebackLostInput extends Common {
  /** CHARGEBACK talebi (itiraz başına tek jurnal: `chargeback-lost:<claimId>`). */
  claimId: string;
  bookingId: string;
  paymentId?: string;
  /** Kart sahibine itirazla dönen tutar (psp_clearing'den çıkar). */
  amountMinor: bigint;
  taxMinor?: bigint;
  /** `escrow`: emanet serbest bırakılmadı (ev sahibi payı emanetten); `released`: sonra. */
  from: "escrow" | "released";
  hostId?: string;
  platformFeeMinor?: bigint;
  /** Ev sahibi payının rezervden (host_reserve) tahsil edilen kısmı. */
  hostReserveMinor?: bigint;
  /** Rezerv + kullanılabilir bakiye yetmeyince platform zararına (platform_loss) yazılan kısım. */
  platformLossMinor?: bigint;
}

/**
 * Kaybedilen itiraz (fix-sweep-2, ADR 0021 ek): para karta PSP'den döner (Cr psp_clearing,
 * misafir iadesi yönü). Borç tarafı iadeyle aynı sırayla ev sahibinden tahsildir: serbest
 * bırakılmadıysa emanet + vergi; bırakıldıysa vergi, komisyon payı (platform_revenue),
 * ev sahibi payı önce host_reserve → host_payable → kalan platform_loss (gider).
 */
export function chargebackLost(i: ChargebackLostInput): JournalInput {
  const amount = positive("amountMinor", i.amountMinor);
  const tax = i.taxMinor ?? 0n;
  const debits: JournalLineInput[] = [dr(account.taxPayable(), tax, i.currency)];
  if (i.from === "escrow") {
    debits.push(dr(account.escrow(), remainder(amount, { taxMinor: tax }), i.currency));
  } else {
    if (!i.hostId) {
      throw new LedgerError(422, "LEDGER_INVALID_SPLIT", "Serbest bırakılmış itiraz hostId ister");
    }
    const fee = i.platformFeeMinor ?? 0n;
    const reserve = i.hostReserveMinor ?? 0n;
    const loss = i.platformLossMinor ?? 0n;
    const hostPart = remainder(amount, {
      taxMinor: tax,
      platformFeeMinor: fee,
      hostReserveMinor: reserve,
      platformCoverMinor: loss,
    });
    debits.push(
      dr(account.hostReserve(i.hostId), reserve, i.currency),
      dr(account.hostPayable(i.hostId), hostPart, i.currency),
      dr(account.platformRevenue(), fee, i.currency),
      dr(account.platformLoss(), loss, i.currency)
    );
  }
  return entry(
    i,
    {
      idempotencyKey: `chargeback-lost:${i.claimId}`,
      kind: JournalKinds.ChargebackLost,
      bookingId: i.bookingId,
      paymentId: i.paymentId,
    },
    [...debits, cr(account.pspClearing(), amount, i.currency)]
  );
}

export interface PayoutReleasedInput extends Common {
  payoutId: string;
  payeeId: string;
  amountMinor: bigint;
  bookingId?: string;
  transferId?: string;
}

/** Ödeme çıkışı: Dr host_payable(payee) / Cr psp_clearing. */
export function payoutReleased(i: PayoutReleasedInput): JournalInput {
  const amount = positive("amountMinor", i.amountMinor);
  return entry(
    i,
    {
      idempotencyKey: `payout-released:${i.payoutId}`,
      kind: JournalKinds.PayoutReleased,
      bookingId: i.bookingId,
      transferId: i.transferId,
    },
    [
      dr(account.hostPayable(i.payeeId), amount, i.currency),
      cr(account.pspClearing(), amount, i.currency),
    ]
  );
}

export interface TransferSettledInput extends Common {
  transferId: string;
  bookingId: string;
  sellerId: string;
  /** Alıcının ödediği devir bedeli. */
  askMinor: bigint;
  platformFeeMinor?: bigint;
}

/** Devir kesinleşti: Dr psp_clearing ask / Cr host_payable(seller) / Cr platform_revenue. */
export function transferSettled(i: TransferSettledInput): JournalInput {
  const ask = positive("askMinor", i.askMinor);
  const fee = i.platformFeeMinor ?? 0n;
  const sellerNet = remainder(ask, { platformFeeMinor: fee });
  return entry(
    i,
    {
      idempotencyKey: `transfer-settled:${i.transferId}`,
      kind: JournalKinds.TransferSettled,
      bookingId: i.bookingId,
      transferId: i.transferId,
    },
    [
      dr(account.pspClearing(), ask, i.currency),
      cr(account.hostPayable(i.sellerId), sellerNet, i.currency),
      cr(account.platformRevenue(), fee, i.currency),
    ]
  );
}

export interface CreditIssuedInput extends Common {
  creditRef: string;
  guestId: string;
  amountMinor: bigint;
  /** Kredinin kaynağı: platform ikramı (gelirden) ya da emanetteki tutarın krediye çevrilmesi. */
  fundedBy: "platform" | "escrow";
  bookingId?: string;
}

/** Kredi tanımla: Dr platform_revenue | escrow / Cr guest_credit(guest). */
export function creditIssued(i: CreditIssuedInput): JournalInput {
  const amount = positive("amountMinor", i.amountMinor);
  const source = i.fundedBy === "escrow" ? account.escrow() : account.platformRevenue();
  return entry(
    i,
    {
      idempotencyKey: `credit-issued:${i.creditRef}`,
      kind: JournalKinds.CreditIssued,
      bookingId: i.bookingId,
    },
    [dr(source, amount, i.currency), cr(account.guestCredit(i.guestId), amount, i.currency)]
  );
}

export interface CreditSpentInput extends Common {
  spendRef: string;
  guestId: string;
  bookingId: string;
  amountMinor: bigint;
  taxMinor?: bigint;
}

/** Kredi ile ödeme (capture'ın kredi karşılığı): Dr guest_credit / Cr escrow + tax_payable. */
export function creditSpent(i: CreditSpentInput): JournalInput {
  const amount = positive("amountMinor", i.amountMinor);
  const tax = i.taxMinor ?? 0n;
  const held = remainder(amount, { taxMinor: tax });
  return entry(
    i,
    {
      idempotencyKey: `credit-spent:${i.spendRef}`,
      kind: JournalKinds.CreditSpent,
      bookingId: i.bookingId,
    },
    [
      dr(account.guestCredit(i.guestId), amount, i.currency),
      cr(account.escrow(), held, i.currency),
      cr(account.taxPayable(), tax, i.currency),
    ]
  );
}

export interface CreditExpiredInput extends Common {
  /** Süre dolumu anahtarı (`<lotId>:<önceden düşülen>` — aynı lot'ta tekrar dolum ayrı jurnal). */
  expiryRef: string;
  guestId: string;
  amountMinor: bigint;
}

/**
 * Süresi dolan kredi (P1-7): Dr guest_credit / Cr platform_revenue — ikramın (cashback)
 * kullanılmayan kısmı gelire geri döner (creditIssued'ın tersi, "breakage").
 */
export function creditExpired(i: CreditExpiredInput): JournalInput {
  const amount = positive("amountMinor", i.amountMinor);
  return entry(
    i,
    { idempotencyKey: `credit-expired:${i.expiryRef}`, kind: JournalKinds.CreditExpired },
    [
      dr(account.guestCredit(i.guestId), amount, i.currency),
      cr(account.platformRevenue(), amount, i.currency),
    ]
  );
}

export interface DepositCapturedInput extends Common {
  depositId: string;
  bookingId: string;
  hostId: string;
  /** PSP'de fiilen tahsil edilen depozito tutarı (≤ ön provizyon). */
  amountMinor: bigint;
}

/**
 * Hasar depozitosu tahsilatı (P1-5, ADR 0021): Dr psp_clearing / Cr host_payable(host).
 * Hasar tazminidir: platform komisyonu ve vergi yok, emanetten geçmez (konaklama bedeli
 * değil; karar anında ev sahibine borçlanılır). Ön provizyonu aşan tazmin talebi deftere
 * alacak olarak YAZILMAZ (tahsil edilemez; yalnız talep kaydında `uncollectedMinor`).
 */
export function depositCaptured(i: DepositCapturedInput): JournalInput {
  const amount = positive("amountMinor", i.amountMinor);
  return entry(
    i,
    {
      idempotencyKey: `deposit-captured:${i.depositId}`,
      kind: JournalKinds.DepositCaptured,
      bookingId: i.bookingId,
    },
    [
      dr(account.pspClearing(), amount, i.currency),
      cr(account.hostPayable(i.hostId), amount, i.currency),
    ]
  );
}

type Tx = Prisma.TransactionClient;

/** Şablonu aynı işlemde yazan kısayollar: `await post.bookingCaptured(tx, {...})`. */
export const post = {
  bookingCaptured: (tx: Tx, i: BookingCapturedInput): Promise<PostResult> =>
    postJournal(tx, bookingCaptured(i)),
  escrowHeld: (tx: Tx, i: EscrowHeldInput) => postJournal(tx, escrowHeld(i)),
  escrowReleased: (tx: Tx, i: EscrowReleasedInput) => postJournal(tx, escrowReleased(i)),
  reserveReleased: (tx: Tx, i: ReserveReleasedInput) => postJournal(tx, reserveReleased(i)),
  refundIssued: (tx: Tx, i: RefundIssuedInput) => postJournal(tx, refundIssued(i)),
  payoutReleased: (tx: Tx, i: PayoutReleasedInput) => postJournal(tx, payoutReleased(i)),
  transferSettled: (tx: Tx, i: TransferSettledInput) => postJournal(tx, transferSettled(i)),
  creditIssued: (tx: Tx, i: CreditIssuedInput) => postJournal(tx, creditIssued(i)),
  creditSpent: (tx: Tx, i: CreditSpentInput) => postJournal(tx, creditSpent(i)),
  creditExpired: (tx: Tx, i: CreditExpiredInput) => postJournal(tx, creditExpired(i)),
  depositCaptured: (tx: Tx, i: DepositCapturedInput) => postJournal(tx, depositCaptured(i)),
};
