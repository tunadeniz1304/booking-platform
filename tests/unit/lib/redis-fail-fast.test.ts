import { describe, it, expect } from "vitest";
import { shouldFailFast, RedisUnavailableError } from "@/lib/redis";
import { parseAppConfig } from "@/lib/config/app-config";

describe("kaos bulgusu: Redis koptuğunda komutlar yeniden bağlanmayı beklemez", () => {
  it("ilk tembel bağlantıda (hiç hazır olmadı) komut kuyrukta bekler", () => {
    expect(shouldFailFast("wait", false)).toBe(false);
    expect(shouldFailFast("connecting", false)).toBe(false);
  });

  it("bağlantı bir kez hazır olduktan sonra koptuysa hemen reddedilir", () => {
    for (const status of ["reconnecting", "connecting", "close", "end"]) {
      expect(shouldFailFast(status, true)).toBe(true);
    }
    expect(shouldFailFast("ready", true)).toBe(false);
  });

  it("hata tipi ve komut zaman aşımı yapılandırması", () => {
    const err = new RedisUnavailableError("reconnecting");
    expect(err.name).toBe("RedisUnavailableError");
    expect(err.message).toContain("reconnecting");
    expect(parseAppConfig({}).REDIS_COMMAND_TIMEOUT_MS).toBe(1000);
    expect(parseAppConfig({ REDIS_COMMAND_TIMEOUT_MS: "250" }).REDIS_COMMAND_TIMEOUT_MS).toBe(250);
  });
});
