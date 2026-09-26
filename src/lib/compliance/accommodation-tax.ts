import { rulesForNight, taxRulesFor } from "@/lib/pricing/tax";
import { addDays, parseIsoDate, type IsoDate } from "@/lib/time/nights";

/**
 * P1-13d — Konaklama vergisi oran tarihçesi (TR, 7194 s. Kanun md. 34 vd.).
 *
 * Tek kaynak: vergi motorunun her gece için kullandığı `rulesForNight` (pricing/tax.ts) ve
 * `data/tax-rules.json` / `TAX_RULES_JSON`. Bu modül ayrı bir oran tablosu TUTMAZ; fiyat
 * teklifi, rezervasyon ve arama ile aynı fonksiyondan okur → tarihçe ile hesap ayrışamaz.
 *
 * Varsayılan tarihçe: genel oran %2; 1 Mayıs 2026 – 31 Aralık 2026 (her iki gün dahil) %1.
 * Oran konaklanan GECENİN tarihine göre belirlenir (giriş/çıkış değil).
 */

export interface AccommodationTaxPeriod {
  from: IsoDate;
  /** Dahil son gece. */
  to: IsoDate;
  rateBps: number;
}

/** Verilen gece için konaklama vergisi oranı (baz puan); kural yoksa 0. */
export function accommodationTaxRateBps(
  date: IsoDate | string,
  country = "Türkiye",
  env?: Record<string, string | undefined>
): number {
  const night = typeof date === "string" ? parseIsoDate(date) : date;
  const rule = rulesForNight(taxRulesFor(country, env), night).find(
    (r) => r.kind === "ACCOMMODATION" && r.rateBps !== undefined
  );
  return rule?.rateBps ?? 0;
}

/**
 * [from, toInclusive] gecelerini aynı oranlı ardışık dönemlere böler (fatura/rapor kırılımı).
 * En fazla 3660 gece (10 yıl).
 */
export function accommodationTaxPeriods(
  from: IsoDate | string,
  toInclusive: IsoDate | string,
  country = "Türkiye",
  env?: Record<string, string | undefined>
): AccommodationTaxPeriod[] {
  const start = parseIsoDate(from);
  const end = parseIsoDate(toInclusive);
  const out: AccommodationTaxPeriod[] = [];
  let day = start;
  for (let i = 0; day <= end; i++, day = addDays(day, 1)) {
    if (i >= 3660) throw new RangeError("Aralık en fazla 3660 gece olabilir");
    const rateBps = accommodationTaxRateBps(day, country, env);
    const last = out[out.length - 1];
    if (last && last.rateBps === rateBps && addDays(last.to, 1) === day) last.to = day;
    else out.push({ from: day, to: day, rateBps });
  }
  return out;
}
