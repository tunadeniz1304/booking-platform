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

// Redis komut zaman aşımı (üretim varsayılanı 1 sn): testcontainers Redis'i Docker Desktop
// port yönlendirmesi arkasında ve makine yükü altında 1 sn'yi aşabiliyor. Redlock
// edinimindeki `SET NX` istemcide zaman aşımına düşse de sunucuda uygulanır; kilit kendi
// token'ımızla TTL (15 sn) boyunca tutulur ve tek istek bile ROOM_BUSY alır (v3-stripe /
// v4-booking-idempotency flake'i). Üretim kusuru olarak raporlandı (progress
// `## test-stabilization`); burada yalnızca bekleme sınırı gevşetilir.
process.env.REDIS_COMMAND_TIMEOUT_MS ??= "10000";

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
