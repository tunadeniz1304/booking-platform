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
  [0xc0a80000, 16], // 192.168/16
  [0xc6120000, 15], // 198.18/15
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

/** Adres özel, döngü, link-local, CGNAT, multicast veya ayrılmış aralıkta mı? */
export function isPrivateAddress(address: string): boolean {
  const ip = address
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  const v4 = ipv4ToInt(mapped ? mapped[1] : ip);
  if (v4 !== null) {
    return PRIVATE_V4.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      return (v4 & mask) >>> 0 === base;
    });
  }
  if (!ip.includes(":")) return true; // tanınmayan biçim → güvenli tarafta kal
  if (ip === "::" || ip === "::1") return true;
  if (ip.startsWith("::ffff:")) return true; // onaltılık gömülü v4 biçimleri
  const head = parseInt(ip.split(":")[0] || "0", 16);
  if ((head & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((head & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((head & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
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
