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

/**
 * P0-6: görev → onu tetikleyen API rotası (token maliyetinin hangi uca ait olduğu).
 * Etiket değeri sabit bir kümedir (kardinalite sınırlı); bilinmeyen görev "other".
 */
export const LLM_TASK_ROUTE: Readonly<Record<string, string>> = {
  smart_filter: "/api/search/smart",
  review_summary: "/api/properties/[id]/reviews/summary",
  trip_plan: "/api/ai/trip-plan",
  listing_copy: "/api/ai/listing-copy",
  event_extraction: "/api/admin/events",
  message_draft: "/api/bookings/[id]/messages/draft",
  moderation_explain: "/api/admin/reviews",
  revenue_explain: "/api/host/revenue",
  review_highlights: "/api/properties/[id]/review-highlights",
  listing_compare: "/api/compare",
  message_risk: "/api/bookings/[id]/messages",
  smoke: "cli:llm-smoke",
};

export function llmRouteFor(task: string): string {
  return LLM_TASK_ROUTE[task] ?? "other";
}

export const llmTokensTotal = counter("llm_tokens_total", "LLM token kullanımı", [
  "route",
  "task",
  "kind",
] as const);
