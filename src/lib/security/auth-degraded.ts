import { createHash } from "node:crypto";
import { redis } from "@/lib/redis";
import { getConfig } from "@/lib/config/app-config";
import { HttpError, ServiceUnavailableError } from "@/lib/http/errors";
import { issuePowChallenge, PowRequiredError, verifyPow } from "@/lib/auth/pow";
import type { PowSolution } from "@/lib/auth/pow-solver";
import { checkRateLimit } from "@/lib/security/rate-limit";

/**
 * Paylaşılan anonim kova tükendiğinde auth uçları için "yavaşlatılmış yol" (v5#6).
 *
 * İstemci IP'si bilinemediğinde (ters vekil yok) tüm anonimler `anon` kovasını paylaşır;
 * tek saldırgan onu doldurunca herkesin girişi/kaydı kilitlenirdi (global DoS). Proxy bu
 * durumda (istemcinin kendi parmak izi kovası hâlâ boşsa) isteği 429 yerine bu işaretle
 * route'a geçirir; route e-posta anahtarlı ikincil kovayı ve iş kanıtını (PoW) uygular.
 * İşaret istemciden gelirse proxy onu siler — yalnız proxy yazabilir.
 */
export const AUTH_DEGRADED_HEADER = "x-auth-degraded";

/** Bu yola düşebilen auth uçları (gövdesinde e-posta taşıyanlar). */
export const AUTH_DEGRADED_PATHS = [
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/password/forgot",
] as const;

interface HeaderSource {
  headers: { get(name: string): string | null };
}

export function isAuthDegraded(req: HeaderSource): boolean {
  return req.headers.get(AUTH_DEGRADED_HEADER) === "1";
}

/**
 * İşaretli istekte: e-posta başına auth kovası (aşımda 429 `RATE_LIMITED`), sonra geçerli PoW
 * (yoksa 429 `POW_REQUIRED` + bulmaca). İşaret yoksa hiçbir şey yapmaz.
 * Redis yoksa fail-closed (503).
 */
export async function enforceDegradedAuth(
  req: HeaderSource,
  input: { email: string; pow?: PowSolution | null; now?: number }
): Promise<void> {
  if (!isAuthDegraded(req)) return;
  const config = getConfig();
  const now = input.now ?? Date.now();
  const emailHash = createHash("sha256")
    .update(input.email.trim().toLowerCase())
    .digest("hex")
    .slice(0, 32);
  const decision = await checkRateLimit(redis, {
    category: "auth",
    identity: `email:${emailHash}`,
    config,
    now,
  });
  if (decision.unavailable) throw new ServiceUnavailableError();
  if (!decision.allowed) {
    throw new HttpError(
      429,
      "RATE_LIMITED",
      "Çok fazla istek. Lütfen biraz sonra tekrar deneyin.",
      {
        retryAfterSeconds: decision.resetSeconds,
      }
    );
  }
  if (!(await verifyPow(input.pow, now))) {
    throw new PowRequiredError(issuePowChallenge(now));
  }
}
