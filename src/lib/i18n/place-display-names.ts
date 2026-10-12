/**
 * Konum adları veritabanında Türkçe tutulur (`Location.city` / `Location.country`). Gösterimde
 * şehir adı `home.places.<anahtar>` çevirisinden, ülke adı ISO bölge kodundan
 * (`Intl.DisplayNames`) gelir. Arama sorguları veritabanındaki adla yapılmaya devam eder.
 */
const CITY_KEYS: Readonly<Record<string, string>> = {
  İstanbul: "istanbul",
  Antalya: "antalya",
  Bodrum: "bodrum",
  İzmir: "izmir",
  Trabzon: "trabzon",
  Kapadokya: "cappadocia",
  Ankara: "ankara",
  Muğla: "mugla",
  Alanya: "alanya",
  Çeşme: "cesme",
  Kuşadası: "kusadasi",
  Paris: "paris",
  Roma: "rome",
  Barselona: "barcelona",
  Amsterdam: "amsterdam",
  Viyana: "vienna",
  Dubai: "dubai",
  Londra: "london",
  "New York": "newYork",
  Tokyo: "tokyo",
};

/** Veritabanındaki (Türkçe) ülke adı → ISO 3166-1 alfa-2 bölge kodu. */
const COUNTRY_CODES: Readonly<Record<string, string>> = {
  Türkiye: "TR",
  Fransa: "FR",
  İtalya: "IT",
  İspanya: "ES",
  Hollanda: "NL",
  Avusturya: "AT",
  BAE: "AE",
  "Birleşik Krallık": "GB",
  ABD: "US",
  Japonya: "JP",
};

function ownValue(map: Readonly<Record<string, string>>, key: string): string | null {
  // Prototip anahtarları ("constructor" vb.) eşleşmesin diye yalnızca kendi alanlarına bakılır.
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null;
}

/**
 * Şehrin `home` ad alanındaki `places.<anahtar>` çeviri anahtarı; bilinmeyen şehirde `null`.
 *
 * @example
 * const key = placeCityKey(city);
 * const label = key ? t(`places.${key}`) : city;
 */
export function placeCityKey(city: string): string | null {
  return ownValue(CITY_KEYS, city.trim());
}

/** Ülkenin ISO 3166-1 alfa-2 bölge kodu; bilinmeyen ülkede `null`. */
export function countryRegionCode(country: string): string | null {
  return ownValue(COUNTRY_CODES, country.trim());
}

/**
 * Ülke adını arayüz diline göre döndürür. Türkçede veritabanındaki ad (kaynak dil) korunur;
 * bilinmeyen ülke ya da desteklenmeyen dil durumunda ad aynen döner.
 */
export function localizeCountryName(country: string, locale: string): string {
  const code = countryRegionCode(country);
  if (!code || locale.toLowerCase().startsWith("tr")) return country;
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? country;
  } catch {
    return country;
  }
}
