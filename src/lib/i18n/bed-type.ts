/**
 * Yatak tipi kodları (F1306). Oda kaydında arayüz dilinden bağımsız sabit kod saklanır; etiket
 * görüntülemede `common.bedTypes.<KOD>` çevirisinden gelir. Eski kayıtlar serbest metin olabilir.
 */
export const BED_TYPES = [
  "SINGLE",
  "DOUBLE",
  "TWIN",
  "QUEEN",
  "KING",
  "SOFA_BED",
  "BUNK",
  "MIXED",
] as const;

export type BedType = (typeof BED_TYPES)[number];

export const DEFAULT_BED_TYPE: BedType = "DOUBLE";

/**
 * Kayıtlı yatak tipinin `common` ad alanındaki çeviri anahtarı; bilinmeyen değerde (eski serbest
 * metin) `null`. Sunucu ve istemci bileşenlerinde kullanılabilir.
 *
 * @example
 * const tc = useTranslations("common"); // sunucuda: await getTranslations("common")
 * const key = bedTypeKey(room.bedType);
 * const label = key ? tc(key) : room.bedType;
 */
export function bedTypeKey(value: string): string | null {
  return (BED_TYPES as readonly string[]).includes(value) ? `bedTypes.${value}` : null;
}
