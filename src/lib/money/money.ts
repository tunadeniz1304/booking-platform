/**
 * Para — tamsayı minor-unit (kuruş/cent) aritmetiği.
 *
 * Kayan nokta toplaması YOKTUR: her tutar `Number.isSafeInteger` olan minor-unit'tir.
 * Veritabanındaki `Decimal` alanlar yalnızca sınırda (okuma/yazma) dönüştürülür;
 * dönüşüm string üzerinden yapılır (float'a hiç düşmez). Oran çarpımı tek bir
 * yuvarlama noktasında (half-up) yapılır; bölüştürme (`allocate`) kalan kuruşları
 * en büyük kalan yöntemiyle dağıtır → parçaların toplamı her zaman bütüne eşittir.
 */

export const CURRENCIES = ["TRY", "USD", "EUR", "GBP"] as const;
export type CurrencyCode = (typeof CURRENCIES)[number];

/** Para birimi başına ondalık basamak (ISO 4217 minor unit). */
const EXPONENT: Record<CurrencyCode, number> = { TRY: 2, USD: 2, EUR: 2, GBP: 2 };

export interface Money {
  /** Minor-unit tamsayı (ör. 1234,56 TRY → 123456). */
  readonly amount: number;
  readonly currency: CurrencyCode;
}

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

export function isCurrencyCode(value: string): value is CurrencyCode {
  return (CURRENCIES as readonly string[]).includes(value);
}

export function assertCurrency(value: string): CurrencyCode {
  if (!isCurrencyCode(value)) throw new MoneyError(`Desteklenmeyen para birimi: ${value}`);
  return value;
}

function assertInt(amount: number): void {
  if (!Number.isSafeInteger(amount)) {
    throw new MoneyError(`Tutar tamsayı minor-unit olmalı: ${amount}`);
  }
}

export function money(amount: number, currency: CurrencyCode | string): Money {
  assertInt(amount);
  return { amount, currency: assertCurrency(currency) };
}

export function zero(currency: CurrencyCode | string): Money {
  return money(0, currency);
}

function sameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new MoneyError(`Para birimi uyuşmazlığı: ${a.currency} ≠ ${b.currency}`);
  }
}

export function add(a: Money, b: Money): Money {
  sameCurrency(a, b);
  return money(a.amount + b.amount, a.currency);
}

export function subtract(a: Money, b: Money): Money {
  sameCurrency(a, b);
  return money(a.amount - b.amount, a.currency);
}

export function sum(items: readonly Money[], currency: CurrencyCode | string): Money {
  return items.reduce((acc, m) => add(acc, m), zero(currency));
}

/**
 * Oranla çarpar ve half-up (sıfırdan uzağa) yuvarlar. Oran ondalık gösterimle
 * 6 basamağa kadar tam ölçeklenir: 0.01 → 10000/1e6 (float çarpım hatası yok).
 */
export function multiplyRate(m: Money, rate: number): Money {
  if (!Number.isFinite(rate)) throw new MoneyError(`Geçersiz oran: ${rate}`);
  const SCALE = 1_000_000;
  const scaledRate = Math.round(rate * SCALE);
  const product = BigInt(m.amount) * BigInt(scaledRate);
  const scale = BigInt(SCALE);
  const negative = product < 0n;
  const abs = negative ? -product : product;
  let q = abs / scale;
  if ((abs % scale) * 2n >= scale) q += 1n;
  return money(Number(negative ? -q : q), m.currency);
}

/**
 * Tutarı oranlara göre bölüştürür (en büyük kalan yöntemi).
 * Parçaların toplamı daima `m.amount`'a eşittir.
 */
export function allocate(m: Money, ratios: readonly number[]): Money[] {
  if (ratios.length === 0) throw new MoneyError("Bölüştürme oranı yok");
  if (ratios.some((r) => r < 0 || !Number.isFinite(r))) {
    throw new MoneyError("Oranlar negatif olamaz");
  }
  const total = ratios.reduce((s, r) => s + r, 0);
  if (total <= 0) throw new MoneyError("Oranların toplamı pozitif olmalı");
  const raw = ratios.map((r) => (m.amount * r) / total);
  const floors = raw.map(Math.floor);
  let remainder = m.amount - floors.reduce((s, v) => s + v, 0);
  const order = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (remainder <= 0) break;
    floors[i] += 1;
    remainder -= 1;
  }
  return floors.map((amount) => money(amount, m.currency));
}

/**
 * Ondalık string/Decimal → minor-unit (float'a düşmeden).
 * "1234.5" → 123450; "12" → 1200; "-0.01" → -1. Fazla basamak reddedilir.
 */
export function toMinor(
  value: string | number | { toString(): string },
  currency: CurrencyCode | string = "TRY"
): number {
  const exp = EXPONENT[assertCurrency(currency)];
  const text = typeof value === "number" ? value.toFixed(exp) : value.toString().trim();
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) throw new MoneyError(`Geçersiz ondalık tutar: ${text}`);
  const [, sign, int, frac = ""] = match;
  if (frac.length > exp && /[1-9]/.test(frac.slice(exp))) {
    throw new MoneyError(`Fazla ondalık basamak: ${text}`);
  }
  const minor = Number(int) * 10 ** exp + Number((frac + "0".repeat(exp)).slice(0, exp));
  assertInt(minor);
  return sign ? -minor : minor;
}

export function fromDecimal(
  value: string | number | { toString(): string },
  currency: CurrencyCode | string
): Money {
  return money(toMinor(value, currency), currency);
}

/** Minor-unit → ondalık string ("123450" → "1234.50"); Prisma Decimal'e yazmak için. */
export function toDecimalString(m: Money): string {
  const exp = EXPONENT[m.currency];
  const negative = m.amount < 0;
  const abs = Math.abs(m.amount)
    .toString()
    .padStart(exp + 1, "0");
  const int = abs.slice(0, abs.length - exp);
  const frac = abs.slice(abs.length - exp);
  return `${negative ? "-" : ""}${int}.${frac}`;
}

/** Görüntüleme için (yalnızca biçimlendirme; aritmetikte kullanılmaz). */
export function formatMoney(m: Money, locale = "tr-TR"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency: m.currency }).format(
    Number(toDecimalString(m))
  );
}
