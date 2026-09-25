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

// Test mülkleri `country: "TEST"` kullanır; varsayılan TR kuralları eşleşmez. Tutar
// beklentileri sabit kalsın diye tüm ülkelere %1 hariç konaklama vergisi (P0-4 motoru).
process.env.TAX_RULES_JSON ??= JSON.stringify([
  {
    code: "ACCOMMODATION_TAX",
    country: "*",
    kind: "ACCOMMODATION",
    label: "Konaklama vergisi",
    rateBps: 100,
  },
]);
