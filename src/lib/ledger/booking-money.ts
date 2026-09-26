import type { Prisma } from "@prisma/client";
import { account } from "./accounts";
import { getAccountBalance } from "./balance";
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
  /** P1-7: iadenin gideceği yer — kart (`psp`, varsayılan) ya da misafir kredisi. */
  to?: "psp" | "guest_credit";
  /**
   * P1-7: tahsilatta yazılmış vergi payı (verilmezse `priceBreakdown`'dan `grossMinor` için
   * hesaplanır). Kredi harcamasının vergisi fark yöntemiyle yazıldığından iadesi bunu kullanır.
   */
  capturedTaxMinor?: bigint;
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

export interface HostRecoverySplit {
  reserveMinor: bigint;
  payableMinor: bigint;
  platformCoverMinor: bigint;
}

/**
 * Serbest bırakma sonrası iadenin ev sahibi payını kaynaklara böler (P1-5, saf):
 * önce rezerv, sonra kullanılabilir host_payable (bekleyen payout'lar düşülmüş), kalan
 * platform üstlenir → ev sahibi bakiyesi hiçbir zaman eksiye düşmez.
 */
export function splitHostRecovery(
  hostPartMinor: bigint,
  reserveBalanceMinor: bigint,
  availablePayableMinor: bigint
): HostRecoverySplit {
  const clamp = (v: bigint) => (v < 0n ? 0n : v);
  const need = clamp(hostPartMinor);
  const reserveMinor = need < clamp(reserveBalanceMinor) ? need : clamp(reserveBalanceMinor);
  const rest = need - reserveMinor;
  const payableMinor = rest < clamp(availablePayableMinor) ? rest : clamp(availablePayableMinor);
  return { reserveMinor, payableMinor, platformCoverMinor: rest - payableMinor };
}

/** host_payable − bekleyen (PENDING) payout'lar: iadenin geri alabileceği kullanılabilir bakiye. */
async function availablePayableMinor(tx: Tx, hostId: string, currency: string): Promise<bigint> {
  const [balance, legacy, host] = await Promise.all([
    getAccountBalance(tx, account.hostPayable(hostId), currency),
    tx.payout.aggregate({
      where: { userId: hostId, currency, status: "PENDING" },
      _sum: { amountMinor: true },
    }),
    tx.hostPayout.aggregate({
      where: { userId: hostId, currency, status: "PENDING" },
      _sum: { amountMinor: true },
    }),
  ]);
  return balance.balanceMinor - (legacy._sum.amountMinor ?? 0n) - (host._sum.amountMinor ?? 0n);
}

/**
 * İade jurnali. Emanet serbest bırakılmadıysa: Dr escrow + tax_payable / Cr psp_clearing.
 * Serbest bırakıldıysa (P1-4): vergi hariç tutar komisyon oranında platform_revenue'dan geri
 * alınır; ev sahibi payı (P1-5) ÖNCE host_reserve'den, yetmezse kullanılabilir host_payable'dan,
 * o da yetmezse platform üstlenir (platform_revenue) — ev sahibi bakiyesi eksiye düşmez.
 * Aynı anahtarla jurnal zaten varsa (retry) yeniden hesaplanmaz — serbest bırakma araya girse
 * bile içerik çakışması olmaz. Tutar 0 ise jurnal yok.
 */
export async function postRefundFromEscrow(
  tx: Tx,
  i: RefundJournalInput
): Promise<(PostResult & { recovery?: HostRecoverySplit }) | null> {
  if (i.refundMinor <= 0n) return null;
  const key = `refund-issued:${i.refundRef}`;
  const existing = await tx.journalEntry.findUnique({
    where: { idempotencyKey: key },
    select: { id: true },
  });
  if (existing) return { entryId: existing.id, created: false };
  const capturedTax = i.capturedTaxMinor ?? taxShareMinor(i.priceBreakdown, i.grossMinor);
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
    to: i.to ?? ("psp" as const),
    occurredAt: i.occurredAt,
  };
  if (!released) return postJournal(tx, refundIssued({ ...base, from: "escrow" }));
  const net = i.refundMinor - taxMinor;
  const rawFee =
    released.amountMinor > 0n ? mulDivHalfUp(net, released.feeMinor, released.amountMinor) : 0n;
  const fee = rawFee > net ? net : rawFee;
  const recovery = splitHostRecovery(
    net - fee,
    (await getAccountBalance(tx, account.hostReserve(released.hostId), i.currency)).balanceMinor,
    await availablePayableMinor(tx, released.hostId, i.currency)
  );
  const res = await postJournal(
    tx,
    refundIssued({
      ...base,
      from: "released",
      hostId: released.hostId,
      platformFeeMinor: fee,
      hostReserveMinor: recovery.reserveMinor,
      platformCoverMinor: recovery.platformCoverMinor,
    })
  );
  return { ...res, recovery };
}
