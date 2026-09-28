/* global __ENV */
/**
 * v5 P0-6 — Redis kaosu (Toxiproxy): rezervasyon + ödeme + sepet yükü altında Redis'e
 * gecikme, ardından tam kesinti (proxy kapalı → açık bağlantılar kesilir, yenileri reddedilir).
 *
 * Zaman çizelgesi (saniye; `*_S` ortam değişkenleriyle değişir):
 *   0–LAT_FROM            baseline
 *   LAT_FROM–LAT_TO       latency: Redis yanıtlarına REDIS_LATENCY_MS ± REDIS_JITTER_MS
 *   DOWN_FROM–DOWN_TO     outage: Redis proxy'si kapalı
 *   DOWN_TO+GRACE–sonu    recovery
 *
 * Beklenen: kesintide hassas uçlar 503 (fail-closed: rate-limit / denylist / Redlock → 409
 * ROOM_BUSY), 500 yok; kesinti bitince GRACE içinde toparlanma (pencere dışı 5xx = 0);
 * sonrasında `scripts/load-assert.ts` değişmezleri (aşırı satış 0, Σ=0, mutabakat farkı 0).
 *
 *   docker run --rm -v <repo>/load:/load --network booking-load_default \
 *     -e LOAD_ROOMS=<seed-load çıktısı> grafana/k6 run /load/chaos-redis.js
 */
import {
  chaosSetup,
  chaosThresholds,
  proxyEnabled,
  runSchedule,
  toxicAdd,
  toxicRemove,
  toxiReset,
  workload,
} from "./chaos-lib.js";

const LAT_FROM = Number(__ENV.LAT_FROM_S || 20);
const LAT_TO = Number(__ENV.LAT_TO_S || 40);
const DOWN_FROM = Number(__ENV.DOWN_FROM_S || 45);
const DOWN_TO = Number(__ENV.DOWN_TO_S || 60);
const TOTAL = Number(__ENV.TOTAL_S || 90);
const GRACE = Number(__ENV.GRACE_S || 5);
const VUS = Number(__ENV.VUS || 30);

const WINDOWS = [
  { name: "latency", from: LAT_FROM, to: LAT_TO },
  { name: "outage", from: DOWN_FROM, to: DOWN_TO },
];

export const options = {
  setupTimeout: "120s",
  scenarios: {
    load: { executor: "constant-vus", vus: VUS, duration: `${TOTAL}s`, exec: "load" },
    chaos: { executor: "shared-iterations", vus: 1, iterations: 1, exec: "chaos" },
  },
  thresholds: chaosThresholds(WINDOWS),
};

export function setup() {
  return chaosSetup();
}

export function load(data) {
  workload(data, WINDOWS, GRACE);
}

export function chaos(data) {
  runSchedule(data.startedAt, [
    {
      at: LAT_FROM,
      run: () =>
        toxicAdd("redis", "redis_latency", "latency", {
          latency: Number(__ENV.REDIS_LATENCY_MS || 300),
          jitter: Number(__ENV.REDIS_JITTER_MS || 100),
        }),
    },
    { at: LAT_TO, run: () => toxicRemove("redis", "redis_latency") },
    { at: DOWN_FROM, run: () => proxyEnabled("redis", false) },
    { at: DOWN_TO, run: () => proxyEnabled("redis", true) },
  ]);
}

export function teardown() {
  toxiReset();
}
