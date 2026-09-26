import { PrismaClient } from "@prisma/client";
import { installQueryStats, isQueryStatsEnabled } from "@/lib/observability/stats";
// BigInt minor-unit kolonları için JSON güvenlik ağını kurar (ADR 0019).
import "@/lib/money/money";

const globalForPrisma = globalThis as unknown as { __bookingPrisma?: PrismaClient };

/**
 * Tekil Prisma istemcisi — TEMBEL oluşturulur: modül import edildiğinde değil,
 * ilk sorguda `DATABASE_URL` okunur. Böylece `next build` (ve Docker build) sırasında
 * veritabanı adresi/sırrı gerekmez ve imaja gömülmez.
 *
 * Bağlantı havuzu `DATABASE_URL`'deki `connection_limit` / `pool_timeout` ile sınırlanır.
 * Sorgu profil'leyicisi yalnızca `ENABLE_QUERY_STATS=true` iken kurulur.
 */
function getPrismaClient(): PrismaClient {
  if (globalForPrisma.__bookingPrisma) return globalForPrisma.__bookingPrisma;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL environment variable is required");
  }
  const statsEnabled = isQueryStatsEnabled();
  const client = new PrismaClient({
    datasources: { db: { url } },
    log: statsEnabled
      ? [
          { emit: "event", level: "query" },
          { emit: "stdout", level: "warn" },
          { emit: "stdout", level: "error" },
        ]
      : [{ emit: "stdout", level: "error" }],
  });
  if (statsEnabled) {
    installQueryStats(client as unknown as Parameters<typeof installQueryStats>[0]);
  }
  globalForPrisma.__bookingPrisma = client;
  return client;
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getPrismaClient();
    const value = Reflect.get(client, property, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
