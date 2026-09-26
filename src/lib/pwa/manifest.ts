import trMessages from "../../../messages/tr/pwa.json";
import enMessages from "../../../messages/en/pwa.json";
import type { Locale } from "@/i18n/config";

/**
 * Web App Manifest (P1-12). Dil `NEXT_LOCALE` çerezinden; kurulabilirlik için 192/512 PNG +
 * maskable ikon, `display: standalone`, `start_url` ve `scope`. Kısayol: çevrimdışı seyahatler.
 */
const MESSAGES = { tr: trMessages, en: enMessages } as const;

export const THEME_COLOR = "#003580";

export function buildManifest(locale: Locale) {
  const m = MESSAGES[locale].manifest;
  const trips = MESSAGES[locale].trips.title;
  return {
    id: "/",
    name: m.name,
    short_name: m.shortName,
    description: m.description,
    lang: locale,
    dir: "ltr",
    start_url: "/?source=pwa",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: THEME_COLOR,
    categories: ["travel"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
    shortcuts: [
      {
        name: trips,
        short_name: trips,
        url: "/trips",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
    ],
  };
}
