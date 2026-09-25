import { Counter, Histogram, Registry, collectDefaultMetrics } from "prom-client";

/**
 * Prometheus metrik kaydı (tek süreç-içi registry).
 *
 * Next dev hot-reload'unda modül yeniden değerlendirilse bile registry ve
 * metrikler `globalThis` üzerinde tekil kalır (çift kayıt hatası olmaz).
 */
const globalForMetrics = globalThis as unknown as { __bookingMetricsRegistry?: Registry };

function createRegistry(): Registry {
  const registry = new Registry();
  if (process.env.NODE_ENV !== "test" && !process.env.VITEST) {
    collectDefaultMetrics({ register: registry });
  }
  return registry;
}

export const registry: Registry = globalForMetrics.__bookingMetricsRegistry ?? createRegistry();
globalForMetrics.__bookingMetricsRegistry = registry;

export function counter<L extends string>(
  name: string,
  help: string,
  labelNames: readonly L[] = []
): Counter<L> {
  const existing = registry.getSingleMetric(name);
  if (existing) return existing as Counter<L>;
  return new Counter<L>({ name, help, labelNames, registers: [registry] });
}

export function histogram<L extends string>(
  name: string,
  help: string,
  labelNames: readonly L[] = [],
  buckets?: number[]
): Histogram<L> {
  const existing = registry.getSingleMetric(name);
  if (existing) return existing as Histogram<L>;
  return new Histogram<L>({ name, help, labelNames, buckets, registers: [registry] });
}
