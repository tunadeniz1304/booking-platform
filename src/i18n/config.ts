export const LOCALES = ["tr", "en"] as const;
export type Locale = (typeof LOCALES)[number];
/** Türkçe varsayılan dil kalır. */
export const DEFAULT_LOCALE: Locale = "tr";
export const LOCALE_COOKIE = "NEXT_LOCALE";

function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

export function resolveLocale(value: string | undefined | null): Locale {
  return isLocale(value ?? "") ? (value as Locale) : DEFAULT_LOCALE;
}

// RFC 9110 §12.5.4: dil aralığı "*" ya da 1–8 harf + "-" ile ayrılmış 1–8 alfanümerik alt etiket.
const LANGUAGE_RANGE_RE = /^(?:\*|[a-z]{1,8}(?:-[a-z0-9]{1,8})*)$/i;
// q-değeri: 0..1, en fazla üç ondalık.
const QVALUE_RE = /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/;

/**
 * Accept-Language başlığını q-değerleriyle ayrıştırıp desteklenen dillerden en uygununu seçer.
 * Bölge alt etiketi yok sayılır (en-GB → en); "*" henüz anılmamış ilk desteklenen dile eşlenir;
 * q=0 dili dışlar; bozuk girdiler atlanır. Eşleşme yoksa varsayılan dil (tr).
 */
export function negotiateLocale(acceptLanguage: string | undefined | null): Locale {
  if (!acceptLanguage) return DEFAULT_LOCALE;
  const ranges: { tag: string; q: number; index: number }[] = [];
  acceptLanguage.split(",").forEach((part, index) => {
    const [rawTag, ...params] = part.split(";").map((s) => s.trim());
    if (!rawTag || !LANGUAGE_RANGE_RE.test(rawTag)) return;
    let q = 1;
    for (const param of params) {
      const [key, value] = param.split("=").map((s) => s.trim());
      if (key?.toLowerCase() !== "q") continue;
      if (!value || !QVALUE_RE.test(value)) return;
      q = Number(value);
    }
    ranges.push({ tag: rawTag.toLowerCase(), q, index });
  });

  const excluded = new Set(ranges.filter((r) => r.q === 0).map((r) => r.tag.split("-")[0]));
  const named = new Set(ranges.map((r) => r.tag.split("-")[0]));
  const ordered = ranges.filter((r) => r.q > 0).sort((a, b) => b.q - a.q || a.index - b.index);
  for (const { tag } of ordered) {
    if (tag === "*") {
      const wildcard = LOCALES.find((l) => !named.has(l) && !excluded.has(l));
      if (wildcard) return wildcard;
      continue;
    }
    const primary = tag.split("-")[0];
    if (isLocale(primary) && !excluded.has(primary)) return primary;
  }
  return DEFAULT_LOCALE;
}

/** Açık seçim (geçerli NEXT_LOCALE çerezi) her zaman kazanır; yoksa Accept-Language müzakeresi. */
export function resolveRequestLocale(
  cookieValue: string | undefined | null,
  acceptLanguage: string | undefined | null
): Locale {
  return cookieValue && isLocale(cookieValue) ? cookieValue : negotiateLocale(acceptLanguage);
}
