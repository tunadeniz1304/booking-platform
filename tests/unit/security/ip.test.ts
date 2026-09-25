import { describe, it, expect } from "vitest";
import { clientKey, fingerprint, isValidIp, resolveClientIp } from "@/lib/security/ip";

function headers(xff?: string) {
  return { get: (name: string) => (name === "x-forwarded-for" ? (xff ?? null) : null) };
}

describe("IP-spoof koruması (resolveClientIp)", () => {
  it("geçerli IPv4/IPv6 kabul eder, bozuk değerleri reddeder", () => {
    expect(isValidIp("203.0.113.7")).toBe(true);
    expect(isValidIp("2001:db8::1")).toBe(true);
    expect(isValidIp("fe80::1%eth0")).toBe(true);
    expect(isValidIp("256.1.1.1")).toBe(false);
    expect(isValidIp("1.2.3")).toBe(false);
    expect(isValidIp("evil.example")).toBe(false);
    expect(isValidIp("abcd")).toBe(false); // ':' yok → IPv6 değil
  });

  it("TRUSTED_PROXY_HOPS=0 iken başlıklara hiç güvenilmez", () => {
    expect(resolveClientIp(headers("198.51.100.1"), 0)).toBe("unknown");
  });

  it("başlık yoksa veya zincir güvenilir hop sayısından kısaysa unknown", () => {
    expect(resolveClientIp(headers(), 1)).toBe("unknown");
    expect(resolveClientIp(headers("198.51.100.1"), 2)).toBe("unknown");
    expect(resolveClientIp(headers(" , "), 1)).toBe("unknown");
  });

  it("istemcinin eklediği sahte ilk halka yok sayılır: sondan N'inci halka kullanılır", () => {
    // İstemci "1.1.1.1" uydurur; tek güvenilir proxy gerçek adresi (203.0.113.9) sona ekler.
    expect(resolveClientIp(headers("1.1.1.1, 203.0.113.9"), 1)).toBe("203.0.113.9");
    // İki güvenilir proxy: istemci sondan ikinci halkadır.
    expect(resolveClientIp(headers("1.1.1.1, 203.0.113.9, 10.0.0.2"), 2)).toBe("203.0.113.9");
  });

  it("aday halka geçerli IP değilse unknown döner (enjeksiyon)", () => {
    expect(resolveClientIp(headers("1.1.1.1, <script>"), 1)).toBe("unknown");
  });
});

describe("regression: v3#3 clientKey", () => {
  const h = (init: Record<string, string>) => new Headers(init);

  it("hops=0 ve güvenilir başlık yok → parmak izi kovası (unknown değil)", () => {
    const key = clientKey(h({ "x-forwarded-for": "1.2.3.4", "user-agent": "A" }), {
      trustedProxyHops: 0,
    });
    expect(key).toMatch(/^anon:[0-9a-f]{8}$/);
  });

  it("farklı UA/dil → farklı kova; aynı → aynı kova", () => {
    const a = fingerprint(h({ "user-agent": "A", "accept-language": "tr" }));
    const b = fingerprint(h({ "user-agent": "B", "accept-language": "tr" }));
    expect(a).not.toBe(b);
    expect(fingerprint(h({ "user-agent": "A", "accept-language": "tr" }))).toBe(a);
  });

  it("x-real-ip yalnızca TRUST_REAL_IP_HEADER ile ve geçerliyse kullanılır", () => {
    const headers = h({ "x-real-ip": "198.51.100.9" });
    expect(clientKey(headers, { trustedProxyHops: 0 })).toMatch(/^anon:/);
    expect(clientKey(headers, { trustedProxyHops: 0, trustRealIpHeader: true })).toBe(
      "ip:198.51.100.9"
    );
    expect(
      clientKey(h({ "x-real-ip": "<x>" }), { trustedProxyHops: 0, trustRealIpHeader: true })
    ).toMatch(/^anon:/);
  });

  it("güvenilir proxy zinciri varsa IP anahtarı", () => {
    expect(
      clientKey(h({ "x-forwarded-for": "1.1.1.1, 203.0.113.9" }), { trustedProxyHops: 1 })
    ).toBe("ip:203.0.113.9");
  });
});
