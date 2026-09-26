/**
 * P2-1a tema tercihi: `system` (varsayılan; `prefers-color-scheme`), `light` ya da `dark`.
 * Tercih çerezde saklanır (arayüz özelleştirme çerezi; 1 yıl) ve sunucu `<html data-theme>`
 * özniteliğini ilk yanıtta yazar → sayfa yüklenirken yanlış tema parlaması olmaz.
 */
export const THEME_COOKIE = "theme";
export const THEMES = ["system", "light", "dark"] as const;
export type ThemePreference = (typeof THEMES)[number];

export function resolveTheme(value: string | undefined | null): ThemePreference {
  return (THEMES as readonly string[]).includes(value ?? "")
    ? (value as ThemePreference)
    : "system";
}

/** `<html data-theme>` değeri: sistem tercihinde öznitelik yazılmaz (CSS medya sorgusu karar verir). */
export function themeAttribute(pref: ThemePreference): "light" | "dark" | undefined {
  return pref === "system" ? undefined : pref;
}
