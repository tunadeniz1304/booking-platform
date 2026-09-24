/**
 * Güvenlik başlıkları + nonce'lu Content-Security-Policy.
 *
 * Stil için `'unsafe-inline'` bilinçli bir tercih: next/image ve harita bileşenleri
 * satır içi `style` özniteliği kullanır. Betikler nonce + `strict-dynamic` ile sıkıdır.
 */
export function buildCsp(nonce: string, isDev: boolean): string {
  const tiles = "https://tile.openstreetmap.org https://*.tile.openstreetmap.org";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: https://images.unsplash.com ${tiles}`,
    "font-src 'self' data:",
    `connect-src 'self' ${tiles}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

/** Tüm yanıtlara eklenen statik güvenlik başlıkları (next.config `headers()`). */
export const STATIC_SECURITY_HEADERS: ReadonlyArray<{ key: string; value: string }> = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(self), payment=(self)",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];
