import { counter, histogram } from "@/lib/observability/metrics";

/** v5 P1-4: destek ajanı metrikleri (LLM modülü içe aktarmaz → /api/metrics güvenle yükler). */
export const supportHandoffTotal = counter(
  "support_handoff_total",
  "Destek ajanının insana devrettiği konuşmalar (neden bazında)",
  ["reason"] as const
);
export const supportChatTotal = counter(
  "support_chat_total",
  "Destek ajanı konuşma turları (niyet + sonuç)",
  ["intent", "outcome"] as const
);
export const supportChatLatencySeconds = histogram(
  "support_chat_latency_seconds",
  "Destek ajanı yanıt süresi (saniye)",
  ["outcome"] as const,
  [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 20]
);
