import type { NextRequest } from "next/server";
import { ValidationError } from "@/lib/http/errors";
import { getConfig } from "@/lib/config/app-config";
import { clientKey } from "@/lib/security/ip";

/** ACP uç noktalarında `Idempotency-Key` başlığı zorunludur (yeniden deneme güvenliği). */
export function requireIdempotencyKey(req: NextRequest): string {
  const key = req.headers.get("idempotency-key")?.trim().slice(0, 128);
  if (!key) throw new ValidationError("Idempotency-Key başlığı zorunludur");
  return key;
}

/** Ödeme risk bağlamı: web checkout ile aynı istemci anahtarı. */
export function riskContext(req: NextRequest) {
  const config = getConfig();
  const hops = config.TRUSTED_PROXY_HOPS;
  return {
    ip: clientKey(req.headers, {
      trustedProxyHops: hops,
      trustRealIpHeader: config.TRUST_REAL_IP_HEADER,
    }),
    ipCountry: hops > 0 ? req.headers.get("cf-ipcountry") : null,
  };
}

/** AP2 mandate başlıkta da taşınabilir (`AP2-Mandate: <jws>`); gövdedeki alan önceliklidir. */
export function mandateHeader(req: NextRequest): string | null {
  return req.headers.get("ap2-mandate")?.trim() || null;
}
