import { getConfig } from "@/lib/config/app-config";
import { isDemoMode } from "@/lib/config/demo";
import { logger } from "@/lib/observability/logger";

/**
 * Doğrudan internete açık kurulum denetimi (v5#6, ADR 0034).
 *
 * Next 16'da `NextRequest.ip` yok; kendi barındırdığımız sunucuda soket adresi Proxy'ye
 * ulaşmaz. Önde güvenilir ters vekil (`TRUSTED_PROXY_HOPS>0` ya da `TRUST_REAL_IP_HEADER`)
 * yoksa istemci IP'si bilinemez ve tüm anonimler tek rate-limit/AI bütçesi kovasını paylaşır.
 * Üretimde (demo dışı) bu durum `ALLOW_DIRECT_EXPOSURE=true` ile bilinçli kabul edilmedikçe
 * yanlış yapılandırmadır: readiness 503 döner, başlangıçta ERROR loglanır.
 *
 * @returns sorun açıklaması (makine kodu ile) ya da sorun yoksa null
 */
export function directExposureProblem(
  env: Record<string, string | undefined> = process.env
): { code: "DIRECT_EXPOSURE_UNSAFE"; message: string } | null {
  if (isDemoMode(env)) return null;
  const config = getConfig();
  if (config.TRUSTED_PROXY_HOPS > 0 || config.TRUST_REAL_IP_HEADER) return null;
  if (config.ALLOW_DIRECT_EXPOSURE) return null;
  return {
    code: "DIRECT_EXPOSURE_UNSAFE",
    message:
      "Üretimde ters vekil yok (TRUSTED_PROXY_HOPS=0): istemci IP'si bilinemez, tüm anonimler " +
      "tek rate-limit kovasını paylaşır. Caddy arkasında çalıştırın (TRUSTED_PROXY_HOPS=1) ya da " +
      "bilinçliyse ALLOW_DIRECT_EXPOSURE=true verin.",
  };
}

/** Başlangıçta bir kez: yanlış yapılandırma varsa ERROR logu. Loglandıysa true. */
export function logDirectExposureStartup(): boolean {
  const problem = directExposureProblem();
  if (!problem) return false;
  logger.error({ code: problem.code }, problem.message);
  return true;
}
