import { addDays, type IsoDate } from "@/lib/time/nights";

/**
 * Esnek tarih araması (v4 P1-3, `flexDays` = ±N gün) — saf aday seçimi.
 *
 * `MinPriceByDate` satırlarından her tesis için, konaklama süresi korunarak giriş tarihi
 * −N…+N kaydırıldığında TAHMİNİ toplamı (gece başına en ucuz vergiler dahil fiyatların
 * toplamı) hesaplar ve en ucuz kaydırmayı aday olarak döner. Tahmin yalnızca aday
 * seçimi içindir: öneri, arama sonucuna eklenmeden önce teklif motoruyla (aynı oda/plan
 * kuralları, kısıtlar, misafir sayısı) KESİN olarak doğrulanır.
 */

export interface FlexRow {
  propertyId: string;
  date: IsoDate;
  minTotalMinor: number | null;
  availableRoomTypes: number;
  minStay: number | null;
  closedToArrival: boolean;
}

export interface FlexCandidate {
  propertyId: string;
  shiftDays: number;
  checkIn: IsoDate;
  checkOut: IsoDate;
  estimatedTotalMinor: number;
}

/** Konaklamanın `shift` gün kaydırılmış tahmini toplamı; satılamıyorsa null. */
export function estimateShift(
  byDate: ReadonlyMap<IsoDate, FlexRow>,
  nights: readonly IsoDate[],
  shift: number
): number | null {
  let total = 0;
  for (const [i, night] of nights.entries()) {
    const row = byDate.get(addDays(night, shift));
    if (!row || row.minTotalMinor === null || row.availableRoomTypes < 1) return null;
    if (i === 0) {
      if (row.closedToArrival) return null;
      if (row.minStay !== null && nights.length < row.minStay) return null;
    }
    total += row.minTotalMinor;
  }
  return total;
}

/**
 * Tesis başına en ucuz kaydırma adayı (0 hariç). Aday ancak tahmini toplamı, aynı
 * satırlardan hesaplanan asıl tarih tahmininden (yoksa `baseline`'dan) düşükse döner.
 * Eşitlikte asıl tarihe en yakın, sonra daha erken kaydırma seçilir (deterministik).
 */
export function pickFlexCandidates(input: {
  rows: readonly FlexRow[];
  nights: readonly IsoDate[];
  flexDays: number;
  /** Tesis başına asıl tarihlerin kesin (teklif motoru) toplamı; tahmin yoksa yedek. */
  baseline?: ReadonlyMap<string, number>;
}): Map<string, FlexCandidate> {
  const byProperty = new Map<string, Map<IsoDate, FlexRow>>();
  for (const row of input.rows) {
    let m = byProperty.get(row.propertyId);
    if (!m) byProperty.set(row.propertyId, (m = new Map()));
    m.set(row.date, row);
  }
  const shifts: number[] = [];
  for (let d = 1; d <= input.flexDays; d++) shifts.push(-d, d);
  const out = new Map<string, FlexCandidate>();
  const n = input.nights.length;
  if (n === 0) return out;
  for (const [propertyId, byDate] of byProperty) {
    const reference =
      estimateShift(byDate, input.nights, 0) ?? input.baseline?.get(propertyId) ?? null;
    let best: { shift: number; total: number } | null = null;
    for (const shift of shifts) {
      const total = estimateShift(byDate, input.nights, shift);
      if (total === null) continue;
      if (reference !== null && total >= reference) continue;
      if (!best || total < best.total) best = { shift, total };
    }
    if (best) {
      out.set(propertyId, {
        propertyId,
        shiftDays: best.shift,
        checkIn: addDays(input.nights[0], best.shift),
        checkOut: addDays(input.nights[n - 1], best.shift + 1),
        estimatedTotalMinor: best.total,
      });
    }
  }
  return out;
}
