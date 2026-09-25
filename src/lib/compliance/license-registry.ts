/**
 * P1-10 kayıt/belge numarası doğrulama. Gerçek kayıt sistemlerine (Kültür ve Turizm
 * Bakanlığı 7565 sayılı Kanun kapsamı; AB 2024/1028 kısa dönem kiralama — STR — kayıtları)
 * erişim olmadığından deterministik, çevrimdışı mock'lar kullanılır; arayüz gerçek
 * istemcinin takılabilmesi için sabittir.
 */

/** Turizm İşletme Belgesi / izin no: il plaka kodu + sıra (+ opsiyonel yıl), ör. 34-12345. */
export const LICENSE_RE = /^(0[1-9]|[1-7]\d|8[01])-\d{3,6}(-\d{4})?$/;
/** AB STR kayıt no (mock biçim): ISO ülke kodu + tire + 6–20 alfanümerik, ör. FR-75056ABC123. */
export const EU_STR_RE = /^[A-Z]{2}-[A-Z0-9]{6,20}$/;

export type LicenseDecision = "VERIFIED" | "REJECTED";

export interface LicenseVerification {
  status: LicenseDecision;
  registry: string;
  /** Açıklanabilir gerekçe kodu. */
  reason: "OK" | "FORMAT_INVALID" | "NOT_FOUND" | "COUNTRY_MISMATCH";
}

export interface LicenseRegistry {
  readonly id: string;
  verify(licenseNumber: string, countryCode: string | null): Promise<LicenseVerification>;
}

/** AB üyeleri: ISO kodu ve seed/arayüzde kullanılan Türkçe/İngilizce adlar. */
const EU_COUNTRIES: Record<string, string> = {
  AT: "AT",
  AUSTRIA: "AT",
  AVUSTURYA: "AT",
  BE: "BE",
  BELGIUM: "BE",
  BELÇİKA: "BE",
  BG: "BG",
  BULGARIA: "BG",
  BULGARİSTAN: "BG",
  HR: "HR",
  CROATIA: "HR",
  HIRVATİSTAN: "HR",
  CY: "CY",
  CYPRUS: "CY",
  CZ: "CZ",
  CZECHIA: "CZ",
  ÇEKYA: "CZ",
  DK: "DK",
  DENMARK: "DK",
  DANİMARKA: "DK",
  EE: "EE",
  ESTONIA: "EE",
  ESTONYA: "EE",
  FI: "FI",
  FINLAND: "FI",
  FİNLANDİYA: "FI",
  FR: "FR",
  FRANCE: "FR",
  FRANSA: "FR",
  DE: "DE",
  GERMANY: "DE",
  ALMANYA: "DE",
  GR: "GR",
  GREECE: "GR",
  YUNANİSTAN: "GR",
  HU: "HU",
  HUNGARY: "HU",
  MACARİSTAN: "HU",
  IE: "IE",
  IRELAND: "IE",
  İRLANDA: "IE",
  IT: "IT",
  ITALY: "IT",
  İTALYA: "IT",
  LV: "LV",
  LATVIA: "LV",
  LETONYA: "LV",
  LT: "LT",
  LITHUANIA: "LT",
  LİTVANYA: "LT",
  LU: "LU",
  LUXEMBOURG: "LU",
  LÜKSEMBURG: "LU",
  MT: "MT",
  MALTA: "MT",
  NL: "NL",
  NETHERLANDS: "NL",
  HOLLANDA: "NL",
  PL: "PL",
  POLAND: "PL",
  POLONYA: "PL",
  PT: "PT",
  PORTUGAL: "PT",
  PORTEKİZ: "PT",
  RO: "RO",
  ROMANIA: "RO",
  ROMANYA: "RO",
  SK: "SK",
  SLOVAKIA: "SK",
  SLOVAKYA: "SK",
  SI: "SI",
  SLOVENIA: "SI",
  SLOVENYA: "SI",
  ES: "ES",
  SPAIN: "ES",
  İSPANYA: "ES",
  SE: "SE",
  SWEDEN: "SE",
  İSVEÇ: "SE",
};

/** Ülke adını/kodunu AB ISO koduna çevirir; AB dışıysa null. */
export function euCountryCode(country: string): string | null {
  return EU_COUNTRIES[country.trim().toLocaleUpperCase("tr-TR")] ?? null;
}

/** Biçim olarak TR veya AB STR numarası mı (girdi doğrulaması; kayıtta varlık ayrı). */
export function isLicenseFormatValid(value: string): boolean {
  return LICENSE_RE.test(value) || EU_STR_RE.test(value);
}

/** Mock kural: sıra numarası tamamen sıfır olan kayıtlar "kayıtta yok" sayılır (test/demo için). */
const allZero = (s: string) => /^0+$/.test(s);

export class MockTrMinistryRegistry implements LicenseRegistry {
  readonly id = "tr-ministry-7565-mock";
  async verify(licenseNumber: string): Promise<LicenseVerification> {
    const m = LICENSE_RE.exec(licenseNumber);
    if (!m) return { status: "REJECTED", registry: this.id, reason: "FORMAT_INVALID" };
    const seq = licenseNumber.split("-")[1];
    if (allZero(seq)) return { status: "REJECTED", registry: this.id, reason: "NOT_FOUND" };
    return { status: "VERIFIED", registry: this.id, reason: "OK" };
  }
}

export class MockEuStrRegistry implements LicenseRegistry {
  readonly id = "eu-str-2024-1028-mock";
  async verify(licenseNumber: string, countryCode: string | null): Promise<LicenseVerification> {
    if (!EU_STR_RE.test(licenseNumber)) {
      return { status: "REJECTED", registry: this.id, reason: "FORMAT_INVALID" };
    }
    const [prefix, body] = licenseNumber.split("-");
    if (countryCode && prefix !== countryCode) {
      return { status: "REJECTED", registry: this.id, reason: "COUNTRY_MISMATCH" };
    }
    if (allZero(body)) return { status: "REJECTED", registry: this.id, reason: "NOT_FOUND" };
    return { status: "VERIFIED", registry: this.id, reason: "OK" };
  }
}

const trRegistry = new MockTrMinistryRegistry();
const euRegistry = new MockEuStrRegistry();

/** Tesisin ülkesine göre kayıt sistemi: AB üyesi → STR, diğerleri → TR Bakanlık. */
export function registryForCountry(country: string): LicenseRegistry {
  return euCountryCode(country) ? euRegistry : trRegistry;
}

export async function verifyLicense(
  licenseNumber: string,
  country: string
): Promise<LicenseVerification> {
  return registryForCountry(country).verify(licenseNumber, euCountryCode(country));
}
