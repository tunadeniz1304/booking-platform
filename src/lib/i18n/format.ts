import { formatMoney, fromDecimal, isCurrencyCode, money } from "@/lib/money/money";

/**
 * Dile duyarlı biçimlendirme (P1-12). Tüm tutarlar tamsayı minor-unit'tir; burada yalnızca
 * `Intl.NumberFormat` / `Intl.DateTimeFormat` ile gösterim yapılır, hesap yapılmaz.
 * Arayüz dili ("tr" | "en") → BCP-47 etiketi eşlemesi tek yerdedir.
 */
const INTL_LOCALE: Record<string, string> = { tr: "tr-TR", en: "en-US" };

export function intlLocale(locale: string): string {
  return INTL_LOCALE[locale] ?? INTL_LOCALE.tr;
}

export type DateStyle = "short" | "medium" | "long";

const DATE_OPTIONS: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  short: { day: "2-digit", month: "2-digit", year: "numeric" },
  medium: { day: "numeric", month: "short", year: "numeric" },
  long: { day: "numeric", month: "long", year: "numeric" },
};

function toDate(value: string | Date): Date | null {
  // Salt tarih ("2026-09-24") UTC gece yarısı olarak yorumlanır; gün kaymaz.
  const d =
    value instanceof Date
      ? value
      : new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface Formatter {
  locale: string;
  /** Minor-unit tamsayı → para biçimi (bilinmeyen para biriminde düz metin). */
  money(amount: number, currency: string): string;
  /** Ondalık (Prisma Decimal JSON'u) → para biçimi. */
  decimal(value: string | number, currency: string): string;
  /** Takvim tarihi; varsayılan saat dilimi UTC (konaklama geceleri gün olarak saklanır). */
  date(value: string | Date, style?: DateStyle, timeZone?: string): string;
  /** Tarih + saat (mesaj, günlük kaydı). */
  dateTime(value: string | Date, timeZone?: string): string;
  /** Yalnızca saat (tutma süresi bitişi). */
  time(value: string | Date, timeZone?: string): string;
  number(value: number, options?: Intl.NumberFormatOptions): string;
}

export function createFormatter(locale: string): Formatter {
  const tag = intlLocale(locale);
  return {
    locale: tag,
    money(amount, currency) {
      if (!isCurrencyCode(currency) || !Number.isSafeInteger(amount)) {
        return `${amount} ${currency}`;
      }
      return formatMoney(money(amount, currency), tag);
    },
    decimal(value, currency) {
      try {
        return formatMoney(fromDecimal(value, currency), tag);
      } catch {
        return `${value} ${currency}`;
      }
    },
    date(value, style = "short", timeZone = "UTC") {
      const d = toDate(value);
      if (!d) return String(value);
      return new Intl.DateTimeFormat(tag, { ...DATE_OPTIONS[style], timeZone }).format(d);
    },
    dateTime(value, timeZone) {
      const d = toDate(value);
      if (!d) return String(value);
      return new Intl.DateTimeFormat(tag, {
        dateStyle: "short",
        timeStyle: "short",
        ...(timeZone ? { timeZone } : {}),
      }).format(d);
    },
    time(value, timeZone) {
      const d = toDate(value);
      if (!d) return String(value);
      return new Intl.DateTimeFormat(tag, {
        hour: "2-digit",
        minute: "2-digit",
        ...(timeZone ? { timeZone } : {}),
      }).format(d);
    },
    number(value, options) {
      return new Intl.NumberFormat(tag, options).format(value);
    },
  };
}
