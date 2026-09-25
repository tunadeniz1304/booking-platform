/**
 * Mock BIN tablosu (P1-8): kartın ilk 6 hanesi → ihraç eden ülke (ISO-3166 alfa-2).
 * Gerçek BIN veritabanı lisanslıdır; demo ve testler için küçük, deterministik tablo.
 * En uzun önek eşleşmesi kazanır; bilinmeyen BIN → null (kural puan eklemez).
 */
const BIN_COUNTRIES: Record<string, string> = {
  "424242": "US", // Stripe test kartı
  "411111": "US",
  "555555": "US",
  "400000": "US",
  "454360": "TR",
  "540061": "TR",
  "979200": "TR", // TROY
  "497010": "FR",
  "450875": "DE",
  "401288": "GB",
  "520082": "NL",
};

const BIN_LENGTH = 6;
const MIN_PREFIX = 4;

export function binCountry(bin: string): string | null {
  const digits = bin.replace(/\D/g, "").slice(0, BIN_LENGTH);
  for (let len = digits.length; len >= MIN_PREFIX; len--) {
    const country = BIN_COUNTRIES[digits.slice(0, len)];
    if (country) return country;
  }
  return null;
}
