import { createHash, timingSafeEqual } from "crypto";
import { getAuth, type AuthRequest } from "@/lib/auth";
import { ForbiddenError, ServiceUnavailableError, UnauthorizedError } from "@/lib/http/errors";

/**
 * İç uç (`/api/internal/*`) yetkilendirmesi.
 *
 * İki yol:
 *  1. `x-internal-secret` başlığı — `INTERNAL_API_SECRET` ile timing-safe karşılaştırma.
 *     Sır tanımlı değilse, 32 karakterden kısaysa veya bilinen bir varsayılansa
 *     sır yolu KAPALIDIR ve 503 döner (varsayılan değer asla kabul edilmez).
 *  2. ADMIN rolündeki kullanıcının JWT'si.
 */

export const INTERNAL_SECRET_MIN_LENGTH = 32;
const KNOWN_DEFAULTS = new Set(["change-me-internal-secret", "change-me", "secret"]);

/** Kullanılabilir iç sır; zayıf/eksikse `null`. */
export function getInternalSecret(): string | null {
  const secret = process.env.INTERNAL_API_SECRET ?? "";
  if (secret.length < INTERNAL_SECRET_MIN_LENGTH || KNOWN_DEFAULTS.has(secret)) return null;
  return secret;
}

/** Uzunluk sızdırmayan sabit zamanlı string karşılaştırması (SHA-256 özetleri üzerinden). */
export function safeCompare(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export async function authorizeInternalRequest(req: AuthRequest): Promise<"secret" | "admin"> {
  const provided = req.headers.get("x-internal-secret");
  if (provided) {
    const secret = getInternalSecret();
    if (!secret) throw new ServiceUnavailableError("İç uç yapılandırılmamış");
    if (!safeCompare(provided, secret)) throw new ForbiddenError();
    return "secret";
  }
  const claims = await getAuth(req);
  if (claims?.role === "ADMIN") return "admin";
  if (claims) throw new ForbiddenError();
  if (!getInternalSecret()) throw new ServiceUnavailableError("İç uç yapılandırılmamış");
  throw new UnauthorizedError();
}
