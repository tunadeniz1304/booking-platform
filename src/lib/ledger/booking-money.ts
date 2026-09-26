import type { Prisma } from "@prisma/client";
import { postJournal, type PostResult } from "./journal";
import { bookingCaptured, refundIssued } from "./templates";

/**
 * Servis bağlama yardımcıları (F2c). Para hareketinin jurnal girdisini iş kaydından
 * deterministik türetir → aynı olay yeniden işlenirse (retry, tekrar webhook) içerik ve
 * idempotency anahtarı aynı kalır, `postJournal` tekrarı `{created:false}` döner.
 */

/** (a·num)/den, yarım yukarı; hepsi negatif olmayan bigint. */
function mulDivHalfUp(a: bigint, num: bigint, den: bigint): bigint {
  return (2n * a * num + den) / (2n * den);
}

/**
 * Tahsil edilen tutarın vergi payı. Kırılım (`priceBreakdown`) fiyatlandırma para
 * biriminde olabilir (kur çevrimi) → oransal: tahsilat × Σvergi / kırılım toplamı.
 * Aynı para biriminde kırılım toplamı tahsilata eşitse sonuç tam Σvergi'dir.
 */
export function taxShareMinor(breakdown: unknown, chargedMinor: bigint): bigint {
  const b = breakdown as { taxes?: Array<{ amount?: unknown }>; total?: unknown } | null;
  if (!b || !Array.isArray(b.taxes) || chargedMinor <= 0n) return 0n;
  const taxes = b.taxes.reduce(
    (sum, t) =>
      sum + (Number.isInteger(t.amount) && Number(t.amount) > 0 ? BigInt(Number(t.amount)) : 0n),
    0n
  );
  const total = Number.isInteger(b.total) ? BigInt(Number(b.total)) : 0n;
  if (taxes <= 0n || total <= 0n) return 0n;
  const share = mulDivHalfUp(chargedMinor, taxes, total);
  return share > chargedMinor ? chargedMinor : share;
}

/**
 * İadenin vergi payı: kümülatif oransal pay farkı. Parça parça iadelerin vergi payları
 * toplamı, tam iadede tahsilattaki vergiye TAM eşit olur (kuruş kayması yok).
 */
export function refundTaxMinor(
  capturedTaxMinor: bigint,
  grossMinor: bigint,
  refundedBeforeMinor: bigint,
  refundMinor: bigint
): bigint {
  if (grossMinor <= 0n || capturedTaxMinor <= 0n) return 0n;
  const at = (x: bigint) =>
    mulDivHalfUp(x > grossMinor ? grossMinor : x, capturedTaxMinor, grossMinor);
  return at(refundedBeforeMinor + refundMinor) - at(refundedBeforeMinor);
}

type Tx = Prisma.TransactionClient;

export interface CaptureJournalInput {
  bookingId: string;
  paymentId: string;
  currency: string;
  grossMinor: bigint;
  priceBreakdown: unknown;
  /** Varsayılan `booking-captured:<paymentId>`; telafi tahsilatı kendi anahtarını verir. */
  idempotencyKey?: string;
  occurredAt?: Date;
}

/** Tahsilat jurnali: Dr psp_clearing / Cr escrow (brüt − vergi) / Cr tax_payable. */
export async function postBookingCapture(
  tx: Tx,
  i: CaptureJournalInput
): Promise<PostResult | null> {
  if (i.grossMinor <= 0n) return null;
  const entry = bookingCaptured({
    bookingId: i.bookingId,
    paymentId: i.paymentId,
    currency: i.currency,
    grossMinor: i.grossMinor,
    taxMinor: taxShareMinor(i.priceBreakdown, i.grossMinor),
    occurredAt: i.occurredAt,
  });
  return postJournal(tx, i.idempotencyKey ? { ...entry, idempotencyKey: i.idempotencyKey } : entry);
}

