/* global __ENV, __VU, __ITER */
/**
 * k6 arama yük testi — GET /api/search, sabit varış hızı (constant-arrival-rate).
 *
 * Her iterasyon destinasyon, tarih aralığı, misafir sayısı ve sıralamayı döndürür;
 * böylece Redis arama önbelleği hem isabet hem ıska görür. API yanıtı önbellek
 * isabetini güvenilir biçimde bildirmediği için (`cached` alanı her zaman false,
 * başlık yok) gecikme "tarihli" ve "tarihsiz" sorgular olarak iki Trend'e ayrılır.
 *
 * Kullanım (tek dosya, stdin):
 *   docker run --rm -i --network <proj>_default -e BASE_URL=http://app:3000 \
 *     grafana/k6 run - < load/search.js
 *
 * Ortam değişkenleri (hepsi opsiyonel):
 *   BASE_URL        hedef (varsayılan http://localhost:3000)
 *   RATE            saniyedeki istek (varsayılan 50)
 *   DURATION        süre (varsayılan 1m)
 *   PRE_VUS/MAX_VUS VU havuzu (varsayılan 20/200)
 *   DAY_OFFSET      ilk check-in için bugünden gün farkı (varsayılan 30)
 *   DATE_SPREAD     tarih çeşitliliği, gün (varsayılan 60)
 *   DATED_RATIO     tarihli sorgu oranı 0..1 (varsayılan 0.5)
 *   PAGE_SIZE       sayfa boyutu (varsayılan 20, en fazla 50)
 *   P95_MS          p95 eşiği ms (varsayılan 500)
 *   MAX_ERROR_RATE  hata oranı eşiği (varsayılan 0.01)
 *
 * Önkoşul: uygulamada RATE_LIMIT_SEARCH_MAX yükseltilmiş olmalı (tüm istekler
 * k6 konteynerinin tek IP'sinden gelir; varsayılan 60/dk hemen 429 üretir).
 */
import http from "k6/http";
import { check } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

const BASE = __ENV.BASE_URL || "http://localhost:3000";
const RATE = Number(__ENV.RATE || 50);
const DURATION = __ENV.DURATION || "1m";
const PRE_VUS = Number(__ENV.PRE_VUS || 20);
const MAX_VUS = Number(__ENV.MAX_VUS || 200);
const DAY_OFFSET = Number(__ENV.DAY_OFFSET || 30);
const DATE_SPREAD = Math.max(1, Number(__ENV.DATE_SPREAD || 60));
const DATED_RATIO = Number(__ENV.DATED_RATIO || 0.5);
const PAGE_SIZE = Math.min(50, Number(__ENV.PAGE_SIZE || 20));
const P95_MS = Number(__ENV.P95_MS || 500);
const MAX_ERROR_RATE = Number(__ENV.MAX_ERROR_RATE || 0.01);

const DESTINATIONS = [
  "İstanbul",
  "Antalya",
  "İzmir",
  "Bodrum",
  "Kapadokya",
  "Ankara",
  "Alanya",
  "Çeşme",
  "Kuşadası",
  "Trabzon",
  "Muğla",
  "Paris",
  "Roma",
  "Londra",
  "Amsterdam",
  "Barselona",
  "Viyana",
  "Dubai",
  "Tokyo",
  "New York",
];
const SORTS = ["recommended", "price_asc", "price_desc", "rating"];

const searchErrors = new Rate("search_errors");
const datedLatency = new Trend("search_dated_duration", true);
const undatedLatency = new Trend("search_undated_duration", true);
const status429 = new Counter("search_status_429");
const status5xx = new Counter("search_status_5xx");

export const options = {
  scenarios: {
    search: {
      executor: "constant-arrival-rate",
      rate: RATE,
      timeUnit: "1s",
      duration: DURATION,
      preAllocatedVUs: PRE_VUS,
      maxVUs: MAX_VUS,
    },
  },
  thresholds: {
    http_req_duration: [`p(95)<${P95_MS}`],
    search_errors: [`rate<${MAX_ERROR_RATE}`],
    search_status_5xx: ["count==0"],
  },
};

function isoDay(offset) {
  return new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
}

export default function iteration() {
  const seed = __VU * 7919 + __ITER;
  const destination = DESTINATIONS[seed % DESTINATIONS.length];
  const guests = 1 + (seed % 4);
  const sort = SORTS[seed % SORTS.length];
  const dated = Math.random() < DATED_RATIO;

  let url =
    `${BASE}/api/search?destination=${encodeURIComponent(destination)}` +
    `&guests=${guests}&sort=${sort}&pageSize=${PAGE_SIZE}`;
  if (dated) {
    const start = DAY_OFFSET + (seed % DATE_SPREAD);
    const nights = 1 + (seed % 5);
    url += `&checkIn=${isoDay(start)}&checkOut=${isoDay(start + nights)}`;
  }

  const res = http.get(url, { tags: { name: dated ? "search_dated" : "search_undated" } });
  const ok = check(res, {
    "status 200": (r) => r.status === 200,
    "results dizisi": (r) => {
      try {
        return Array.isArray(r.json("results"));
      } catch {
        return false;
      }
    },
  });
  searchErrors.add(!ok);
  if (res.status === 429) status429.add(1);
  if (res.status >= 500) status5xx.add(1);
  (dated ? datedLatency : undatedLatency).add(res.timings.duration);
}
