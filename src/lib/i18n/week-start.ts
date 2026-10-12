/**
 * Dilin haftası hangi günle başlar; `Date#getDay` biçiminde (0=Pazar, 1=Pazartesi … 6=Cumartesi).
 * Intl.Locale hafta bilgisi varsa ondan okunur; yoksa en-US Pazar, diğer diller Pazartesi.
 */
export function firstDayOfWeek(locale: string): number {
  try {
    const loc = new Intl.Locale(locale) as unknown as {
      getWeekInfo?: () => { firstDay?: number };
      weekInfo?: { firstDay?: number };
    };
    const firstDay = (loc.getWeekInfo?.() ?? loc.weekInfo)?.firstDay;
    // Intl hafta bilgisi: 1=Pazartesi … 7=Pazar.
    if (typeof firstDay === "number" && firstDay >= 1 && firstDay <= 7) return firstDay % 7;
  } catch {
    // Geçersiz dil etiketi: varsayılana düşülür.
  }
  return locale === "en-US" || locale === "en" ? 0 : 1;
}
