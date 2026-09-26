import { getLlmSettings } from "./settings";
import { getLlmRuntimeStatus } from "./client";

export interface LlmStatus {
  mode: "auto" | "live" | "demo";
  effectiveMode: "live" | "demo";
  model: string;
  baseUrlHost: string;
  hasKey: boolean;
  /** Süreç başına eşzamanlı istek üst sınırı (LLM_MAX_CONCURRENCY). */
  maxConcurrency: number;
  /** LLM_VISION_MODEL tanımlı mı (değer/anahtar değil). */
  visionEnabled: boolean;
  jsonModeSupported: boolean | null;
  lastError: string | null;
}

/** `/api/llm/status` yanıtı — anahtar değeri ASLA içermez. */
export function getLlmStatus(): LlmStatus {
  const settings = getLlmSettings();
  const runtime = getLlmRuntimeStatus();
  return {
    mode: settings.mode,
    effectiveMode: settings.effectiveMode,
    model: settings.model,
    baseUrlHost: settings.baseUrlHost,
    hasKey: settings.hasKey,
    maxConcurrency: settings.maxConcurrency,
    visionEnabled: settings.effectiveMode === "live" && Boolean(settings.visionModel),
    jsonModeSupported: runtime.jsonModeSupported,
    lastError: runtime.lastError,
  };
}
