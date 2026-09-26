/**
 * Güvenlik başlıkları + nonce'lu Content-Security-Policy.
 *
 * Stil için `'unsafe-inline'` bilinçli bir tercih: next/image ve harita bileşenleri
 * satır içi `style` özniteliği kullanır. Betikler nonce + `strict-dynamic` ile sıkıdır.
 *
 * `stripe: true` (yalnızca `PAYMENT_PROVIDER=stripe`) iken Stripe.js'in belgelediği
 * alan adları eklenir: betik/iframe `js.stripe.com`, 3DS iframe'i `hooks.stripe.com`,
 * API çağrıları `api.stripe.com`. Mock modunda bu alanlar politikada yer almaz.
 */
export interface CspOptions {
  stripe?: boolean;
}

export function buildCsp(nonce: string, isDev: boolean, opts: CspOptions = {}): string {
  const tiles = "https://tile.openstreetmap.org https://*.tile.openstreetmap.org";
  const stripe = opts.stripe === true;
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}${stripe ? " https://js.stripe.com" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: https://images.unsplash.com ${tiles}${stripe ? " https://*.stripe.com" : ""}`,
    "font-src 'self' data:",
    `connect-src 'self' ${tiles}${stripe ? " https://api.stripe.com" : ""}`,
    ...(stripe ? ["frame-src https://js.stripe.com https://hooks.stripe.com"] : []),
    // P1-12: service worker yalnızca kendi kökenimizden (/sw.js); harita blob işçileri için blob:.
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

/**
 * `/sw.js` yanıt başlıkları (P1-12). Proxy bu dosyayı atlar (nonce'lu sayfa CSP'si işçiye
 * uygulanmaz); işçinin kendi sıkı CSP'si: yalnızca aynı köken, satır içi/eval yok. Tarayıcı
 * güncellemeyi kaçırmasın diye önbelleğe alınmaz.
 */
export const SERVICE_WORKER_CSP =
  "default-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";

export const SERVICE_WORKER_HEADERS: ReadonlyArray<{ key: string; value: string }> = [
  { key: "Content-Type", value: "application/javascript; charset=utf-8" },
  { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
  { key: "Service-Worker-Allowed", value: "/" },
  { key: "Content-Security-Policy", value: SERVICE_WORKER_CSP },
];

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
