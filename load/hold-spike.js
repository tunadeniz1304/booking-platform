/* global __ENV */
/**
 * k6 HOLD sıçrama testi — POST /api/bookings, ramping-arrival-rate.
 *
 * booking-spike.js tek odaya yüklenirken bu senaryo yükü BİRÇOK mülk/oda/tarih
 * kombinasyonuna dağıtır: gerçekçi bir trafik patlamasında Redlock, DB kısıtları
 * ve rate limiter'ın 5xx üretmeden 201/409/429 ile yanıt verdiğini doğrular.
 *
 * Kullanım:
 *   docker run --rm -i --network <proj>_default -e BASE_URL=http://app:3000 \
 *     -e DAY_OFFSET=200 grafana/k6 run - < load/hold-spike.js
 *
 * Ortam değişkenleri (hepsi opsiyonel):
 *   BASE_URL           hedef (varsayılan http://localhost:3000)
 *   EMAIL / PASSWORD   misafir hesabı (varsayılan guest@booking.test / Password123!)
 *   DAY_OFFSET         ilk check-in için bugünden gün farkı (varsayılan 200;
 *                      her koşuda farklı değer verin, önceki HOLD'larla çakışmasın)
 *   DATE_SPREAD        tarih yayılımı, gün (varsayılan 30)
 *   NIGHTS             gece sayısı (varsayılan 2)
 *   DESTINATIONS       virgülle aday şehirler (varsayılan 6 şehir)
 *   PER_DEST           şehir başına mülk (varsayılan 5)
 *   MAX_ROOMS          aday oda üst sınırı (varsayılan 60)
 *   START_RATE         başlangıç hızı/sn (varsayılan 5)
 *   PEAK_RATE          tepe hızı/sn (varsayılan 100)
 *   RAMP / HOLD / COOL aşama süreleri (varsayılan 10s / 30s / 10s)
 *   PRE_VUS / MAX_VUS  VU havuzu (varsayılan 50 / 500)
 *   P95_MS             p95 eşiği ms (varsayılan 1000)
 *
 * Önkoşul: RATE_LIMIT_BOOKING_MAX, RATE_LIMIT_AUTH_MAX, RATE_LIMIT_SEARCH_MAX
 * yükseltilmiş olmalı; aksi halde çoğu yanıt 429 olur (bu da 5xx değildir, ama
 * ölçüm anlamsızlaşır). Access token ömrü kısa (~5 dk) — toplam süreyi kısa tutun.
 */
import http from "k6/http";
import { check } from "k6";
import { Counter, Trend } from "k6/metrics";

const BASE = __ENV.BASE_URL || "http://localhost:3000";
const EMAIL = __ENV.EMAIL || "guest@booking.test";
const loginPassword = __ENV.PASSWORD || "Password123!"; // seed demo parolası (README)
const DAY_OFFSET = Number(__ENV.DAY_OFFSET || 200);
const DATE_SPREAD = Math.max(1, Number(__ENV.DATE_SPREAD || 30));
const NIGHTS = Math.max(1, Number(__ENV.NIGHTS || 2));
const DESTINATIONS = (__ENV.DESTINATIONS || "İstanbul,Antalya,İzmir,Bodrum,Paris,Roma")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const PER_DEST = Math.min(50, Number(__ENV.PER_DEST || 5));
const MAX_ROOMS = Number(__ENV.MAX_ROOMS || 60);
const START_RATE = Number(__ENV.START_RATE || 5);
const PEAK_RATE = Number(__ENV.PEAK_RATE || 100);
const RAMP = __ENV.RAMP || "10s";
const HOLD = __ENV.HOLD || "30s";
const COOL = __ENV.COOL || "10s";
const PRE_VUS = Number(__ENV.PRE_VUS || 50);
const MAX_VUS = Number(__ENV.MAX_VUS || 500);
const P95_MS = Number(__ENV.P95_MS || 1000);

const created = new Counter("hold_201");
const conflict = new Counter("hold_409");
const limited = new Counter("hold_429");
const serverErrors = new Counter("hold_5xx");
const other = new Counter("hold_other");
const holdLatency = new Trend("hold_duration", true);

export const options = {
  scenarios: {
    spike: {
      executor: "ramping-arrival-rate",
      startRate: START_RATE,
      timeUnit: "1s",
      preAllocatedVUs: PRE_VUS,
      maxVUs: MAX_VUS,
      stages: [
        { target: PEAK_RATE, duration: RAMP },
        { target: PEAK_RATE, duration: HOLD },
        { target: 0, duration: COOL },
      ],
    },
  },
  thresholds: {
    hold_5xx: ["count==0"],
    "http_req_duration{name:hold}": [`p(95)<${P95_MS}`],
  },
};

function isoDay(offset) {
  return new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
}

export function setup() {
  const login = http.post(
    `${BASE}/api/auth/login`,
    JSON.stringify({ email: EMAIL, password: loginPassword }),
    { headers: { "content-type": "application/json" } }
  );
  if (login.status !== 200) throw new Error(`login başarısız: ${login.status}`);
  const token = login.json("accessToken");

  const rooms = [];
  for (const dest of DESTINATIONS) {
    const s = http.get(
      `${BASE}/api/search?destination=${encodeURIComponent(dest)}&pageSize=${PER_DEST}`
    );
    if (s.status !== 200) continue;
    for (const p of s.json("results") || []) {
      if (rooms.length >= MAX_ROOMS) break;
      const d = http.get(`${BASE}/api/properties/${p.id}`);
      if (d.status !== 200) continue;
      for (const r of d.json("rooms") || []) {
        if (rooms.length >= MAX_ROOMS) break;
        rooms.push({ propertyId: p.id, roomId: r.id });
      }
    }
  }
  if (rooms.length === 0) throw new Error("aday oda bulunamadı (seed yüklü mü?)");
  console.log(`hold-spike: ${rooms.length} aday oda, DAY_OFFSET=${DAY_OFFSET}`);
  return { token, rooms };
}

export default function iteration(data) {
  const room = data.rooms[Math.floor(Math.random() * data.rooms.length)];
  const start = DAY_OFFSET + Math.floor(Math.random() * DATE_SPREAD);
  const res = http.post(
    `${BASE}/api/bookings`,
    JSON.stringify({
      propertyId: room.propertyId,
      roomId: room.roomId,
      checkIn: isoDay(start),
      checkOut: isoDay(start + NIGHTS),
      guestCount: 1,
    }),
    {
      headers: { "content-type": "application/json", authorization: `Bearer ${data.token}` },
      tags: { name: "hold" },
    }
  );
  holdLatency.add(res.timings.duration);
  if (res.status === 201) created.add(1);
  else if (res.status === 409) conflict.add(1);
  else if (res.status === 429) limited.add(1);
  else if (res.status >= 500) serverErrors.add(1);
  else other.add(1);
  check(res, {
    "201/409/429 (5xx yok)": (r) => r.status === 201 || r.status === 409 || r.status === 429,
  });
}
