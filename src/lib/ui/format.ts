import { formatMoney, fromDecimal, isCurrencyCode, money } from "@/lib/money/money";

/** Minor-unit tamsayı → yerel para biçimi (bilinmeyen para biriminde düz sayı). */
export function formatMinor(amount: number, currency: string): string {
  if (!isCurrencyCode(currency) || !Number.isSafeInteger(amount)) return `${amount} ${currency}`;
  return formatMoney(money(amount, currency));
}

/** Ondalık (Prisma Decimal JSON'u: "1500.00" veya 1500) → yerel para biçimi. */
export function formatDecimal(value: string | number, currency: string): string {
  try {
    return formatMoney(fromDecimal(value, currency));
  } catch {
    return `${value} ${currency}`;
  }
}

/** ISO tarih → "24.09.2026". */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("tr-TR", { timeZone: "UTC" });
}

/** Bugünden `offset` gün sonrası, YYYY-MM-DD (UTC). */
export function isoDay(offset = 0, from = new Date()): string {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

/** Tarayıcıda idempotency anahtarı. */
export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
