/**
 * Mülk türü (Prisma `PropertyType` enum'u) → `search.types.*` çeviri anahtarı. Tek kaynak:
 * arama sayfası, ana sayfa ve akıllı filtre çipleri aynı eşlemeyi kullanır.
 */
const PROPERTY_TYPE_KEYS: Readonly<Record<string, string>> = {
  HOTEL: "hotel",
  APARTMENT: "apartment",
  VILLA: "villa",
  HOSTEL: "hostel",
  BED_AND_BREAKFAST: "bedAndBreakfast",
};

/**
 * Mülk türünün `search` ad alanındaki `types.<anahtar>` çeviri anahtarı; bilinmeyen türde `null`.
 * Sunucu ve istemci bileşenlerinde kullanılabilir.
 *
 * @example
 * const t = useTranslations("search"); // sunucuda: await getTranslations("search")
 * const key = propertyTypeKey(type);
 * const label = key ? t(`types.${key}`) : type;
 */
export function propertyTypeKey(type: string): string | null {
  // Prototip anahtarları ("constructor" vb.) eşleşmesin diye yalnızca kendi alanlarına bakılır.
  return Object.prototype.hasOwnProperty.call(PROPERTY_TYPE_KEYS, type)
    ? PROPERTY_TYPE_KEYS[type]
    : null;
}
