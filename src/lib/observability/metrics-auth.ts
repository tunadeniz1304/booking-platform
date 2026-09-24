import { createHash, timingSafeEqual } from "crypto";

/** `/metrics` Bearer token doğrulaması (timing-safe). Token yoksa/zayıfsa uç kapalıdır. */
export function metricsAuthorized(
  header: string | null,
  token = process.env.METRICS_TOKEN ?? ""
): "ok" | "unauthorized" | "disabled" {
  if (token.length < 16) return "disabled";
  const provided = header?.startsWith("Bearer ") ? header.slice(7) : "";
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(token).digest();
  return timingSafeEqual(a, b) && provided.length > 0 ? "ok" : "unauthorized";
}
