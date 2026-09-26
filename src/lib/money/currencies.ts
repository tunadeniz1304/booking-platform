/**
 * ISO 4217 para birimi üs (minor unit) tablosu ve TEK yuvarlama fonksiyonu (v4 P0-2, ADR 0019).
 *
 * Tutarlar veritabanında `BigInt *Minor` olarak saklanır; ondalık basamak sayısı bu tablodan
 * gelir (JPY 0, TRY/EUR/USD 2, KWD/BHD 3). Uygulamanın başka hiçbir yerinde "×100" varsayımı
 * yapılmaz. Kaynak: ISO 4217 "List One" (minor unit sütunu).
 */

export const ISO_CURRENCY_EXPONENTS = {
  // 0 basamak
  BIF: 0,
  CLP: 0,
  DJF: 0,
  GNF: 0,
  ISK: 0,
  JPY: 0,
  KMF: 0,
  KRW: 0,
  PYG: 0,
  RWF: 0,
  UGX: 0,
  VND: 0,
  VUV: 0,
  XAF: 0,
  XOF: 0,
  XPF: 0,
  // 2 basamak
  AED: 2,
  ARS: 2,
  AUD: 2,
  AZN: 2,
  BGN: 2,
  BRL: 2,
  CAD: 2,
  CHF: 2,
  CNY: 2,
  CZK: 2,
  DKK: 2,
  EGP: 2,
  EUR: 2,
  GBP: 2,
  GEL: 2,
  HKD: 2,
  HUF: 2,
  IDR: 2,
  ILS: 2,
  INR: 2,
  KZT: 2,
  MAD: 2,
  MXN: 2,
  MYR: 2,
  NOK: 2,
  NZD: 2,
  PHP: 2,
  PLN: 2,
  QAR: 2,
  RON: 2,
  RSD: 2,
  SAR: 2,
  SEK: 2,
  SGD: 2,
  THB: 2,
  TRY: 2,
  UAH: 2,
  USD: 2,
  ZAR: 2,
  // 3 basamak
  BHD: 3,
  IQD: 3,
  JOD: 3,
  KWD: 3,
  LYD: 3,
  OMR: 3,
  TND: 3,
} as const satisfies Record<string, 0 | 2 | 3 | 4>;

export type IsoCurrencyCode = keyof typeof ISO_CURRENCY_EXPONENTS;

export function isIsoCurrency(code: string): code is IsoCurrencyCode {
  return Object.prototype.hasOwnProperty.call(ISO_CURRENCY_EXPONENTS, code);
}

/** Para biriminin ISO 4217 ondalık basamak sayısı; bilinmeyen kod hata fırlatır. */
export function currencyExponent(code: string): number {
  if (!isIsoCurrency(code)) throw new RangeError(`Bilinmeyen ISO 4217 para birimi: ${code}`);
  return ISO_CURRENCY_EXPONENTS[code];
}

/**
 * Uygulamadaki TEK yuvarlama noktası: `numerator / denominator`, half-up (yarım sıfırdan
 * uzağa). Banker's rounding (yarımı çifte) KULLANILMAZ: müşteriye gösterilen tutar, fatura ve
 * PSP'nin (Stripe/iyzico) yuvarlaması ticari "yarım yukarı" kuralını izler; mutabakat farkı
 * çıkmaması için aynı kural her yerde geçerlidir (ADR 0019). BigInt ile taşmasız.
 */
export function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new RangeError("Sıfıra bölme");
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  let q = n / d;
  if ((n % d) * 2n >= d) q += 1n;
  return negative ? -q : q;
}

/**
 * Ondalık string'i ("1234.5675") para biriminin üssüne göre minor-unit'e yuvarlar (half-up).
 * Float'a hiç düşmez. Yalnızca GÜVENİLİR iç kaynaklarda (eski `Decimal` kolonlar, backfill)
 * kullanılır; dış girişte kesir fazlası `parseMoney` ile reddedilir.
 */
export function decimalToMinorHalfUp(value: string, currency: string): bigint {
  const exp = currencyExponent(currency);
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) throw new RangeError(`Geçersiz ondalık tutar: ${value}`);
  const [, sign, int, frac = ""] = match;
  const scaled = BigInt(int + frac) * (sign ? -1n : 1n);
  const fracDigits = frac.length;
  if (fracDigits <= exp) return scaled * 10n ** BigInt(exp - fracDigits);
  return roundHalfUp(scaled, 10n ** BigInt(fracDigits - exp));
}

/** Minor-unit → ondalık string (üs tablosuna göre): 1234567 KWD → "1234.567", 1500 JPY → "1500". */
export function minorToDecimalString(amount: bigint | number, currency: string): string {
  const exp = currencyExponent(currency);
  const big = typeof amount === "bigint" ? amount : BigInt(amount);
  const negative = big < 0n;
  const abs = (negative ? -big : big).toString().padStart(exp + 1, "0");
  const int = abs.slice(0, abs.length - exp);
  const frac = abs.slice(abs.length - exp);
  return `${negative ? "-" : ""}${int}${exp > 0 ? `.${frac}` : ""}`;
}
