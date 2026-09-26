import { z } from "zod";
import staticRates from "../../../data/fx-rates.json";
import { currencyExponent, roundHalfUp } from "./currencies";
import { money, type CurrencyCode, type Money, assertCurrency } from "./money";

/**
 * Kur dönüşümü — YALNIZCA görüntüleme içindir; tahsilat daima mülkün para biriminde.
 * Kaynak: `FX_RATES_JSON` (ör. {"USD":0.0243}) veya `data/fx-rates.json` statik tablo
 * (ağ yok). Oranlar "1 TRY = x" biçimindedir. Rezervasyona o anki tablo `fxSnapshot`
 * olarak yazılır (sonradan kur değişse de gösterilen karşılık izlenebilir).
 */

const ratesSchema = z.record(z.string(), z.number().positive());

export interface FxSnapshot {
  base: "TRY";
  asOf: string;
  rates: Partial<Record<CurrencyCode, number>>;
}

export function getFxTable(env: Record<string, string | undefined> = process.env): FxSnapshot {
  let rates: Record<string, number> = staticRates.rates;
  if (env.FX_RATES_JSON) {
    const parsed = ratesSchema.safeParse(JSON.parse(env.FX_RATES_JSON));
    if (parsed.success) rates = { ...rates, ...parsed.data, TRY: 1 };
  }
  return { base: "TRY", asOf: staticRates.asOf, rates };
}

/** `m`'yi hedef para birimine çevirir (TRY üzerinden çapraz kur, minor-unit, half-up). */
export function convert(m: Money, to: CurrencyCode | string, table = getFxTable()): Money {
  const target = assertCurrency(to);
  if (m.currency === target) return m;
  const fromRate = table.rates[m.currency];
  const toRate = table.rates[target];
  if (!fromRate || !toRate) throw new Error(`Kur bulunamadı: ${m.currency}→${target}`);
  // Üs farkı (ör. TRY 2 → JPY 0) minor-unit ölçeğinde uygulanır; tek yuvarlama (half-up).
  const scaledRate = BigInt(Math.round((toRate / fromRate) * 1_000_000));
  const diff = currencyExponent(target) - currencyExponent(m.currency);
  const numerator = BigInt(m.amount) * scaledRate * 10n ** BigInt(Math.max(0, diff));
  const denominator = 1_000_000n * 10n ** BigInt(Math.max(0, -diff));
  return money(Number(roundHalfUp(numerator, denominator)), target);
}
