export const LOCALES = ["tr", "en"] as const;
export type Locale = (typeof LOCALES)[number];
/** Türkçe varsayılan dil kalır. */
export const DEFAULT_LOCALE: Locale = "tr";
export const LOCALE_COOKIE = "NEXT_LOCALE";

export function resolveLocale(value: string | undefined | null): Locale {
  return (LOCALES as readonly string[]).includes(value ?? "") ? (value as Locale) : DEFAULT_LOCALE;
}
