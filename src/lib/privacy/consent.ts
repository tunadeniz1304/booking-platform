/** Çerez onayı (P2-5): `cookie_consent` çerezinin adı ve değer ayrıştırıcısı (saf). */
export const CONSENT_COOKIE = "cookie_consent";

export type ConsentValue = "necessary" | "necessary,analytics";

/** `document.cookie` benzeri başlıktan onay değerini okur (yoksa/geçersizse null). */
export function readConsent(cookieHeader: string): ConsentValue | null {
  const match = cookieHeader.split(/;\s*/).find((c) => c.startsWith(`${CONSENT_COOKIE}=`));
  if (!match) return null;
  let value: string;
  try {
    value = decodeURIComponent(match.slice(CONSENT_COOKIE.length + 1));
  } catch {
    return null;
  }
  return value === "necessary" || value === "necessary,analytics" ? value : null;
}

/** Analitik çerezlere izin var mı? */
export function analyticsAllowed(cookieHeader: string): boolean {
  return readConsent(cookieHeader) === "necessary,analytics";
}
