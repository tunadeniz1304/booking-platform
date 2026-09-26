/**
 * IP-spoof koruması.
 *
 * `X-Forwarded-For` istemci tarafından doldurulabilir; ilk halkaya güvenmek
 * rate-limit baypasına yol açar. Kural: yalnızca önümüzdeki güvenilir proxy
 * sayısı (`TRUSTED_PROXY_HOPS`) kadar halkaya güvenilir. Her güvenilir proxy
 * zincirin SONUNA bir halka ekler; bu yüzden istemci IP'si sondan
 * `TRUSTED_PROXY_HOPS`'uncu halkadır. `TRUSTED_PROXY_HOPS=0` (doğrudan
 * internete açık) iken başlıklara hiç güvenilmez; yalnızca soket IP'si
 * kullanılır, o da yoksa "unknown" döner.
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
 * İsteğin gerçek istemci IP'sini güvenli şekilde çözer (v4#4).
 *
 *  - Önde güvenilir proxy varsa (`trustedProxyHops > 0`) `X-Forwarded-For`
 *    zincirinin sondan `trustedProxyHops`'uncu halkası.
 *  - Aksi halde çalışma ortamının verdiği soket IP'si (`socketIp`; Next.js'te
 *    platform `request.ip` sağlıyorsa). İstemci başlıklarına hiç güvenilmez.
 * @param headers istek başlıkları
 * @param trustedProxyHops önümüzdeki güvenilir proxy sayısı
 * @param socketIp TCP soketinden gelen uzak adres (varsa)
 */
export function resolveClientIp(
  headers: HeaderSource,
  trustedProxyHops: number,
  socketIp?: string | null
): string {
  if (trustedProxyHops <= 0) {
    const socket = socketIp?.trim();
    return socket && isValidIp(socket) ? socket : "unknown";
  }

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

/** "a:b::c" biçimindeki IPv6'yı 8 grupluk tam diziye açar (geçersizse null). */
function expandIpv6(value: string): number[] | null {
  const addr = value.split("%")[0].toLowerCase();
  const halves = addr.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string) => (part === "" ? [] : part.split(":"));
  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  // Sonda gömülü IPv4 (::ffff:1.2.3.4) iki gruba çevrilir.
  const last = tail.length ? tail : head;
  const lastPart = last[last.length - 1];
  if (lastPart && lastPart.includes(".")) {
    if (!IPV4_RE.test(lastPart)) return null;
    const o = lastPart.split(".").map(Number);
    last.splice(
      last.length - 1,
      1,
      ((o[0] << 8) | o[1]).toString(16),
      ((o[2] << 8) | o[3]).toString(16)
    );
  }
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  const nums = groups.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return nums.some((n) => Number.isNaN(n)) ? null : nums;
}

/**
 * Rate-limit anahtarı için IP normalizasyonu (v4#4): IPv4 olduğu gibi; IPv4-eşlemeli
 * IPv6 (`::ffff:a.b.c.d`) IPv4'e indirgenir; diğer IPv6 adresleri /64 önekine
 * toplulaştırılır — tek bir müşteri hattı genelde bütün bir /64 alır, adres
 * değiştirerek yeni kota almak engellenir.
 */
export function ipBucket(ip: string): string {
  if (IPV4_RE.test(ip)) return ip;
  const groups = expandIpv6(ip);
  if (!groups) return ip;
  const isMapped = groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff;
  if (isMapped) {
    return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join(".");
  }
  return `${groups
    .slice(0, 4)
    .map((g) => g.toString(16))
    .join(":")}::/64`;
}

export interface ClientKeyOptions {
  trustedProxyHops: number;
  trustRealIpHeader?: boolean;
  /** Çalışma ortamının verdiği soket IP'si (Next `request.ip` benzeri), varsa. */
  socketIp?: string | null;
}

/** Güvenilir kaynaklardan çözülen IP'nin kova anahtarı; IP bilinmiyorsa null. */
export function trustedIpKey(headers: HeaderSource, opts: ClientKeyOptions): string | null {
  const ip = resolveClientIp(headers, opts.trustedProxyHops, opts.socketIp);
  if (ip !== "unknown") return `ip:${ipBucket(ip)}`;
  if (opts.trustedProxyHops <= 0 && opts.trustRealIpHeader) {
    const real = headers.get("x-real-ip")?.trim();
    if (real && isValidIp(real)) return `ip:${ipBucket(real)}`;
  }
  return null;
}

/** IP bilinmediğinde tüm anonimlerin paylaştığı birincil kova (v4#4). */
export const SHARED_ANON_KEY = "anon";

/**
 * Anonim rate-limit / AI bütçesi kimlikleri (v4#4).
 *
 *  - IP biliniyorsa tek kimlik: `ip:<kova>`.
 *  - IP bilinmiyorsa birincil kimlik PAYLAŞILAN `anon` kovasıdır (User-Agent
 *    değiştirerek sıfırlanamaz); UA parmak izi yalnızca ikincil sinyal olarak
 *    ayrı, daha dar bir kova açar (tek istemcinin paylaşılan kovayı tüketmesini
 *    geciktirir) — asla kotayı genişletmez.
 */
export function anonymousIdentities(
  headers: HeaderSource,
  opts: ClientKeyOptions
): { primary: string; secondary: string | null } {
  const ip = trustedIpKey(headers, opts);
  if (ip) return { primary: ip, secondary: null };
  return { primary: SHARED_ANON_KEY, secondary: `anon:${fingerprint(headers)}` };
}

/**
 * SSE bağlantı yuvası / fraud hız sayaçları için istemci anahtarı (v3#3, v4#4).
 * Güvenilir IP (IPv6 /64 toplulaştırılmış) → `ip:<kova>`; bilinmiyorsa kimliksiz
 * parmak izi → `anon:<hash>`. Parmak izi istemci tarafından değiştirilebilir;
 * bu yüzden kota/bütçe kararlarında tek başına KULLANILMAZ — rate-limit ve AI
 * bütçesi `anonymousIdentities()` ile paylaşılan birincil kovayı da uygular.
 */
export function clientKey(headers: HeaderSource, opts: ClientKeyOptions): string {
  return trustedIpKey(headers, opts) ?? `anon:${fingerprint(headers)}`;
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
