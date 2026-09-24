import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";

export interface ReadinessReport {
  ready: boolean;
  checks: Record<"database" | "redis", { ok: boolean; latencyMs: number }>;
}

async function timed(
  fn: () => Promise<unknown>,
  timeoutMs: number
): Promise<{ ok: boolean; latencyMs: number }> {
  const started = Date.now();
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs)),
    ]);
    return { ok: true, latencyMs: Date.now() - started };
  } catch {
    return { ok: false, latencyMs: Date.now() - started };
  }
}

/** DB (`SELECT 1`) ve Redis (`PING`) kontrolleri; hata ayrıntısı dışarı verilmez. */
export async function checkReadiness(timeoutMs = 2000): Promise<ReadinessReport> {
  const [database, cache] = await Promise.all([
    timed(() => prisma.$queryRaw`SELECT 1`, timeoutMs),
    timed(() => redis.ping(), timeoutMs),
  ]);
  return { ready: database.ok && cache.ok, checks: { database, redis: cache } };
}
