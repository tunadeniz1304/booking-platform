/**
 * Entegrasyon testleri için gerçek altyapı (testcontainers):
 *  - `pgvector/pgvector:pg16` (Prisma migration'ları uygulanır)
 *  - `redis:7-alpine`
 *
 * Testler ASLA geliştiricinin `DATABASE_URL`'ine yazmaz; bağlantı adresleri
 * `provide()` ile test işçilerine aktarılır. Docker yoksa suite açık bir
 * mesajla atlanır (`INTEGRATION_SKIP_REASON`) — yalnızca yerelde; `CI` ortamında
 * suite başarısız olur.
 */
import { execFileSync } from "child_process";
import path from "path";
import type { TestProject } from "vitest/node";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { StartedRedisContainer } from "@testcontainers/redis";
import { startRetryProxy, type RetryProxy } from "./tcp-retry-proxy";

declare module "vitest" {
  export interface ProvidedContext {
    integrationDatabaseUrl: string;
    integrationRedisUrl: string;
    integrationSkipReason: string;
  }
}

let pg: StartedPostgreSqlContainer | undefined;
let redis: StartedRedisContainer | undefined;
const proxies: RetryProxy[] = [];

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  try {
    const { PostgreSqlContainer } = await import("@testcontainers/postgresql");
    const { RedisContainer } = await import("@testcontainers/redis");

    [pg, redis] = await Promise.all([
      new PostgreSqlContainer("pgvector/pgvector:pg16")
        .withDatabase("booking_test")
        .withUsername("booking")
        .withPassword("booking")
        // Her test dosyası kendi PrismaClient havuzunu açar; varsayılan 100 bağlantı
        // uzun koşularda tükenip "Can't reach database server" hatasına yol açıyordu.
        .withCommand(["postgres", "-c", "max_connections=500"])
        .start(),
      new RedisContainer("redis:7-alpine").start(),
    ]);

    // Postgres ve Redis'e Docker Desktop port yönlendiricisi yerine yerel yeniden-deneyen
    // vekil üzerinden bağlanılır (yük altında asılı kalan yeni bağlantılar, bkz.
    // tcp-retry-proxy.ts). connect_timeout: vekilin el sıkışma denemelerine süre tanır
    // (Prisma varsayılanı 5 sn). pool_timeout: 100 paralel istek 20 bağlantıyı beklerken yük
    // altında 30 sn sınırdaydı. Hepsi bekleme üst sınırıdır; iş mantığını/yarışları değiştirmez.
    // `migrate deploy` doğrudan porta gider (tek bağlantı, vekilden önce).
    const directDatabaseUrl = `${pg.getConnectionUri()}?connection_limit=20&pool_timeout=60&connect_timeout=60`;
    const pgProxy = await startRetryProxy({ host: pg.getHost(), port: pg.getMappedPort(5432) });
    const redisProxy = await startRetryProxy({
      host: redis.getHost(),
      port: redis.getMappedPort(6379),
    });
    proxies.push(pgProxy, redisProxy);
    const databaseUrl = directDatabaseUrl.replace(
      `@${pg.getHost()}:${pg.getMappedPort(5432)}/`,
      `@127.0.0.1:${pgProxy.port}/`
    );
    if (databaseUrl === directDatabaseUrl)
      throw new Error("vekil adresi DATABASE_URL'e yazılamadı");
    const redisUrl = `redis://127.0.0.1:${redisProxy.port}`;

    execFileSync(
      process.execPath,
      [path.resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"],
      { env: { ...process.env, DATABASE_URL: directDatabaseUrl }, stdio: "pipe" }
    );

    project.provide("integrationDatabaseUrl", databaseUrl);
    project.provide("integrationRedisUrl", redisUrl);
    project.provide("integrationSkipReason", "");
  } catch (error) {
    const reason = `Docker/testcontainers kullanılamıyor: ${(error as Error).message.split("\n")[0]}`;
    // CI'da sessiz atlama yok: entegrasyon testleri koşmadıysa kapı kırmızıdır.
    if (process.env.CI && !process.env.INTEGRATION_ALLOW_SKIP) {
      throw new Error(`[integration] CI ortamında Docker zorunlu — ${reason}`);
    }
    console.warn(`[integration] SKIPPED — ${reason}`);
    project.provide("integrationDatabaseUrl", "");
    project.provide("integrationRedisUrl", "");
    project.provide("integrationSkipReason", reason);
  }

  return async () => {
    for (const [name, proxy] of [
      ["postgres", proxies[0]],
      ["redis", proxies[1]],
    ] as const) {
      if (proxy && (proxy.stats.retries > 0 || proxy.stats.gaveUp > 0)) {
        console.warn(
          `[integration] ${name} vekili: ${proxy.stats.connections} bağlantı, ` +
            `${proxy.stats.retries} el sıkışma yeniden denemesi, ${proxy.stats.gaveUp} vazgeçilen`
        );
      }
    }
    await Promise.allSettled(proxies.map((p) => p.close()));
    await Promise.allSettled([pg?.stop(), redis?.stop()]);
  };
}
