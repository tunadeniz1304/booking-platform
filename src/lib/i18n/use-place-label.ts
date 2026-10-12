import { useLocale, useTranslations } from "next-intl";
import { localizeCountryName, placeCityKey } from "@/lib/i18n/place-display-names";

// Veritabanındaki Türkçe yer adlarını etkin dile çevirir (F2-18).
// Bilinen şehirler home.places çevirisinden, ülkeler Intl.DisplayNames'ten gelir.
export function usePlaceLabel(): {
  city(city: string): string;
  country(country: string): string;
  place(city: string, country?: string | null): string;
} {
  const tHome = useTranslations("home");
  const locale = useLocale();
  const city = (c: string) => {
    const key = placeCityKey(c);
    return key ? tHome(`places.${key}`) : c;
  };
  const country = (co: string) => localizeCountryName(co, locale);
  const place = (c: string, co?: string | null) => (co ? `${city(c)}, ${country(co)}` : city(c));
  return { city, country, place };
}
