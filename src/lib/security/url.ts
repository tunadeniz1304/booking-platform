import { z } from "zod";

/**
 * Yalnızca `https:` şemalı mutlak URL'ler (ör. ilan görselleri).
 * `javascript:`, `data:`, `http:` gibi şemalar reddedilir (XSS / karışık içerik).
 */
export const httpsUrl = z
  .string()
  .trim()
  .max(2048)
  .url()
  .refine((value) => {
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  }, "Yalnızca https:// adresleri kabul edilir");

/**
 * SSRF koruması (v3#21): sunucunun dışarıya istek attığı URL'lerde hedef adres
 * özel/iç ağda olmamalı. Kontrol DNS çözümlemesinden SONRA, bağlanılacak IP üzerinde
 * yapılır (`https.request` `lookup` kancası) → DNS rebinding ile atlatılamaz.
 */
const PRIVATE_V4: Array<[number, number]> = [
  [0x00000000, 8], // 0.0.0.0/8
  [0x0a000000, 8], // 10/8
  [0x64400000, 10], // 100.64/10 (CGNAT)
  [0x7f000000, 8], // 127/8
  [0xa9fe0000, 16], // 169.254/16 (link-local, bulut metadata)
  [0xac100000, 12], // 172.16/12
  [0xc0000000, 24], // 192.0.0/24
  [0xc0000200, 24], // 192.0.2/24 (TEST-NET-1)
  [0xc0586300, 24], // 192.88.99/24 (6to4 relay anycast)
  [0xc0a80000, 16], // 192.168/16
  [0xc6120000, 15], // 198.18/15
  [0xc6336400, 24], // 198.51.100/24 (TEST-NET-2)
  [0xcb007100, 24], // 203.0.113/24 (TEST-NET-3)
  [0xe0000000, 3], // 224/3 (multicast + ayrılmış)
];

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p) || Number(p) > 255) return null;
    n = n * 256 + Number(p);
  }
  return n;
}

function isPrivateV4(v4: number): boolean {
  return PRIVATE_V4.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (v4 & mask) >>> 0 === base;
  });
}

/**
 * IPv6 metnini 8 adet 16-bit gruba çözer (`::` kısaltması ve sondaki noktalı IPv4
 * dahil). Geçersiz biçim → `null`. Bölge kimliği (`%eth0`) atılır.
 */
export function parseIpv6(raw: string): number[] | null {
  let ip = raw
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  const zone = ip.indexOf("%");
  if (zone >= 0) ip = ip.slice(0, zone);
  if (!ip.includes(":")) return null;
  // Sondaki noktalı IPv4'ü iki gruba çevir.
  const lastColon = ip.lastIndexOf(":");
  const tail = ip.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = ipv4ToInt(tail);
    if (v4 === null) return null;
    ip = `${ip.slice(0, lastColon + 1)}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string): number[] | null => {
    if (part === "") return [];
    const out: number[] = [];
    for (const group of part.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
      out.push(parseInt(group, 16));
    }
    return out;
  };
  const head = parse(halves[0]);
  const rest = halves.length === 2 ? parse(halves[1]) : [];
  if (!head || !rest) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const fill = 8 - head.length - rest.length;
  if (fill < 1) return null;
  return [...head, ...new Array<number>(fill).fill(0), ...rest];
}

const v4From = (hi: number, lo: number): number => ((hi << 16) | lo) >>> 0;

/**
 * IPv6 adresi özel/ayrılmış mı? IPv4 gömen biçimlerde (v4-mapped, v4-compatible,
 * NAT64 `64:ff9b::/96`, 6to4 `2002::/16`) gömülü IPv4 çözülüp v4 listesiyle TEKRAR
 * denetlenir (v4#11): `64:ff9b::7f00:1` → 127.0.0.1 → ret.
 */
function isPrivateV6(g: number[]): boolean {
  const zeroUpTo = (n: number) => g.slice(0, n).every((x) => x === 0);
  if (zeroUpTo(8)) return true; // ::
  if (zeroUpTo(7) && g[7] === 1) return true; // ::1
  if (zeroUpTo(5) && g[5] === 0xffff) return isPrivateV4(v4From(g[6], g[7])); // ::ffff:a.b.c.d
  if (zeroUpTo(4) && g[4] === 0xffff && g[5] === 0) return true; // ::ffff:0:a.b.c.d (SIIT)
  if (zeroUpTo(6)) return true; // ::a.b.c.d (kullanımdan kalkmış v4-compatible) — güvenli taraf
  if (g[0] === 0x64 && g[1] === 0xff9b) {
    // 64:ff9b::/96 (NAT64 iyi-bilinen önek) → gömülü v4; 64:ff9b:1::/48 yerel NAT64 → ret.
    if (g.slice(2, 6).every((x) => x === 0)) return isPrivateV4(v4From(g[6], g[7]));
    return true;
  }
  if (g[0] === 0x2002) return isPrivateV4(v4From(g[1], g[2])); // 6to4
  if (g[0] === 0x2001 && g[1] === 0) return true; // 2001::/32 Teredo (istemci v4'ü gizli)
  if (g[0] === 0x2001 && g[1] === 0xdb8) return true; // 2001:db8::/32 dokümantasyon
  if (g[0] === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true; // 100::/64 discard
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (eski)
  if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}

/** Adres özel, döngü, link-local, CGNAT, TEST-NET, multicast veya ayrılmış aralıkta mı? */
export function isPrivateAddress(address: string): boolean {
  const ip = address
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  const v4 = ipv4ToInt(ip);
  if (v4 !== null) return isPrivateV4(v4);
  if (!ip.includes(":")) return true; // tanınmayan biçim → güvenli tarafta kal
  const groups = parseIpv6(ip);
  if (!groups) return true; // çözülemeyen v6 → güvenli taraf
  return isPrivateV6(groups);
}

/** Sunucu tarafı istek için URL: https, kimlik bilgisi yok, IP-literal ise genel adres. */
export function assertFetchableUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error("Yalnızca https:// adresleri kabul edilir");
  if (url.username || url.password) throw new Error("URL kimlik bilgisi içeremez");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) {
    throw new Error("İç ağ adresine istek yapılamaz");
  }
  if ((ipv4ToInt(host) !== null || host.includes(":")) && isPrivateAddress(host)) {
    throw new Error("İç ağ adresine istek yapılamaz");
  }
  return url;
}
