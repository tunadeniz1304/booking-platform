import { allocateMinor } from "@/lib/money/split";
import { bpsOf, money } from "@/lib/money/money";

/**
 * Sadakat & cüzdan (P1-7) saf kuralları — DB'siz test edilir. Tutarlar minor-unit;
 * lot/harcama bigint alanları çağıran tarafta `Number`'a çevrilir (tek kullanıcı bakiyesi
 * güvenli tamsayı aralığında).
 */

/** Seviye: tamamlanan konaklama sayısının geçtiği en yüksek eşiğin indeksi (0..n-1). */
export function tierFor(completedStays: number, thresholds: readonly number[]): number {
  let tier = 0;
  for (let i = 0; i < thresholds.length; i++) {
    if (completedStays >= thresholds[i]) tier = i;
  }
  return tier;
}

/** Sonraki seviyeye kalan konaklama (en üst seviyede null). */
export function staysToNextTier(
  completedStays: number,
  thresholds: readonly number[]
): number | null {
  const next = thresholds[tierFor(completedStays, thresholds) + 1];
  return next === undefined ? null : Math.max(0, next - completedStays);
}

/** Cashback = taban × bps / 10.000 (half-up, tek yuvarlama `bpsOf`); bps 0..10.000 ile sınırlı. */
export function cashbackMinor(baseMinor: number, bps: number, currency: string): number {
  if (baseMinor <= 0) return 0;
  const clamped = Math.min(10_000, Math.max(0, Math.trunc(bps)));
  return bpsOf(money(baseMinor, currency), clamped).amount;
}

export interface LotView {
  id: string;
  remainingMinor: number;
  expiresAt: Date;
}

/**
 * Harcamanın lot dağılımı: son kullanma tarihi EN YAKIN lot önce (FIFO), eşitlikte id.
 * Yetmezse null (çağıran 409 INSUFFICIENT_CREDIT verir).
 */
export function pickLots(
  lots: readonly LotView[],
  amountMinor: number
): Array<{ id: string; amountMinor: number }> | null {
  if (amountMinor <= 0) return [];
  const ordered = [...lots]
    .filter((l) => l.remainingMinor > 0)
    .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime() || (a.id < b.id ? -1 : 1));
  const out: Array<{ id: string; amountMinor: number }> = [];
  let rest = amountMinor;
  for (const lot of ordered) {
    if (rest === 0) break;
    const take = Math.min(rest, lot.remainingMinor);
    out.push({ id: lot.id, amountMinor: take });
    rest -= take;
  }
  return rest === 0 ? out : null;
}

/**
 * İade simetrisi: iade tutarı kart ve kredi paylarına ÖDENDİKLERİ oranda bölünür. Tek
 * yuvarlama kuralı `allocateMinor` (kalan kuruş indeks 0'a = kart). Her pay kendi ödenen
 * tutarını aşamaz (tam iade → tam kart + tam kredi).
 */
export function splitRefund(
  refundMinor: number,
  cardPaidMinor: number,
  creditPaidMinor: number
): { cardMinor: number; creditMinor: number } {
  if (refundMinor <= 0) return { cardMinor: 0, creditMinor: 0 };
  if (creditPaidMinor <= 0) return { cardMinor: refundMinor, creditMinor: 0 };
  if (cardPaidMinor <= 0) return { cardMinor: 0, creditMinor: refundMinor };
  const [card, credit] = allocateMinor(refundMinor, [cardPaidMinor, creditPaidMinor]);
  // Kalan kuruş karta düştüğünde kart payını aşarsa krediye kaydır (yalnız tam iade sınırında).
  if (card > cardPaidMinor)
    return { cardMinor: cardPaidMinor, creditMinor: credit + card - cardPaidMinor };
  return { cardMinor: card, creditMinor: credit };
}

/**
 * Kredi iadesinin harcama lot'larına dağılımı: her dağılımın iade edilmemiş kısmı ağırlık,
 * `allocateMinor` ile (kalan kuruş ilk lot'a; ilk lot'un kalanı yetmezse sıradakine taşar).
 */
export function splitCreditRefund(
  refundMinor: number,
  allocations: ReadonlyArray<{ id: string; openMinor: number }>
): Array<{ id: string; amountMinor: number }> {
  const open = allocations.filter((a) => a.openMinor > 0);
  const total = open.reduce((s, a) => s + a.openMinor, 0);
  if (refundMinor <= 0 || open.length === 0) return [];
  if (refundMinor > total) throw new RangeError("Kredi iadesi harcanan krediyi aşıyor");
  const parts = allocateMinor(
    refundMinor,
    open.map((a) => a.openMinor)
  );
  // Taşma düzeltmesi: indeks 0 kendi açık tutarını aşarsa fazlayı sıradakilere dağıt.
  let overflow = Math.max(0, parts[0] - open[0].openMinor);
  parts[0] -= overflow;
  for (let i = 1; i < parts.length && overflow > 0; i++) {
    const room = open[i].openMinor - parts[i];
    const add = Math.min(room, overflow);
    parts[i] += add;
    overflow -= add;
  }
  return open.map((a, i) => ({ id: a.id, amountMinor: parts[i] })).filter((p) => p.amountMinor > 0);
}
