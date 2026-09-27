/**
 * Proxy seviyesinde oturum GEREKTİRMEYEN API uçları. Route handler'lar kendi
 * yetki kontrollerini ayrıca yapar; bu liste yalnızca ilk savunma hattıdır.
 */
interface PublicRule {
  prefix: string;
  /** Belirtilmezse tüm metotlar. */
  methods?: readonly string[];
}

const PUBLIC_API: readonly PublicRule[] = [
  { prefix: "/api/auth/" },
  { prefix: "/api/health" },
  { prefix: "/api/ready" },
  { prefix: "/api/metrics" }, // METRICS_TOKEN ile route içinde korunur
  { prefix: "/api/internal/" }, // internal-auth (sır veya ADMIN JWT) route içinde
  { prefix: "/api/payments/webhook" }, // HMAC imzalı
  { prefix: "/api/trust/kyc/webhook", methods: ["POST"] }, // KYC sağlayıcı imzalı (P1-6)
  { prefix: "/api/search", methods: ["GET", "POST"] },
  { prefix: "/api/properties", methods: ["GET"] },
  { prefix: "/api/locations", methods: ["GET"] },
  { prefix: "/api/quote", methods: ["GET"] },
  { prefix: "/api/rooms/", methods: ["GET"] },
  { prefix: "/api/routing/optimize", methods: ["GET"] },
  { prefix: "/api/transfers/discover", methods: ["GET"] },
  { prefix: "/api/notices", methods: ["POST"] }, // DSA md. 16 herkese açık bildirim (P1-13b)
];

/**
 * Herkese açık keşif belgeleri (API dışı, oturumsuz): UCP profili ve mandate doğrulaması
 * için açık anahtarlar (ADR 0025). Proxy bunlara oturum ya da sayfa CSP'si uygulamaz.
 */
export const PUBLIC_DISCOVERY_PATHS: readonly string[] = [
  "/.well-known/ucp",
  "/.well-known/jwks.json",
];

export function isPublicDiscovery(pathname: string): boolean {
  return PUBLIC_DISCOVERY_PATHS.includes(pathname);
}

/** CSRF Origin kontrolünün uygulanmadığı (kendi imza/sır doğrulaması olan) uçlar. */
export const CSRF_EXEMPT_PREFIXES: readonly string[] = [
  "/api/payments/webhook",
  "/api/trust/kyc/webhook",
  "/api/internal/",
];

export function isPublicApi(pathname: string, method: string): boolean {
  const m = method.toUpperCase();
  return PUBLIC_API.some(
    (rule) => pathname.startsWith(rule.prefix) && (!rule.methods || rule.methods.includes(m))
  );
}
