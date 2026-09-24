/**
 * IP-spoof koruması.
 *
 * `X-Forwarded-For` istemci tarafından doldurulabilir; ilk halkaya güvenmek
 * rate-limit baypasına yol açar. Kural: yalnızca önümüzdeki güvenilir proxy
 * sayısı (`TRUSTED_PROXY_HOPS`) kadar halkaya güvenilir. Her güvenilir proxy
 * zincirin SONUNA bir halka ekler; bu yüzden istemci IP'si sondan
 * `TRUSTED_PROXY_HOPS`'uncu halkadır. `TRUSTED_PROXY_HOPS=0` (doğrudan
 * internete açık) iken başlıklara hiç güvenilmez ve "unknown" döner.
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
