/**
 * Her entegrasyon test dosyasından ÖNCE çalışır: container adreslerini
 * `process.env`'e yazar (Prisma/ioredis modülleri import anında okur).
 */
import { inject } from "vitest";

const skipReason = inject("integrationSkipReason");
if (skipReason) {
  process.env.INTEGRATION_SKIP_REASON = skipReason;
} else {
  process.env.DATABASE_URL = inject("integrationDatabaseUrl");
  process.env.REDIS_URL = inject("integrationRedisUrl");
}
