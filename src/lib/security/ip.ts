/**
 * IP-spoof koruması.
 *
 * `X-Forwarded-For` istemci tarafından doldurulabilir; ilk halkaya güvenmek
 * rate-limit baypasına yol açar. Kural: yalnızca önümüzdeki güvenilir proxy
 * sayısı (`TRUSTED_PROXY_HOPS`) kadar halkaya güvenilir. Her güvenilir proxy
 * zincirin SONUNA bir halka ekler; bu yüzden istemci IP'si sondan
 * `TRUSTED_PROXY_HOPS`'uncu halkadır. `TRUSTED_PROXY_HOPS=0` (doğrudan
 * internete açık) iken başlıklara hiç güvenilmez ve "unknown" döner; çağıranlar
 * tek global kovaya düşmemek için `clientKey()` kullanır.
 */

const IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const IPV6_RE = /^[0-9a-fA-F:]+(%[\w.]+)?$/;

export function isValidIp(value: string): boolean {
  if (IPV4_RE.test(value)) return true;
  return value.includes(":") && IPV6_RE.test(value);
}

interface HeaderSource {
  get(name: string): string | null;
}

/**
 * İsteğin gerçek istemci IP'sini güvenli şekilde çözer.
 * @param headers istek başlıkları
 * @param trustedProxyHops önümüzdeki güvenilir proxy sayısı
 */
export function resolveClientIp(headers: HeaderSource, trustedProxyHops: number): string {
  if (trustedProxyHops <= 0) return "unknown";

  const forwarded = headers.get("x-forwarded-for");
  if (!forwarded) return "unknown";

  const chain = forwarded
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (chain.length < trustedProxyHops) return "unknown";

  const candidate = chain[chain.length - trustedProxyHops];
  return isValidIp(candidate) ? candidate : "unknown";
}

/**
 * Rate-limit / SSE / görüntülenme tekilleştirme / fraud hız sayaçları için istemci
 * anahtarı (v3#3). Sıra:
 *
 *  1. Güvenilir proxy zincirinden çözülen IP → `ip:<adres>`.
 *  2. `TRUSTED_PROXY_HOPS=0` iken yalnızca `TRUST_REAL_IP_HEADER=true` ise (önde
 *     başlığı ezen tek bir güvenilir ters vekil varsa) `x-real-ip` → `ip:<adres>`.
 *  3. Aksi halde IP bilinmez: tüm anonimleri tek `"unknown"` kovasına atmak yerine
 *     kimliksiz parmak izi (User-Agent + Accept-Language özeti) → `anon:<hash>`.
 *     Parmak izi kişi tanımlamaz (ham değer saklanmaz) ve yalnızca kovaları ayırır;
 *     saldırgan değiştirebilir, bu yüzden hesap bazlı login limiti ayrıca uygulanır.
 */
export function clientKey(
  headers: HeaderSource,
  opts: { trustedProxyHops: number; trustRealIpHeader?: boolean }
): string {
  const ip = resolveClientIp(headers, opts.trustedProxyHops);
  if (ip !== "unknown") return `ip:${ip}`;
  if (opts.trustedProxyHops <= 0 && opts.trustRealIpHeader) {
    const real = headers.get("x-real-ip")?.trim();
    if (real && isValidIp(real)) return `ip:${real}`;
  }
  return `anon:${fingerprint(headers)}`;
}

/** UA + Accept-Language'in FNV-1a özeti (Edge/Node ortak, `crypto` gerektirmez). */
export function fingerprint(headers: HeaderSource): string {
  const input = `${headers.get("user-agent") ?? ""}|${headers.get("accept-language") ?? ""}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
