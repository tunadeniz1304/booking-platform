import { describe, expect, it } from "vitest";
import { counter, registry } from "@/lib/observability/metrics";
import {
  PRIMED_COUNTER_SERIES,
  REQUIRED_SERIES,
  primeBusinessMetrics,
} from "@/lib/observability/business-metrics";
import { LLM_TASK_ROUTE, llmRouteFor } from "@/lib/llm/metrics";

describe("P0-6 iş metrikleri", () => {
  it("önceden oluşturma kayıtlı sayaca 0 değerli seriler ekler, değeri değiştirmez", async () => {
    const c = counter("ledger_imbalance_total", "test", ["source"] as const);
    c.inc({ source: "db" }, 2);
    primeBusinessMetrics();
    primeBusinessMetrics();
    const values = (await c.get()).values;
    const bySource = Object.fromEntries(values.map((v) => [v.labels.source, v.value]));
    expect(bySource).toMatchObject({ app: 0, db: 2, reconciliation: 0 });
  });

  it("kayıtta olmayan metrik atlanır; etiket kümesi uyuşmazsa fırlatmaz", () => {
    counter("refund_retry_total", "test", ["other"] as const);
    expect(() => primeBusinessMetrics()).not.toThrow();
    expect(registry.getSingleMetric("takedown_sla_breach_total")).toBeUndefined();
  });

  it("katalogdaki önceden oluşturulan her sayaç zorunlu listede ya da bilinen bir seri", () => {
    for (const name of Object.keys(PRIMED_COUNTER_SERIES)) expect(name).toMatch(/_total$/);
    expect(REQUIRED_SERIES).toContain("llm_tokens_total");
  });

  it("LLM görevleri API rotasına eşlenir; bilinmeyen → other", () => {
    expect(llmRouteFor("smart_filter")).toBe("/api/search/smart");
    expect(llmRouteFor("listing_compare")).toBe("/api/compare");
    expect(llmRouteFor("yok")).toBe("other");
    expect(Object.values(LLM_TASK_ROUTE).every((r) => r.length > 0)).toBe(true);
  });
});
