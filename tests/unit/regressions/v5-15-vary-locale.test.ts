import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../../..");
const caddyfile = readFileSync(path.join(root, "docker/Caddyfile"), "utf8");

describe("regression: v5#15 sayfa yanıtı Accept-Language ve Cookie'ye göre değişir (Vary)", () => {
  it("Next'in app-page işleyicisi Vary'yi setHeader ile ezer — proxy.ts'de eklemek etkisizdir", () => {
    // Kök neden: proxy yanıt başlıkları res'e yazıldıktan SONRA app-page şablonu
    // `res.setHeader('Vary', …)` çağırır; proxy'nin eklediği değer kaybolur.
    const require = createRequire(import.meta.url);
    const template = readFileSync(
      require.resolve("next/dist/build/templates/app-page-runtime.js"),
      "utf8"
    );
    expect(template).toMatch(/res\.setHeader\('Vary', varyHeader\)/);
  });

  it("Caddy sayfa yanıtlarına ertelenmiş (+) Vary: Accept-Language, Cookie ekler", () => {
    expect(caddyfile).toMatch(/header\s+@pages\s*\{[^}]*\+Vary\s+"Accept-Language, Cookie"/);
    expect(caddyfile).toMatch(/header\s+@pages\s*\{[^}]*\bdefer\b/);
  });

  it("statik varlıklar ve API bu Vary'den muaf (önbellek verimi)", () => {
    const matcher = caddyfile.match(/@pages\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(matcher).toMatch(/not path[^\n]*\/_next\/static\/\*/);
    expect(matcher).toMatch(/not path[^\n]*\/api\/\*/);
  });
});
