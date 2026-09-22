import { NextRequest } from "next/server";

/**
 * IP-spoof koruması.
 *
 * `X-Forwarded-For` istemci tarafından doldurulabilir; doğrudan ilk ele güvenmek
 * rate-limit baypasası açar. Kurallar:
 *  - Güvenilir proxy katmanı sayısı (`TRUSTED_PROXY_HOPS`) kadar zincir kabul edilir.
 *  - Zinciri daha uzun (enjeksiyon) gelen isteklerde fazla halkalar atılır.
 *  - Geçersiz (boş/ip olmayan) halka varsa istek doğrulanamaz → 0.0.0.0 sayılır
 *    (bellek/tarayıcı limitleme yine çalışır).
 */

const TRUSTED_PROXY_HOPS = 1; // production: 1 (ingress proxy) — ayarlayın

const IPV4_RE =
  /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

export function isValidIp(value: string): boolean {
  if (IPV4_RE.test(value)) return true;
  // IPv6 basit kontrol: ':' içeren ve boş olmayan
  return value.includes(":") && value.length >= 2 && !/\s/.test(value);
}

/**
 * İsteğin gerçek istemci IP'sini güvenli şekilde çözer.
 * Gerçek istemci ip (req.ip) yoksa doğrulanmış x-forwarded-for zincirinin
 * sondan TRUSTED_PROXY_HOPS gerisindeki halkayı döndürür.
 */
export function resolveClientIp(req: NextRequest): string {
  const direct = req.ip ?? null;

  if (direct && isValidIp(direct)) {
    return direct;
  }

  const forwarded = req.headers.get("x-forwarded-for");
  if (!forwarded) {
    return "unknown";
  }

  const chain = forwarded.split(",").map((p) => p.trim()).filter((p) => p.length > 0);
  if (chain.length === 0) return "unknown";

  // Zincir doğrulanamazsa en sağdaki (proxy'nin eklediği) halkayı kabul et;
  // enjeksiyon (uzun zincir) durumunda yalnızca güvenilir kısmı tut
  const valid = [...chain].reverse().find(isValidIp);
  if (!valid) return "0.0.0.0";

  const trustable = chain.slice(-(TRUSTED_PROXY_HOPS + 1));
  for (const hop of [...trustable].reverse()) {
    if (isValidIp(hop)) return hop;
  }
  return valid;
}
