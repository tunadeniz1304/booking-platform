import { minorFromDb, moneyFromDb, toDecimalString } from "./money";

/**
 * Geriye uyumlu API JSON'u (ADR 0019): kolonlar `BigInt *Minor` olduktan sonra da istemciler
 * eski ondalık alanları (`totalPrice: "1234.50"`) okuyabilsin diye her `*Minor` alanının
 * yanına para biriminin ISO üssüyle biçimlenmiş ondalık string eklenir; `*Minor` alanı
 * `number` olur. Hesaplama yapan istemciler `*Minor`'u kullanmalıdır.
 */
const LEGACY_NAMES = {
  basePriceMinor: "basePrice",
  priceModifierMinor: "priceModifier",
  priceMinor: "price",
  totalPriceMinor: "totalPrice",
  amountMinor: "amount",
  refundedAmountMinor: "refundedAmount",
  avgNightlyPriceMinor: "avgNightlyPrice",
  askPriceMinor: "askPrice",
  taxAmountMinor: "taxAmount",
} as const;

type LegacyKey = keyof typeof LEGACY_NAMES;
type Minorless<T> = {
  [K in keyof T]: K extends LegacyKey ? number : T[K];
} & {
  [K in keyof T as K extends LegacyKey ? (typeof LEGACY_NAMES)[K] : never]: string;
};

/** Tek bir nesnenin (sığ) para alanlarını sunar; `currency` yoksa verilen birim kullanılır. */
export function withLegacyDecimals<T extends object>(
  row: T,
  fallbackCurrency?: string
): Minorless<T> {
  const own = (row as { currency?: unknown }).currency;
  const currency = typeof own === "string" ? own : fallbackCurrency;
  const out: Record<string, unknown> = { ...(row as Record<string, unknown>) };
  for (const [minorKey, legacyKey] of Object.entries(LEGACY_NAMES)) {
    const value = out[minorKey];
    if (typeof value !== "bigint" && typeof value !== "number") continue;
    out[minorKey] = minorFromDb(value);
    if (currency) out[legacyKey] = toDecimalString(moneyFromDb(value, currency));
  }
  return out as Minorless<T>;
}
