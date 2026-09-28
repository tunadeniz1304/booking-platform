/* global __ENV */
/**
 * v5 P0-6 — Postgres kaosu (Toxiproxy): rezervasyon + ödeme + sepet yükü altında Postgres'e
 * gecikme, ardından bağlantı kopması (proxy kapalı → havuzdaki tüm bağlantılar kesilir, yeni
 * bağlantılar reddedilir), sonra `reset_peer` (her bağlantı RESET_AFTER_MS sonra RST).
 *
 * Zaman çizelgesi (saniye):
 *   0–LAT_FROM            baseline
 *   LAT_FROM–LAT_TO       latency: PG_LATENCY_MS ± PG_JITTER_MS
 *   DOWN_FROM–DOWN_TO     outage: Postgres proxy'si kapalı (bağlantı kopması)
 *   RESET_FROM–RESET_TO   reset: yeni/uzun bağlantılar RESET_AFTER_MS sonra RST
 *   sonrası (+GRACE)      recovery
 *
 * Beklenen: kopmada işlemler geri alınır (yarım yazım yok); yanıtlar 503/5xx olabilir ama
 * toparlanma sonrası pencere dışı 5xx = 0; `scripts/load-assert.ts` değişmezleri temiz.
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
const LAT_TO = Number(__ENV.LAT_TO_S || 35);
const DOWN_FROM = Number(__ENV.DOWN_FROM_S || 40);
const DOWN_TO = Number(__ENV.DOWN_TO_S || 48);
const RESET_FROM = Number(__ENV.RESET_FROM_S || 55);
const RESET_TO = Number(__ENV.RESET_TO_S || 65);
const TOTAL = Number(__ENV.TOTAL_S || 95);
const GRACE = Number(__ENV.GRACE_S || 10);
const VUS = Number(__ENV.VUS || 30);

const WINDOWS = [
  { name: "latency", from: LAT_FROM, to: LAT_TO },
  { name: "outage", from: DOWN_FROM, to: DOWN_TO },
  { name: "reset", from: RESET_FROM, to: RESET_TO },
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
        toxicAdd("postgres", "pg_latency", "latency", {
          latency: Number(__ENV.PG_LATENCY_MS || 100),
          jitter: Number(__ENV.PG_JITTER_MS || 50),
        }),
    },
    { at: LAT_TO, run: () => toxicRemove("postgres", "pg_latency") },
    { at: DOWN_FROM, run: () => proxyEnabled("postgres", false) },
    { at: DOWN_TO, run: () => proxyEnabled("postgres", true) },
    {
      at: RESET_FROM,
      run: () =>
        toxicAdd("postgres", "pg_reset", "reset_peer", {
          timeout: Number(__ENV.RESET_AFTER_MS || 2000),
        }),
    },
    { at: RESET_TO, run: () => toxicRemove("postgres", "pg_reset") },
  ]);
}

export function teardown() {
  toxiReset();
}
