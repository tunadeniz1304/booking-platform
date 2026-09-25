import { fromDate, type IsoDate } from "@/lib/time/nights";

/**
 * Satış kısıtları (v3 P0-2) — saf ve deterministik:
 *  - `stopSell`: konaklamanın herhangi bir gecesinde satış durdurulmuşsa satılamaz.
 *  - `minStay` / `maxStay`: VARIŞ gecesinin kısıtı esas alınır (sektör standardı "LOS on arrival").
 *  - `closedToArrival` (CTA): giriş günü varışa kapalı.
 *  - `closedToDeparture` (CTD): çıkış günü ayrılışa kapalı (çıkış günü bir gece değildir; o
 *    tarihin kısıt satırı kontrol edilir).
 */

export interface RestrictionRow {
  date: Date | IsoDate;
  minStay: number | null;
  maxStay: number | null;
  closedToArrival: boolean;
  closedToDeparture: boolean;
  stopSell: boolean;
}

export type RestrictionViolation =
  | { code: "STOP_SELL"; date: IsoDate }
  | { code: "MIN_STAY"; minStay: number }
  | { code: "MAX_STAY"; maxStay: number }
  | { code: "CLOSED_TO_ARRIVAL"; date: IsoDate }
  | { code: "CLOSED_TO_DEPARTURE"; date: IsoDate };

const iso = (d: Date | IsoDate): IsoDate => (d instanceof Date ? fromDate(d) : d);

/** İlk ihlali döner; kısıt yoksa `null`. */
export function checkRestrictions(
  stay: { checkIn: IsoDate; checkOut: IsoDate; nights: readonly IsoDate[] },
  rows: readonly RestrictionRow[]
): RestrictionViolation | null {
  const byDate = new Map(rows.map((r) => [iso(r.date), r]));
  for (const night of stay.nights) {
    if (byDate.get(night)?.stopSell) return { code: "STOP_SELL", date: night };
  }
  const arrival = byDate.get(stay.checkIn);
  if (arrival?.closedToArrival) return { code: "CLOSED_TO_ARRIVAL", date: stay.checkIn };
  if (byDate.get(stay.checkOut)?.closedToDeparture) {
    return { code: "CLOSED_TO_DEPARTURE", date: stay.checkOut };
  }
  const n = stay.nights.length;
  if (arrival?.minStay && n < arrival.minStay)
    return { code: "MIN_STAY", minStay: arrival.minStay };
  if (arrival?.maxStay && n > arrival.maxStay)
    return { code: "MAX_STAY", maxStay: arrival.maxStay };
  return null;
}

/** Kullanıcıya gösterilecek Türkçe açıklama. */
export function describeViolation(v: RestrictionViolation): string {
  switch (v.code) {
    case "STOP_SELL":
      return `${v.date} gecesi için satış kapalı`;
    case "MIN_STAY":
      return `Bu tarihte en az ${v.minStay} gece konaklama gerekir`;
    case "MAX_STAY":
      return `Bu tarihte en fazla ${v.maxStay} gece konaklanabilir`;
    case "CLOSED_TO_ARRIVAL":
      return `${v.date} tarihinde giriş yapılamaz`;
    case "CLOSED_TO_DEPARTURE":
      return `${v.date} tarihinde çıkış yapılamaz`;
  }
}