export interface RefundJournalInput {
  /** İadenin doğal anahtarı (`cancel:<bookingId>`, `compensate:<providerRef>`, …). */
  refundRef: string;
  bookingId: string;
  paymentId: string;
  guestId: string;
  currency: string;
  /** Asıl tahsilat (vergi payı bundan oransal hesaplanır). */
  grossMinor: bigint;
  priceBreakdown: unknown;
  refundMinor: bigint;
  /** Bu iadeden önce aynı ödemeden iade edilmiş toplam. */
  refundedBeforeMinor?: bigint;
  occurredAt?: Date;
}

/**
 * Serbest bırakılmış rezervasyonun jurnal özeti (P1-4 `escrow-released:<bookingId>`):
 * emanetten çıkan tutar, komisyon ve ev sahibi. Serbest bırakılmadıysa null.
 */
export async function releasedSplitOf(
  tx: Tx,
  bookingId: string
): Promise<{ hostId: string; amountMinor: bigint; feeMinor: bigint } | null> {
  const entry = await tx.journalEntry.findUnique({
    where: { idempotencyKey: `escrow-released:${bookingId}` },
    select: {
      lines: {
        select: {
          side: true,
          amountMinor: true,
          account: { select: { kind: true, ownerId: true } },
        },
      },
    },
  });
  if (!entry) return null;
  let amountMinor = 0n;
  let feeMinor = 0n;
  let hostId: string | null = null;
  for (const l of entry.lines) {
    if (l.account.kind === "ESCROW" && l.side === "DEBIT") amountMinor += l.amountMinor;
    if (l.account.kind === "PLATFORM_REVENUE") feeMinor += l.amountMinor;
    if (l.account.kind === "HOST_PAYABLE" || l.account.kind === "HOST_RESERVE")
      hostId = l.account.ownerId;
  }
  return hostId ? { hostId, amountMinor, feeMinor } : null;
}

/**
 * İade jurnali. Emanet serbest bırakılmadıysa: Dr escrow + tax_payable / Cr psp_clearing.
 * Serbest bırakıldıysa (P1-4): vergi hariç tutar komisyon oranında platform_revenue'dan,
 * kalanı host_payable'dan geri alınır (ev sahibi bakiyesi eksiye düşebilir → payout
 * motoru yalnız pozitif kullanılabilir bakiyeyi öder). Aynı anahtarla jurnal zaten varsa
 * (retry) yeniden hesaplanmaz — serbest bırakma araya girse bile içerik çakışması olmaz.
 * Tutar 0 ise jurnal yok.
 */
export async function postRefundFromEscrow(
  tx: Tx,
  i: RefundJournalInput
): Promise<PostResult | null> {
  if (i.refundMinor <= 0n) return null;
  const key = `refund-issued:${i.refundRef}`;
  const existing = await tx.journalEntry.findUnique({
    where: { idempotencyKey: key },
    select: { id: true },
  });
  if (existing) return { entryId: existing.id, created: false };
  const capturedTax = taxShareMinor(i.priceBreakdown, i.grossMinor);
  const taxMinor = refundTaxMinor(
    capturedTax,
    i.grossMinor,
    i.refundedBeforeMinor ?? 0n,
    i.refundMinor
  );
  const released = await releasedSplitOf(tx, i.bookingId);
  const base = {
    refundRef: i.refundRef,
    bookingId: i.bookingId,
    paymentId: i.paymentId,
    guestId: i.guestId,
    currency: i.currency,
    amountMinor: i.refundMinor,
    taxMinor,
    to: "psp" as const,
    occurredAt: i.occurredAt,
  };
  if (!released) return postJournal(tx, refundIssued({ ...base, from: "escrow" }));
  const net = i.refundMinor - taxMinor;
  const fee =
    released.amountMinor > 0n ? mulDivHalfUp(net, released.feeMinor, released.amountMinor) : 0n;
  return postJournal(
    tx,
    refundIssued({
      ...base,
      from: "released",
      hostId: released.hostId,
      platformFeeMinor: fee > net ? net : fee,
    })
  );
}
