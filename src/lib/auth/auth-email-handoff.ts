"use client";

/**
 * Kimlik sayfaları arasında yazılan e-postayı taşır (ör. giriş → "Şifremi unuttum", F1039).
 * Kişisel veri URL sorgusuna konmaz; sekmeye özgü `sessionStorage` kullanılır. Depolama
 * engelliyse (gizli pencere, kapalı site verisi) ön doldurma olmadan devam edilir.
 */
const AUTH_EMAIL_KEY = "auth.email";

export function rememberAuthEmail(email: string): void {
  try {
    const value = email.trim();
    if (value) sessionStorage.setItem(AUTH_EMAIL_KEY, value);
    else sessionStorage.removeItem(AUTH_EMAIL_KEY);
  } catch {
    // depolama kullanılamıyor: alan boş başlar
  }
}

/** Saklanan e-posta; yoksa ya da depolama kullanılamıyorsa null (SSR'da da null). */
export function readRememberedAuthEmail(): string | null {
  try {
    return typeof window === "undefined" ? null : sessionStorage.getItem(AUTH_EMAIL_KEY);
  } catch {
    return null;
  }
}
