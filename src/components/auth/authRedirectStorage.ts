"use client";

/**
 * Kimlik akışları arasında dönüş adresini taşır (e-postadaki bağlantı yeni sekmede açılabilir,
 * bu yüzden `localStorage`). Depolama kapalıysa sessizce dönüş adressiz devam edilir.
 */
/** Şifre sıfırlama bittikten sonra dönülecek adres (F2-34); reset sayfası okur ve siler. */
export const POST_RESET_REDIRECT_KEY = "postResetRedirect";

/**
 * Kayıt en fazla bu kadar geçerli: sunucudaki sıfırlama bağlantısı ömrünün üst sınırı
 * (AUTH_RESET_TOKEN_TTL_MINUTES en çok 24 saat). Daha eski kayıt başka bir isteğe aittir.
 */
const AUTH_REDIRECT_MAX_AGE_MS = 24 * 60 * 60_000;

type StoredAuthRedirect = { redirect: string; email: string; savedAt: number };

const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** '/' için anahtar silinir (dönülecek özel bir yer yok). Kayıt hesaba ve zamana bağlanır (F2-34). */
export function storeAuthRedirect(key: string, redirect: string, email: string): void {
  try {
    if (redirect === "/") {
      localStorage.removeItem(key);
      return;
    }
    const record: StoredAuthRedirect = {
      redirect,
      email: normalizeEmail(email),
      savedAt: Date.now(),
    };
    localStorage.setItem(key, JSON.stringify(record));
  } catch {
    // depolama kullanılamıyor
  }
}

/** Saklanan ham kayıt; yoksa ya da depolama kullanılamıyorsa null. */
export function readAuthRedirect(key: string): string | null {
  try {
    return typeof window === "undefined" ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Ham kayıttan dönüş adresi: yalnızca aynı hesaba aitse ve süresi geçmemişse döner.
 * Çağıran `safeRedirect` uygular.
 */
export function matchAuthRedirect(raw: string | null, email: string): string | null {
  if (!raw) return null;
  try {
    const record = JSON.parse(raw) as Partial<StoredAuthRedirect>;
    if (
      typeof record.redirect !== "string" ||
      typeof record.email !== "string" ||
      typeof record.savedAt !== "number"
    ) {
      return null;
    }
    const age = Date.now() - record.savedAt;
    if (age < 0 || age > AUTH_REDIRECT_MAX_AGE_MS) return null;
    return record.email === normalizeEmail(email) ? record.redirect : null;
  } catch {
    return null;
  }
}

export function clearAuthRedirect(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // depolama kullanılamıyor
  }
}
