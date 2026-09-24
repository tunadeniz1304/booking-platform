import { histogram } from "./metrics";

/**
 * DB sorgu profil'leyicisi — Prisma `$on("query")` dinleyicisiyle canlı metrikler.
 *
 * VARSAYILAN KAPALI: yalnızca `ENABLE_QUERY_STATS=true` iken kurulur (production'da
 * açıkça istenmelidir; her sorguda ek iş yapar). N+1 / yavaş sorgu tespiti için
 * model bazlı sayaç ve ortalama süre toplar; `GET /api/internal/stats` anlık görüntüyü
 * döndürür, ayrıca `db_query_duration_seconds` Prometheus histogramı beslenir.
 *
 * Durum ve "kuruldu" işareti `globalThis` üzerindedir: Next dev hot-reload'unda
 * modül yeniden değerlendirilse bile dinleyici ikinci kez eklenmez (çift sayım olmaz).
 */

interface RawQueryEvent {
  query: string;
  duration: number;
}

interface QueryStatsState {
  totalQueries: number;
  totalQueryMs: number;
  slowQueries: number;
  queriesByModel: Record<string, number>;
  startedAt: number;
  installedOn: WeakSet<object>;
}

export const SLOW_QUERY_THRESHOLD_MS = 100;

const globalForStats = globalThis as unknown as { __bookingQueryStats?: QueryStatsState };

function state(): QueryStatsState {
  globalForStats.__bookingQueryStats ??= {
    totalQueries: 0,
    totalQueryMs: 0,
    slowQueries: 0,
    queriesByModel: {},
    startedAt: Date.now(),
    installedOn: new WeakSet(),
  };
  return globalForStats.__bookingQueryStats;
}

const queryDuration = histogram(
  "db_query_duration_seconds",
  "Prisma sorgu süresi (saniye), model bazında",
  ["model"] as const,
  [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5]
);

export function isQueryStatsEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env.ENABLE_QUERY_STATS === "true";
}

/** Sorgu metninden tablo/model adını çıkarır (`"public"."Booking"` → `Booking`). */
export function modelFromQuery(query: string): string {
  const m = /from\s+"\w+"\."(\w+)"/i.exec(query) ?? /from\s+"(\w+)"/i.exec(query);
  return m?.[1] ?? "other";
}

/** Tek bir sorgu olayını kaydeder (dinleyici ve testler için). */
export function recordQuery(event: RawQueryEvent): void {
  const s = state();
  const model = modelFromQuery(event.query);
  s.totalQueries += 1;
  s.totalQueryMs += event.duration;
  if (event.duration > SLOW_QUERY_THRESHOLD_MS) s.slowQueries += 1;
  s.queriesByModel[model] = (s.queriesByModel[model] ?? 0) + 1;
  queryDuration.observe({ model }, event.duration / 1000);
}

/** PrismaClient'ın sorgu olaylarına takılır; aynı istemciye en fazla bir kez. */
export function installQueryStats(prismaClient: {
  $on(event: "query", callback: (event: RawQueryEvent) => void): void;
}): boolean {
  const s = state();
  if (s.installedOn.has(prismaClient)) return false;
  s.installedOn.add(prismaClient);
  prismaClient.$on("query", recordQuery);
  return true;
}

export function getQueryStats(): {
  enabled: boolean;
  totalQueries: number;
  avgQueryMs: number;
  slowQueries: number;
  slowQueryRate: number;
  uptimeSeconds: number;
  queriesByModel: Record<string, number>;
  /** En çok sorgu çeken modeller (N+1 riski öncelik sırası). */
  topModels: Array<{ model: string; count: number }>;
} {
  const s = state();
  const totalQueries = s.totalQueries;
  return {
    enabled: isQueryStatsEnabled(),
    totalQueries,
    avgQueryMs: totalQueries > 0 ? Math.round((s.totalQueryMs / totalQueries) * 10) / 10 : 0,
    slowQueries: s.slowQueries,
    slowQueryRate: totalQueries > 0 ? Math.round((s.slowQueries / totalQueries) * 1000) / 1000 : 0,
    uptimeSeconds: Math.round((Date.now() - s.startedAt) / 1000),
    queriesByModel: { ...s.queriesByModel },
    topModels: Object.entries(s.queriesByModel)
      .map(([model, count]) => ({ model, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8),
  };
}

/** Yalnızca testler için. */
export function resetQueryStatsForTests(): void {
  globalForStats.__bookingQueryStats = undefined;
}
