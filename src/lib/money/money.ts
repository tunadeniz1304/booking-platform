/**
 * Para — tamsayı minor-unit (kuruş/cent) aritmetiği.
 *
 * Kayan nokta toplaması YOKTUR: her tutar `Number.isSafeInteger` olan minor-unit'tir.
 * Veritabanında para `BigInt *Minor` kolonlarında saklanır (ADR 0019); sınırda
 * `minorFromDb`/`minorToDb` ile dönüştürülür. Ondalık basamak sayısı ISO 4217 üs
 * tablosundan (`currencies.ts`) gelir. Oran çarpımı tek bir
 * yuvarlama noktasında (half-up) yapılır; bölüştürme (`allocate`) kalan kuruşları
 * en büyük kalan yöntemiyle dağıtır → parçaların toplamı her zaman bütüne eşittir.
 */

import {
  currencyExponent,
  isIsoCurrency,
  minorToDecimalString,
  roundHalfUp,
  type IsoCurrencyCode,
} from "./currencies";

/** Tesis/tahsilat için işletmede desteklenen birimler (ilan oluşturma, kur kaynakları). */
export const CURRENCIES = ["TRY", "USD", "EUR", "GBP"] as const;
/** `Money` her ISO 4217 birimini taşıyabilir (üs tablosu: `currencies.ts`, ADR 0019). */
export type CurrencyCode = IsoCurrencyCode;

/** Para birimi başına ondalık basamak (ISO 4217 minor unit). */
const exponentOf = (currency: CurrencyCode): number => currencyExponent(currency);

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
  return isIsoCurrency(value);
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

function zero(currency: CurrencyCode | string): Money {
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
  return money(Number(roundHalfUp(product, BigInt(SCALE))), m.currency);
}

/**
 * Tutarı oranlara göre bölüştürür (en büyük kalan yöntemi).
 * Parçaların toplamı daima `m.amount`'a eşittir.
 */
/** Tamsayı bölme, yarım yukarı — tek yuvarlama noktası `roundHalfUp` (currencies.ts). */
const divHalfUp = roundHalfUp;

/**
 * Tutarın baz puan (bps, 1/10.000) oranı: `bpsOf(1000 kuruş, 1000)` = 100 kuruş (%10).
 * Kayan nokta yok — vergi ve plan farkları için tam sonuç (half-up).
 */
export function bpsOf(m: Money, bps: number): Money {
  if (!Number.isInteger(bps)) throw new MoneyError(`bps tamsayı olmalı: ${bps}`);
  return money(Number(divHalfUp(BigInt(m.amount) * BigInt(bps), 10_000n)), m.currency);
}

/**
 * Vergi DAHİL tutarın içindeki vergi payı: `includedBpsOf(1100, 1000)` = 100 (%10 KDV dahil).
 * Pay = tutar × bps / (10.000 + bps), half-up.
 */
export function includedBpsOf(m: Money, bps: number): Money {
  if (!Number.isInteger(bps) || bps < 0) throw new MoneyError(`bps tamsayı olmalı: ${bps}`);
  return money(Number(divHalfUp(BigInt(m.amount) * BigInt(bps), BigInt(10_000 + bps))), m.currency);
}

/** Tutara baz puan farkı uygular: `applyBps(1000, -1000)` = 900 (%10 indirim). */
export function applyBps(m: Money, bps: number): Money {
  return add(m, bpsOf(m, bps));
}

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
  const exp = exponentOf(assertCurrency(currency));
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

/**
 * Dış girişten (API/kanal) gelen tutarı KATI biçimde ayrıştırır (v4#19): yalnızca negatif
 * olmayan ondalık STRING ("1234", "1234.5", "1234.50"); float/number, üs gösterimi ("1e3"),
 * binlik ayırıcı, para biriminin basamağını aşan kesir (TRY'de "1.005") reddedilir.
 * Float'a hiç düşmeden minor-unit `Money` döner.
 */
export function parseMoney(value: string, currency: CurrencyCode | string): Money {
  if (typeof value !== "string") throw new MoneyError("Tutar ondalık string olmalı");
  const text = value.trim();
  const exp = exponentOf(assertCurrency(currency));
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) throw new MoneyError(`Geçersiz tutar: ${text}`);
  if ((match[2] ?? "").length > exp) {
    throw new MoneyError(`Fazla ondalık basamak (${currency} için en fazla ${exp}): ${text}`);
  }
  return money(toMinor(text, currency), currency);
}

/** Minor-unit → ondalık string ("123450" → "1234.50"; JPY 1500 → "1500"; KWD → 3 hane). */
export function toDecimalString(m: Money): string {
  return minorToDecimalString(m.amount, m.currency);
}

/**
 * Veritabanı `BigInt *Minor` kolonu → `number` minor-unit. Güvenli tamsayı sınırını (2⁵³)
 * aşan değer sessizce kesilmez, hata fırlatır (ADR 0019).
 */
export function minorFromDb(value: bigint | number): number {
  const n = typeof value === "bigint" ? Number(value) : value;
  if (!Number.isSafeInteger(n) || (typeof value === "bigint" && BigInt(n) !== value)) {
    throw new MoneyError(`Minor-unit güvenli tamsayı aralığı dışında: ${value}`);
  }
  return n;
}

/** `number` minor-unit → veritabanı `BigInt *Minor` kolonu. */
export function minorToDb(amount: number): bigint {
  assertInt(amount);
  return BigInt(amount);
}

/** Veritabanı satırından (`*Minor` + `currency`) `Money`. */
export function moneyFromDb(amountMinor: bigint | number, currency: string): Money {
  return money(minorFromDb(amountMinor), currency);
}

/** Görüntüleme için (yalnızca biçimlendirme; aritmetikte kullanılmaz). */
export function formatMoney(m: Money, locale = "tr-TR"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency: m.currency }).format(
    Number(toDecimalString(m))
  );
}

/**
 * Güvenlik ağı (ADR 0019): `BigInt *Minor` kolonlarını taşıyan bir Prisma satırı gözden kaçıp
 * doğrudan `JSON.stringify`/`NextResponse.json`'a verilirse "Do not know how to serialize a
 * BigInt" ile 500 dönmesin diye BigInt JSON'da güvenli tamsayıya çevrilir; aralık dışı değer
 * sessizce kesilmez (hata). API'ler yine de açık DTO eşlemesi yapar.
 */
const bigintProto = BigInt.prototype as unknown as { toJSON?: () => number };
if (typeof bigintProto.toJSON !== "function") {
  Object.defineProperty(BigInt.prototype, "toJSON", {
    value: function toJSON(this: bigint): number {
      return minorFromDb(this);
    },
    writable: true,
    configurable: true,
  });
}

/**
 * Görüntüleme DTO'ları için ana birim sayısı (ör. 1234.5). Hesaplamada KULLANILMAZ; API'lerin
 * geriye uyumlu `basePrice`/`totalPrice` alanları bunu, hesap yapanlar `*Minor`'u okur.
 */
export function toMajorNumber(amountMinor: bigint | number, currency: string): number {
  return Number(toDecimalString(moneyFromDb(amountMinor, currency)));
}
