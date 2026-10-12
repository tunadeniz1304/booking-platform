/**
 * Ortak odak halkası (klavye kullanıcıları için görünür).
 *
 * Bağımlılığı olmayan ayrı modül: `ui.tsx` → `Header` → `AuthCard` → `ui.tsx` döngüsünde
 * modül düzeyinde okunduğunda başlatılmamış değişkene (TDZ) erişilmesin diye.
 */
export const focusRing =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-[#003580] focus-visible:ring-offset-2";
