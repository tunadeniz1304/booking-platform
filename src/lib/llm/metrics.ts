import { counter, histogram } from "@/lib/observability/metrics";

/**
 * LLM metrikleri (prom-client). Etiketlerde asla prompt içeriği, anahtar veya
 * URL yoktur — yalnızca görev adı, mod ve sonuç kodu.
 */
export const llmRequestsTotal = counter("llm_requests_total", "LLM çağrı sayısı", [
  "task",
  "mode",
  "outcome",
] as const);

export const llmLatencySeconds = histogram(
  "llm_latency_seconds",
  "LLM çağrı süresi (saniye)",
  ["task", "mode"] as const,
  [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 40]
);

export const llmTokensTotal = counter("llm_tokens_total", "LLM token kullanımı", [
  "task",
  "kind",
] as const);
