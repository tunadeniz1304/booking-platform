import { describe, it, expect } from "vitest";
import {
  parseLlmSettings,
  describeLlmMode,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
} from "@/lib/llm/settings";

describe("LLM ayarları — öncelik sırası ve varsayılanlar", () => {
  it("anahtar yoksa varsayılanlar + DEMO", () => {
    const s = parseLlmSettings({});
    expect(s.hasKey).toBe(false);
    expect(s.effectiveMode).toBe("demo");
    expect(s.baseUrl).toBe(DEFAULT_BASE_URL);
    expect(s.model).toBe(DEFAULT_MODEL);
    expect(s.timeoutSeconds).toBe(20);
    expect(s.maxRetries).toBe(2);
    expect(s.temperature).toBe(0.2);
    expect(s.maxTokens).toBe(800);
    expect(describeLlmMode(s)).toBe("LLM: DEMO modu");
  });

  it("anahtar önceliği: LLM_API_KEY → DEEPSEEK → EVREN → OPENAI", () => {
    expect(parseLlmSettings({ OPENAI_API_KEY: "o", EVREN_API_KEY: "e" }).apiKey).toBe("e");
    expect(parseLlmSettings({ OPENAI_API_KEY: "o", DEEPSEEK_API_KEY: "d" }).apiKey).toBe("d");
    expect(parseLlmSettings({ LLM_API_KEY: "l", DEEPSEEK_API_KEY: "d" }).apiKey).toBe("l");
    expect(parseLlmSettings({ OPENAI_API_KEY: "o" }).apiKey).toBe("o");
  });

  it("base URL ve model önceliği", () => {
    const s = parseLlmSettings({
      OPENAI_BASE_URL: "https://openai.example/v1",
      EVREN_BASE_URL: "https://evren.example/v1",
      DEEPSEEK_MODEL: "ds-model",
    });
    expect(s.baseUrl).toBe("https://evren.example/v1");
    expect(s.baseUrlHost).toBe("evren.example");
    expect(s.model).toBe("ds-model");
    expect(parseLlmSettings({ LLM_MODEL: "x", DEEPSEEK_MODEL: "y" }).model).toBe("x");
  });

  it("anahtar varken auto → CANLI; açıklama anahtar içermez", () => {
    const s = parseLlmSettings({ LLM_API_KEY: "gizli-anahtar" });
    expect(s.effectiveMode).toBe("live");
    const line = describeLlmMode(s);
    expect(line).toBe("LLM: CANLI (deepseek-v4-flash @ evren-llmapi.ssyz.org.tr)");
    expect(line).not.toContain("gizli");
  });

  it("LLM_MODE=demo anahtar olsa bile ağa çıkmaz", () => {
    expect(parseLlmSettings({ LLM_API_KEY: "k", LLM_MODE: "demo" }).effectiveMode).toBe("demo");
  });

  it("LLM_MODE=live anahtarsız → demo (çökme yok)", () => {
    const s = parseLlmSettings({ LLM_MODE: "live" });
    expect(s.mode).toBe("live");
    expect(s.effectiveMode).toBe("demo");
  });

  it("sayısal değerler coerce edilir; sınır dışı değer varsayılana döner", () => {
    const s = parseLlmSettings({
      LLM_TIMEOUT_SECONDS: "45",
      LLM_MAX_RETRIES: "9",
      LLM_TEMPERATURE: "0.7",
      LLM_MAX_TOKENS: "10",
      LLM_MODE: "turbo",
    });
    expect(s.timeoutSeconds).toBe(45);
    expect(s.temperature).toBe(0.7);
    expect(s.maxRetries).toBe(2);
    expect(s.maxTokens).toBe(800);
    expect(s.mode).toBe("auto");
    expect(s.invalidKeys.sort()).toEqual(["maxRetries", "maxTokens", "mode"]);
  });

  it("LLM_LOG_PROMPTS production'da asla açılmaz", () => {
    expect(parseLlmSettings({ LLM_LOG_PROMPTS: "true" }).logPrompts).toBe(true);
    expect(parseLlmSettings({ LLM_LOG_PROMPTS: "true", NODE_ENV: "production" }).logPrompts).toBe(
      false
    );
  });

  it("v5 yeni adları: varsayılanlar, coerce ve geçersiz değer → varsayılan", () => {
    const d = parseLlmSettings({});
    expect(d.jsonModeRetryMinutes).toBe(60);
    expect(d.otelCaptureContent).toBe(false);
    expect(d.supportAgentEnabled).toBe(true);
    expect(d.supportHandoffMinConfidence).toBe(0.6);
    expect(d.supportMaxToolSteps).toBe(4);

    const s = parseLlmSettings({
      LLM_JSON_MODE_RETRY_MINUTES: "15",
      LLM_OTEL_CAPTURE_CONTENT: "TRUE",
      SUPPORT_AGENT_ENABLED: "false",
      SUPPORT_HANDOFF_MIN_CONFIDENCE: "0.75",
      SUPPORT_MAX_TOOL_STEPS: "3",
    });
    expect(s.jsonModeRetryMinutes).toBe(15);
    expect(s.otelCaptureContent).toBe(true);
    expect(s.supportAgentEnabled).toBe(false);
    expect(s.supportHandoffMinConfidence).toBe(0.75);
    expect(s.supportMaxToolSteps).toBe(3);
    expect(s.invalidKeys).toEqual([]);

    const bad = parseLlmSettings({
      LLM_JSON_MODE_RETRY_MINUTES: "0",
      LLM_OTEL_CAPTURE_CONTENT: "evet",
      SUPPORT_AGENT_ENABLED: "belki",
      SUPPORT_HANDOFF_MIN_CONFIDENCE: "1.5",
      SUPPORT_MAX_TOOL_STEPS: "99",
    });
    expect(bad.jsonModeRetryMinutes).toBe(60);
    expect(bad.otelCaptureContent).toBe(false);
    expect(bad.supportAgentEnabled).toBe(true);
    expect(bad.supportHandoffMinConfidence).toBe(0.6);
    expect(bad.supportMaxToolSteps).toBe(4);
    expect(bad.invalidKeys.sort()).toEqual([
      "jsonModeRetryMinutes",
      "otelCaptureContent",
      "supportAgentEnabled",
      "supportHandoffMinConfidence",
      "supportMaxToolSteps",
    ]);
  });
});
