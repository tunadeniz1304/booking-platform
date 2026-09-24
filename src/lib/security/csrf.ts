/**
 * CSRF koruması (OWASP "Verify Origin With Standard Headers").
 *
 * Çerezle kimliği doğrulanan durum değiştiren isteklerde (POST/PUT/PATCH/DELETE)
 * `Origin` (yoksa `Referer`) başlığı uygulamanın kendi origin'i veya
 * `APP_ORIGINS` listesindekilerden biri olmalıdır. `Sec-Fetch-Site: cross-site`
 * doğrudan reddedilir. Bearer token'lı istekler (tarayıcı dışı istemciler) ve
 * imzalı webhook'lar kapsam dışıdır: çerez otomatik gönderilmediğinden CSRF'e
 * açık değildirler.
 */

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export interface CsrfInput {
  method: string;
  headers: Headers;
  /** İsteğin kendi origin'i (ör. `http://localhost:3000`). */
  selfOrigin: string;
  hasCookieAuth: boolean;
  hasBearer: boolean;
  allowedOrigins?: readonly string[];
}

function originOf(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/** `APP_ORIGINS` (virgülle ayrık) ortam değişkeninden izinli origin listesi. */
export function allowedOriginsFromEnv(): string[] {
  return (process.env.APP_ORIGINS ?? process.env.NEXT_PUBLIC_APP_URL ?? "")
    .split(",")
    .map((o) => originOf(o.trim()))
    .filter((o): o is string => Boolean(o));
}

/** `true` → istek reddedilmeli. */
export function isCsrfViolation(input: CsrfInput): boolean {
  if (!UNSAFE_METHODS.has(input.method.toUpperCase())) return false;
  if (!input.hasCookieAuth || input.hasBearer) return false;

  if (input.headers.get("sec-fetch-site") === "cross-site") return true;

  const origin = originOf(input.headers.get("origin")) ?? originOf(input.headers.get("referer"));
  if (!origin) return true;
  const allowed = new Set([input.selfOrigin, ...(input.allowedOrigins ?? [])]);
  return !allowed.has(origin);
}
