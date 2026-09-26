/**
 * P1-8 Omnibus (AB 2019/2161 → 98/6/EC md. 6a; TR Haksız Ticari Uygulamalar Yön. benzeri):
 * indirim duyurulduğunda referans ("önceki") fiyat, indirimden önceki son N gün içinde
 * UYGULANMIŞ en düşük fiyattır. Saf fonksiyon; veriyi `InventoryPriceHistory` sağlar.
 */

export interface PricePoint {
  /** Fiyatın yürürlüğe girdiği an. */
  effectiveAt: Date;
  priceMinor: number;
}

/**
 * `[now − days, now]` penceresinde herhangi bir anda yürürlükte olan fiyatların en düşüğü.
 * Aday kümesi: pencere başında yürürlükte olan fiyat (başlangıçtan önceki son değişiklik),
 * pencere içindeki tüm değişiklikler ve şu anki fiyat (`current`, şu an yürürlükte).
 * Gelecekteki (now'dan sonraki) kayıtlar yok sayılır.
 */
export function lowestPriceInWindow(
  history: readonly PricePoint[],
  current: number,
  now: Date,
  days: number
): number {
  const start = now.getTime() - days * 86_400_000;
  let lowest = current;
  let atStart: PricePoint | null = null;
  for (const p of history) {
    const t = p.effectiveAt.getTime();
    if (t > now.getTime()) continue;
    if (t <= start) {
      if (!atStart || t >= atStart.effectiveAt.getTime()) atStart = p;
      continue;
    }
    if (p.priceMinor < lowest) lowest = p.priceMinor;
  }
  if (atStart && atStart.priceMinor < lowest) lowest = atStart.priceMinor;
  return lowest;
}
