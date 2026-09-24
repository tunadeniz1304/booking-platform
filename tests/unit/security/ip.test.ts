import { describe, it, expect } from "vitest";
import { isValidIp, resolveClientIp } from "@/lib/security/ip";

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
