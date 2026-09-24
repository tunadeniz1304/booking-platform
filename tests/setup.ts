/**
 * Tüm test projeleri için ortak kurulum.
 *
 * - Testler ağa ÇIKMAZ: global `fetch` yalnızca loopback adreslerine izin verir,
 *   diğer her çağrıda hata fırlatır (LLM/PSP/harita gibi dış servisler mock'lanmalı).
 * - `.env` dosyası testlerde yüklenmez (`SKIP_DOTENV`): gerçek anahtarlar test
 *   sürecine sızmaz, sonuçlar geliştirici makinesinden bağımsızdır.
 * - Kimlik doğrulama modülleri için deterministik, yalnızca-test sırları.
 */
import { vi } from "vitest";

function setDefault(name: string, value: string): void {
  if (!process.env[name]) process.env[name] = value;
}

setDefault("SKIP_DOTENV", "1");
setDefault("NODE_ENV", "test");
setDefault("LLM_MODE", "demo");
setDefault("JWT_SECRET", "t".repeat(48));
setDefault("INTERNAL_API_SECRET", "i".repeat(48));
setDefault("TRANSFER_SIGNING_SECRET", "s".repeat(48));
setDefault("PSP_WEBHOOK_SECRET", "w".repeat(48));
setDefault("CHANNEL_FEED_SECRET", "c".repeat(48));
setDefault("DATABASE_URL", "postgresql://unit:unit@127.0.0.1:1/unit");
setDefault("REDIS_URL", "redis://127.0.0.1:1");

const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])$/;
const realFetch = globalThis.fetch;

vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(
    typeof input === "string" ? input : input instanceof URL ? input.href : input.url
  );
  if (!LOOPBACK.test(url.hostname)) {
    throw new Error(`Testlerde ağ çağrısı yasak: ${url.hostname}`);
  }
  return realFetch(input, init);
});
