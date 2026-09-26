import { describe, it, expect, vi, afterEach } from "vitest";
import {
  describeLlmMode,
  parseLlmSettings,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
} from "@/lib/llm/settings";

/**
 * §3 LLM sözleşmesi — v4 doğrulama tablosunun v3 testlerinde kapsanmayan maddeleri:
 * başlangıç logu, durum ucundaki v4 alanları, varsayılanlar. Ağa çıkılmaz.
 */

const ENV_KEYS = ["LLM_API_KEY", "LLM_MODE", "LLM_MAX_CONCURRENCY", "LLM_VISION_MODEL"] as const;
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

afterEach(async () => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  const { resetLlmSettingsForTests } = await import("@/lib/llm/settings");
  resetLlmSettingsForTests();
  vi.restoreAllMocks();
});

describe("§3 v4 LLM sözleşmesi", () => {
  it("varsayılanlar: evren base URL, deepseek-v4-flash, auto, eşzamanlılık 4", () => {
    const s = parseLlmSettings({});
    expect(s).toMatchObject({
      baseUrl: DEFAULT_BASE_URL,
      model: DEFAULT_MODEL,
      mode: "auto",
      effectiveMode: "demo",
      maxConcurrency: 4,
    });
    expect(DEFAULT_BASE_URL).toBe("https://evren-llmapi.ssyz.org.tr/v1");
    expect(DEFAULT_MODEL).toBe("deepseek-v4-flash");
  });

  it("başlangıç logu: CANLI (model @ host) / DEMO modu — anahtar içermez", () => {
    const live = parseLlmSettings({ EVREN_API_KEY: "gizli-deger-1" });
    expect(describeLlmMode(live)).toBe("LLM: CANLI (deepseek-v4-flash @ evren-llmapi.ssyz.org.tr)");
    expect(describeLlmMode(parseLlmSettings({}))).toBe("LLM: DEMO modu");
  });

  it("logLlmStartup: LLM_MODE=live anahtarsız → hata logu + DEMO; tek sefer", async () => {
    vi.resetModules();
    delete process.env.LLM_API_KEY;
    process.env.LLM_MODE = "live";
    const { logger } = await import("@/lib/observability/logger");
    const info = vi.spyOn(logger, "info").mockImplementation(() => undefined);
    const error = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    const { resetLlmSettingsForTests } = await import("@/lib/llm/settings");
    resetLlmSettingsForTests();
    const { logLlmStartup } = await import("@/lib/llm/startup");
    logLlmStartup("test");
    logLlmStartup("test");
    expect(error).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0][1]).toBe("LLM: DEMO modu");
  });

  it("/api/llm/status: v4 alanları (maxConcurrency, visionEnabled), anahtar değeri yok", async () => {
    const k = ["durum", "gizli", "anahtar", "42"].join("-");
    process.env.LLM_API_KEY = k;
    process.env.LLM_MODE = "auto";
    process.env.LLM_MAX_CONCURRENCY = "6";
    process.env.LLM_VISION_MODEL = "vision-x";
    const { resetLlmSettingsForTests } = await import("@/lib/llm/settings");
    resetLlmSettingsForTests();
    const { getLlmStatus } = await import("@/lib/llm/status");
    const status = getLlmStatus();
    expect(status).toMatchObject({
      effectiveMode: "live",
      hasKey: true,
      maxConcurrency: 6,
      visionEnabled: true,
    });
    expect(JSON.stringify(status)).not.toContain(k);
    expect(JSON.stringify(status)).not.toContain("vision-x");
  });
});
