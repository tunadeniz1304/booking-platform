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

declare module "vitest" {
  export interface ProvidedContext {
    integrationDatabaseUrl: string;
    integrationRedisUrl: string;
    integrationSkipReason: string;
  }
}

let pg: StartedPostgreSqlContainer | undefined;
let redis: StartedRedisContainer | undefined;

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

    // connect_timeout: Prisma varsayılanı 5 sn. Makine yükü altında (paralel ajan
    // konteynerleri, Docker Desktop port yönlendirmesi) yeni bağlantının TCP + SCRAM el
    // sıkışması 5 sn'yi aşıp P1001 "Can't reach database server" üretiyordu — 100 paralel
    // isteğin havuzu doldurduğu anda ya da dosyanın ilk sorgusunda (~5 sn'de düşen testler).
    // pool_timeout: 100 paralel istek 20 bağlantıyı beklerken yük altında 30 sn sınırdaydı.
    // İkisi de yalnızca bekleme üst sınırıdır; iş mantığını/yarışları değiştirmez.
    const databaseUrl = `${pg.getConnectionUri()}?connection_limit=20&pool_timeout=60&connect_timeout=30`;
    const redisUrl = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;

    execFileSync(
      process.execPath,
      [path.resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"],
      { env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "pipe" }
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
    await Promise.allSettled([pg?.stop(), redis?.stop()]);
  };
}
