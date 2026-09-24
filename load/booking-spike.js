/**
 * k6 yük testi (P2-3): `k6 run load/booking-spike.js` (BASE_URL varsayılan http://localhost:3000)
 *
 * Senaryo 1 — race: 200 sanal kullanıcı AYNI odanın AYNI gecesi için eşzamanlı
 *   rezervasyon dener. Beklenen: tam 1 × 201, geri kalanı 409 SOLD_OUT/ROOM_BUSY;
 *   overbooking = 0 (ayrıca SQL ile doğrulanır, bkz. docs/perf/k6-results.md).
 * Senaryo 2 — search: önbellekli arama p95 < 500 ms.
 *
 * Ortam: BASE_URL, DAY_OFFSET (yarışılan gece, bugünden gün), USER_EMAIL/USER_PASSWORD.
 * Önkoşul: demo seed yüklü; RATE_LIMIT_BOOKING_MAX ve RATE_LIMIT_AUTH_MAX yük testi
 * için yükseltilmiş olmalı (aksi hâlde rate-limit 429 döndürür — bu da doğru davranıştır).
 */
import http from "k6/http";
import { check } from "k6";
import { Counter } from "k6/metrics";

const BASE = __ENV.BASE_URL || "http://localhost:3000";
const created = new Counter("bookings_created");
const soldOut = new Counter("bookings_sold_out");

export const options = {
  scenarios: {
    race: {
      executor: "per-vu-iterations",
      vus: 200,
      iterations: 1,
      exec: "race",
      maxDuration: "2m",
    },
    search: {
      executor: "constant-arrival-rate",
      rate: 50,
      timeUnit: "1s",
      duration: "30s",
      preAllocatedVUs: 50,
      exec: "search",
      startTime: "5s",
    },
  },
  thresholds: {
    "http_req_duration{scenario:search}": ["p(95)<500"],
    bookings_created: ["count<=1"],
  },
};

export function setup() {
  const login = http.post(
    `${BASE}/api/auth/login`,
    JSON.stringify({
      email: __ENV.USER_EMAIL || "guest@booking.test",
      password: __ENV.USER_PASSWORD || "Password123!",
    }),
    { headers: { "content-type": "application/json" } }
  );
  const token = login.json("accessToken");
  const search = http.get(
    `${BASE}/api/search?destination=${encodeURIComponent("İstanbul")}&pageSize=1`
  );
  const property = search.json("results.0");
  const detail = http.get(`${BASE}/api/properties/${property.id}`).json();
  // Her koşum için farklı bir gece seçilebilir (varsayılan: 200 gün sonrası).
  const offset = Number(__ENV.DAY_OFFSET || 200);
  const d = new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
  const d2 = new Date(Date.now() + (offset + 1) * 86400000).toISOString().slice(0, 10);
  return { token, propertyId: property.id, roomId: detail.rooms[0].id, checkIn: d, checkOut: d2 };
}

export function race(ctx) {
  const res = http.post(
    `${BASE}/api/bookings`,
    JSON.stringify({
      propertyId: ctx.propertyId,
      roomId: ctx.roomId,
      checkIn: ctx.checkIn,
      checkOut: ctx.checkOut,
      guestCount: 1,
    }),
    { headers: { "content-type": "application/json", authorization: `Bearer ${ctx.token}` } }
  );
  if (res.status === 201) created.add(1);
  if (res.status === 409) soldOut.add(1);
  check(res, { "201 veya 409/429": (r) => [201, 409, 429].includes(r.status) });
}

export function search() {
  const res = http.get(
    `${BASE}/api/search?destination=${encodeURIComponent("İstanbul")}&page=1&pageSize=12`
  );
  check(res, { "arama 200": (r) => r.status === 200 });
}
