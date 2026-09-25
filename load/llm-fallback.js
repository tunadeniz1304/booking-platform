/* global __ENV, __VU, __ITER */
/**
 * k6 LLM fallback ölçümü — POST /api/search/smart, yanıttaki `llmMode` sayılır.
 *
 * Yanıt her durumda 200 döner; `llmMode` = live | demo | fallback, `reason` fallback
 * nedeni (timeout, network, upstream_5xx, rate_limited, budget, ...). Bu script
 * fallback oranını ve fallback yolunun gecikmesini ölçer. LLM zaman aşımı senaryosu
 * için uygulamayı load/chaos.md (b) bölümündeki env değerleriyle yeniden başlatın.
 *
 * Kullanım:
 *   docker run --rm -i --network <proj>_default -e BASE_URL=http://app:3000 \
 *     -e EXPECT=fallback grafana/k6 run - < load/llm-fallback.js
 *
 * Ortam değişkenleri (hepsi opsiyonel):
 *   BASE_URL        hedef (varsayılan http://localhost:3000)
 *   RATE            saniyedeki istek (varsayılan 5)
 *   DURATION        süre (varsayılan 1m)
 *   PRE_VUS/MAX_VUS VU havuzu (varsayılan 10/100)
 *   EXPECT          beklenen mod: fallback | live | demo | any (varsayılan any)
 *   MIN_EXPECT_RATE EXPECT modunun asgari oranı (varsayılan 0.99)
 *   P95_MS          p95 eşiği ms (varsayılan 3000 — LLM_TIMEOUT_SECONDS=1 için)
 *
 * Önkoşul: RATE_LIMIT_AI_MAX yükseltilmeli (varsayılan 20/dk).
 */
import http from "k6/http";
import { check } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

const BASE = __ENV.BASE_URL || "http://localhost:3000";
const RATE = Number(__ENV.RATE || 5);
const DURATION = __ENV.DURATION || "1m";
const PRE_VUS = Number(__ENV.PRE_VUS || 10);
const MAX_VUS = Number(__ENV.MAX_VUS || 100);
const EXPECT = (__ENV.EXPECT || "any").toLowerCase();
const MIN_EXPECT_RATE = Number(__ENV.MIN_EXPECT_RATE || 0.99);
const P95_MS = Number(__ENV.P95_MS || 3000);

const QUERIES = [
  "İstanbul'da deniz manzaralı 2 kişilik otel",
  "Antalya'da havuzlu villa, 4 kişi, gecelik 5000 TL altı",
  "Kapadokya'da balon manzaralı butik otel",
  "Paris'te merkeze yakın ucuz daire",
  "Bodrum'da aileyle kalınacak kahvaltı dahil otel",
  "İzmir Çeşme'de sahile yürüme mesafesinde pansiyon",
  "Roma'da wifi ve klimalı 3 kişilik oda",
  "Londra'da en yüksek puanlı otel",
];

const modeLive = new Counter("llm_mode_live");
const modeDemo = new Counter("llm_mode_demo");
const modeFallback = new Counter("llm_mode_fallback");
const modeOther = new Counter("llm_mode_other");
const fallbackRate = new Rate("llm_fallback_rate");
const expectRate = new Rate("llm_expected_mode_rate");
const fallbackLatency = new Trend("llm_fallback_duration", true);
const smart5xx = new Counter("smart_5xx");

const thresholds = {
  smart_5xx: ["count==0"],
  "http_req_duration{name:smart}": [`p(95)<${P95_MS}`],
};
if (EXPECT !== "any") thresholds.llm_expected_mode_rate = [`rate>=${MIN_EXPECT_RATE}`];

export const options = {
  scenarios: {
    smart: {
      executor: "constant-arrival-rate",
      rate: RATE,
      timeUnit: "1s",
      duration: DURATION,
      preAllocatedVUs: PRE_VUS,
      maxVUs: MAX_VUS,
    },
  },
  thresholds,
};

export default function iteration() {
  const text = QUERIES[(__VU * 31 + __ITER) % QUERIES.length];
  const res = http.post(`${BASE}/api/search/smart`, JSON.stringify({ text }), {
    headers: { "content-type": "application/json" },
    tags: { name: "smart" },
  });
  if (res.status >= 500) smart5xx.add(1);
  check(res, { "status 200": (r) => r.status === 200 });
  if (res.status !== 200) return;

  let mode = "";
  let reason = "";
  try {
    mode = String(res.json("llmMode") || "");
    reason = String(res.json("reason") || "");
  } catch {
    mode = "";
  }
  if (mode === "live") modeLive.add(1);
  else if (mode === "demo") modeDemo.add(1);
  else if (mode === "fallback") modeFallback.add(1, { reason: reason || "unknown" });
  else modeOther.add(1);

  fallbackRate.add(mode === "fallback");
  if (mode === "fallback") fallbackLatency.add(res.timings.duration);
  if (EXPECT !== "any") expectRate.add(mode === EXPECT);
}
