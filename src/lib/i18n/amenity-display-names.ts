/**
 * Olanak adları veritabanında Türkçe tutulur (`Amenity.name`). Gösterimde ad, olanağın simge
 * anahtarıyla `property` ad alanındaki `amenityNames.<anahtar>` çevirisinden gelir (mülk sayfasıyla
 * aynı metin). Arama sorguları veritabanındaki adla yapılmaya devam eder.
 */
const AMENITY_KEYS: Readonly<Record<string, string>> = {
  "Ücretsiz WiFi": "wifi",
  Havuz: "pool",
  Klima: "snow",
  Otopark: "car",
  "Kahvaltı Dahil": "coffee",
  "Spa & Sauna": "spa",
  "Fitness Merkezi": "dumbbell",
  "Deniz Manzarası": "view",
  "Evcil Hayvan Dostu": "paw",
  "7/24 Resepsiyon": "clock",
  "Şehir Merkezi": "city",
  "Oda Servisi": "service",
};

/**
 * Olanağın `property` ad alanındaki `amenityNames.<anahtar>` çeviri anahtarı; bilinmeyen
 * olanakta `null`.
 *
 * @example
 * const key = amenityNameKey(name);
 * const label = key ? tProperty(`amenityNames.${key}`) : name;
 */
export function amenityNameKey(name: string): string | null {
  const trimmed = name.trim();
  // Prototip anahtarları ("constructor" vb.) eşleşmesin diye yalnızca kendi alanlarına bakılır.
  return Object.prototype.hasOwnProperty.call(AMENITY_KEYS, trimmed) ? AMENITY_KEYS[trimmed] : null;
}
