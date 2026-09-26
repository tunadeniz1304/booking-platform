import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { signBookingCode, verifyBookingCode } from "@/lib/booking/booking-code";
import { qrDataUrl } from "@/lib/booking/itinerary";
import { buildManifest, THEME_COLOR } from "@/lib/pwa/manifest";
import { base64UrlToBytes } from "@/lib/pwa/client";
import { buildCsp, SERVICE_WORKER_CSP, SERVICE_WORKER_HEADERS } from "@/lib/security/headers";
import { GET as manifestRoute } from "@/app/manifest.webmanifest/route";
import { NextRequest } from "next/server";

describe("P1-12 imzalı rezervasyon kodu", () => {
  it("kod yalnızca kimlik + imza içerir ve doğrulanır", () => {
    const code = signBookingCode("cm1booking123");
    expect(code).toMatch(/^BK1\.cm1booking123\.[A-Za-z0-9_-]{22}$/);
    expect(verifyBookingCode(code)).toBe("cm1booking123");
    expect(verifyBookingCode(`  ${code}  `)).toBe("cm1booking123");
  });

  it("kurcalanmış, başka rezervasyona taşınmış veya bozuk kod reddedilir", () => {
    const code = signBookingCode("cm1booking123");
    const sig = code.split(".")[2];
    expect(verifyBookingCode(`BK1.cm1booking124.${sig}`)).toBeNull();
    expect(verifyBookingCode(`${code.slice(0, -1)}${code.endsWith("A") ? "B" : "A"}`)).toBeNull();
    expect(verifyBookingCode(`BK2.cm1booking123.${sig}`)).toBeNull();
    expect(verifyBookingCode("BK1.cm1booking123.short")).toBeNull();
    expect(verifyBookingCode("BK1.bad id.x")).toBeNull();
    expect(verifyBookingCode("")).toBeNull();
    expect(() => signBookingCode("../etc")).toThrow();
  });

  it("QR bir SVG data URL'dir (CSP img-src data: ile uyumlu)", async () => {
    const url = await qrDataUrl(signBookingCode("cm1booking123"));
    expect(url.startsWith("data:image/svg+xml;base64,")).toBe(true);
    const svg = Buffer.from(url.split(",")[1], "base64").toString("utf8");
    expect(svg).toContain("<svg");
    expect(svg).not.toContain("<script");
  });
});

describe("P1-12 web app manifest", () => {
  it("TR/EN ad, standalone, 192/512 PNG ve maskable ikon içerir (kurulabilirlik)", () => {
    const tr = buildManifest("tr");
    const en = buildManifest("en");
    expect(tr.name).toContain("Konaklama");
    expect(en.name).toContain("Stay");
    expect(tr.lang).toBe("tr");
    for (const m of [tr, en]) {
      expect(m.display).toBe("standalone");
      expect(m.start_url.startsWith("/")).toBe(true);
      expect(m.theme_color).toBe(THEME_COLOR);
      const sizes = m.icons.filter((i) => i.type === "image/png").map((i) => i.sizes);
      expect(sizes).toEqual(expect.arrayContaining(["192x192", "512x512"]));
      expect(m.icons.some((i) => i.purpose === "maskable")).toBe(true);
      for (const icon of m.icons) {
        expect(() => readFileSync(path.join("public", icon.src))).not.toThrow();
      }
    }
  });

  it("route dil çerezine göre manifest döndürür", async () => {
    const res = manifestRoute(
      new NextRequest("http://localhost:3000/manifest.webmanifest", {
        headers: { cookie: "NEXT_LOCALE=en" },
      })
    );
    expect(res.headers.get("content-type")).toContain("application/manifest+json");
    expect(((await res.json()) as { lang: string }).lang).toBe("en");
  });
});

describe("P1-12 CSP ve service worker başlıkları", () => {
  it("sayfa CSP'si manifest ve işçiyi yalnızca kendi kökeninden izinler", () => {
    const csp = buildCsp("n0nce", false);
    expect(csp).toContain("manifest-src 'self'");
    expect(csp).toMatch(/worker-src 'self'/);
    expect(csp).toContain("'nonce-n0nce'");
  });

  it("sw.js kendi sıkı CSP'si, önbelleksiz ve kök kapsamla sunulur", () => {
    const headers = Object.fromEntries(SERVICE_WORKER_HEADERS.map((h) => [h.key, h.value]));
    expect(headers["Service-Worker-Allowed"]).toBe("/");
    expect(headers["Cache-Control"]).toContain("no-cache");
    expect(SERVICE_WORKER_CSP).toContain("script-src 'self'");
    expect(SERVICE_WORKER_CSP).not.toContain("unsafe");
  });

  it("service worker yalnızca seyahat sayfası/API'sini önbelleğe alır ve çıkışta temizler", () => {
    const sw = readFileSync(path.join("public", "sw.js"), "utf8");
    expect(sw).toContain('const OFFLINE_PAGES = ["/trips"]');
    expect(sw).toContain('const OFFLINE_APIS = ["/api/itinerary"]');
    expect(sw).toContain("CLEAR_USER_DATA");
    // Bildirim tıklaması yalnızca aynı kökene gider (açık yönlendirme yok).
    expect(sw).toContain("target.origin !== self.location.origin");
  });

  it("VAPID açık anahtarı base64url → bayt", () => {
    expect(Array.from(base64UrlToBytes("AQID_-8"))).toEqual([1, 2, 3, 255, 239]);
  });
});
