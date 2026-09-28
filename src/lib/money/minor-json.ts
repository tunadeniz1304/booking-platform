import { minorFromDb } from "./money";

/**
 * API JSON'u (ADR 0019, ADR 0033): `BigInt *Minor` alanlar JSON'a `number` olarak çıkar. v5'te
 * yanlarındaki geriye uyumlu ondalık kopyalar (`totalPrice`, `amount`, `basePrice`, …)
 * kaldırıldı; istemciler `*Minor` + `currency` okur ve biçimlemeyi kendisi yapar.
 */
const MINOR_KEYS = [
  "basePriceMinor",
  "priceModifierMinor",
  "priceMinor",
  "totalPriceMinor",
  "amountMinor",
  "refundedAmountMinor",
  "avgNightlyPriceMinor",
  "askPriceMinor",
  "taxAmountMinor",
] as const;

type MinorKey = (typeof MINOR_KEYS)[number];
type MinorNumbers<T> = { [K in keyof T]: K extends MinorKey ? number : T[K] };

/** Tek bir nesnenin (sığ) `*Minor` alanlarını `number`'a çevirir. */
export function withMinorNumbers<T extends object>(row: T): MinorNumbers<T> {
  const out: Record<string, unknown> = { ...(row as Record<string, unknown>) };
  for (const key of MINOR_KEYS) {
    const value = out[key];
    if (typeof value === "bigint" || typeof value === "number") out[key] = minorFromDb(value);
  }
  return out as MinorNumbers<T>;
}
