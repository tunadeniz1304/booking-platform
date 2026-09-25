/* global __ENV, __VU */
/**
 * k6 ödeme yarışı testi — aynı rezervasyon için eşzamanlı POST /api/bookings/:id/pay.
 *
 * setup() N adet HELD rezervasyon oluşturur; her rezervasyona RACERS kadar VU aynı
 * anda (ortak başlangıç bariyeri) farklı Idempotency-Key ile ödeme gönderir. Beklenen:
 * her rezervasyonda en fazla BİR tahsilat; diğer yarışçılar 409 PAYMENT_IN_PROGRESS /
 * ALREADY_PAID ya da idempotent 200 "confirmed" alır. 202 (3DS) gelirse mock kodla
 * (123456) onaylanır. teardown() her rezervasyonu tekrar okur ve değişmezleri doğrular:
 *   - CONFIRMED ⇒ payment.status == PAID, payment.amount == totalPrice, refundedAmount == 0
 *   - (METRICS_TOKEN verilirse) payment_attempts_total{outcome="confirmed"} artışı
 *     CONFIRMED rezervasyon sayısını aşmamalı; fark double_charges'a eklenir.
 * Kesin kontrol ayrıca SQL ile yapılır (load/chaos.md ve aşağıdaki komut).
 *
 * Kullanım:
 *   docker run --rm -i --network <proj>_default -e BASE_URL=http://app:3000 \
 *     -e DAY_OFFSET=260 [-e METRICS_TOKEN] grafana/k6 run - < load/payment-race.js
 *
 * Ortam değişkenleri (hepsi opsiyonel):
 *   BASE_URL           hedef (varsayılan http://localhost:3000)
 *   EMAIL / PASSWORD   misafir hesabı (varsayılan guest@booking.test / Password123!)
 *   BOOKINGS           oluşturulacak HELD rezervasyon sayısı (varsayılan 20)
 *   RACERS             rezervasyon başına eşzamanlı ödeyici (varsayılan 3, en az 2)
 *   DAY_OFFSET         ilk check-in için gün farkı (varsayılan 260; her koşuda değiştirin)
 *   NIGHTS             gece sayısı (varsayılan 1)
 *   DESTINATION        aday mülk şehri (varsayılan İstanbul)
 *   START_DELAY_MS     setup sonrası ortak başlangıç gecikmesi (varsayılan 3000)
 *   SAME_KEY           "1" ise yarışçılar aynı Idempotency-Key'i paylaşır (varsayılan 0)
 *   METRICS_TOKEN      /api/metrics Bearer token'ı (opsiyonel; metrik farkı kontrolü)
 *
 * Kesin SQL doğrulaması (0 dönmeli):
 *   docker compose -p <proj> exec -T db psql -U booking -d booking -At -c \
 *     "SELECT count(*) FROM (SELECT \"bookingId\" FROM \"LedgerEntry\" WHERE kind='CHARGE' \
 *      GROUP BY \"bookingId\" HAVING count(*)>1) t"
 *
 * Önkoşul: RATE_LIMIT_BOOKING_MAX, RATE_LIMIT_AUTH_MAX, RATE_LIMIT_SEARCH_MAX yükseltilmeli;
 * FRAUD_VELOCITY_USER_MAX / _IP_MAX / _CARD_MAX yükseltilmeli (aksi halde tek kullanıcı/IP
 * hızı nedeniyle 3DS zorlanır ya da 403 FRAUD_BLOCKED gelir). PAYMENT_PROVIDER=mock.
 */
import http from "k6/http";
import { check, sleep } from "k6";
import { Counter } from "k6/metrics";

const BASE = __ENV.BASE_URL || "http://localhost:3000";
const EMAIL = __ENV.EMAIL || "guest@booking.test";
const loginPassword = __ENV.PASSWORD || "Password123!"; // seed demo parolası (README)
const BOOKINGS = Math.max(1, Number(__ENV.BOOKINGS || 20));
const RACERS = Math.max(2, Number(__ENV.RACERS || 3));
const DAY_OFFSET = Number(__ENV.DAY_OFFSET || 260);
const NIGHTS = Math.max(1, Number(__ENV.NIGHTS || 1));
const DESTINATION = __ENV.DESTINATION || "İstanbul";
const START_DELAY_MS = Number(__ENV.START_DELAY_MS || 3000);
const SAME_KEY = __ENV.SAME_KEY === "1";
const metricsToken = __ENV.METRICS_TOKEN || "";

const doubleCharges = new Counter("double_charges");
const payConfirmed = new Counter("pay_200_confirmed");
const payChallenged = new Counter("pay_202_challenge");
const payConflict = new Counter("pay_409");
const payRejected = new Counter("pay_4xx_other");
const pay5xx = new Counter("pay_5xx");
const verifiedBookings = new Counter("verified_bookings");

export const options = {
  setupTimeout: "120s",
  teardownTimeout: "120s",
  scenarios: {
    race: {
      executor: "per-vu-iterations",
      vus: BOOKINGS * RACERS,
      iterations: 1,
      maxDuration: "90s",
    },
  },
  thresholds: {
    double_charges: ["count==0"],
    pay_5xx: ["count==0"],
    verified_bookings: [`count>0`],
  },
};

function isoDay(offset) {
  return new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
}

function jsonHeaders(token, extra) {
  return Object.assign(
    { "content-type": "application/json", authorization: `Bearer ${token}` },
    extra || {}
  );
}

function login() {
  const res = http.post(
    `${BASE}/api/auth/login`,
    JSON.stringify({ email: EMAIL, password: loginPassword }),
    { headers: { "content-type": "application/json" } }
  );
  if (res.status !== 200) throw new Error(`login başarısız: ${res.status}`);
  return res.json("accessToken");
}

/** payment_attempts_total{outcome="confirmed"} toplamı; token yoksa null. */
function confirmedMetric() {
  if (!metricsToken) return null;
  const res = http.get(`${BASE}/api/metrics`, {
    headers: { authorization: `Bearer ${metricsToken}` },
  });
  if (res.status !== 200) {
    console.warn(`metrics okunamadı: ${res.status}`);
    return null;
  }
  let sum = 0;
  for (const line of String(res.body).split("\n")) {
    if (line.startsWith("payment_attempts_total{") && line.includes('outcome="confirmed"')) {
      sum += Number(line.trim().split(/\s+/).pop()) || 0;
    }
  }
  return sum;
}

export function setup() {
  const token = login();
  const metricsBefore = confirmedMetric();

  const rooms = [];
  const s = http.get(
    `${BASE}/api/search?destination=${encodeURIComponent(DESTINATION)}&pageSize=10`
  );
  if (s.status !== 200) throw new Error(`arama başarısız: ${s.status}`);
  for (const p of s.json("results") || []) {
    const d = http.get(`${BASE}/api/properties/${p.id}`);
    if (d.status !== 200) continue;
    for (const r of d.json("rooms") || []) rooms.push({ propertyId: p.id, roomId: r.id });
  }
  if (rooms.length === 0) throw new Error("aday oda bulunamadı (seed yüklü mü?)");

  const bookings = [];
  for (let i = 0; bookings.length < BOOKINGS && i < BOOKINGS * 3; i++) {
    const room = rooms[i % rooms.length];
    const start = DAY_OFFSET + Math.floor(i / rooms.length) * (NIGHTS + 1);
    const res = http.post(
      `${BASE}/api/bookings`,
      JSON.stringify({
        propertyId: room.propertyId,
        roomId: room.roomId,
        checkIn: isoDay(start),
        checkOut: isoDay(start + NIGHTS),
        guestCount: 1,
      }),
      { headers: jsonHeaders(token) }
    );
    if (res.status === 201) bookings.push(res.json("booking.id"));
    else console.warn(`HOLD oluşturulamadı (${res.status}): ${res.body}`);
  }
  if (bookings.length === 0) throw new Error("hiç HELD rezervasyon oluşturulamadı");
  console.log(`payment-race: ${bookings.length} HELD rezervasyon × ${RACERS} yarışçı`);
  return { token, bookings, metricsBefore, startAt: Date.now() + START_DELAY_MS };
}

export default function iteration(data) {
  const idx = Math.floor((__VU - 1) / RACERS);
  if (idx >= data.bookings.length) return;
  const bookingId = data.bookings[idx];
  const racer = (__VU - 1) % RACERS;

  // Ortak bariyer: tüm yarışçılar aynı anda ateşlesin.
  const wait = data.startAt - Date.now();
  if (wait > 0) sleep(wait / 1000);

  const key = SAME_KEY ? `race-${bookingId}` : `race-${bookingId}-${racer}`;
  const last4 = String(1000 + ((idx * RACERS + racer) % 9000));
  const res = http.post(
    `${BASE}/api/bookings/${bookingId}/pay`,
    JSON.stringify({ cardToken: `tok_mock_ok_${last4}`, cardBin: "424242" }),
    { headers: jsonHeaders(data.token, { "idempotency-key": key }), tags: { name: "pay" } }
  );

  if (res.status === 200) payConfirmed.add(1);
  else if (res.status === 202) {
    payChallenged.add(1);
    const c = http.post(
      `${BASE}/api/bookings/${bookingId}/pay/confirm`,
      JSON.stringify({ code: "123456" }),
      { headers: jsonHeaders(data.token), tags: { name: "pay_confirm" } }
    );
    if (c.status >= 500) pay5xx.add(1);
  } else if (res.status === 409) payConflict.add(1);
  else if (res.status >= 500) pay5xx.add(1);
  else payRejected.add(1);

  check(res, { "5xx yok": (r) => r.status < 500 });
}

export function teardown(data) {
  doubleCharges.add(0);
  // Access token kısa ömürlü; doğrulama için yeniden giriş.
  const token = login();
  let confirmed = 0;
  for (const id of data.bookings) {
    const res = http.get(`${BASE}/api/bookings/${id}`, { headers: jsonHeaders(token) });
    if (res.status !== 200) {
      console.warn(`rezervasyon okunamadı ${id}: ${res.status}`);
      continue;
    }
    verifiedBookings.add(1);
    const b = res.json("booking");
    if (b.status !== "CONFIRMED") continue;
    confirmed++;
    const p = b.payment;
    const bad =
      !p ||
      p.status !== "PAID" ||
      Number(p.amount) !== Number(b.totalPrice) ||
      Number(p.refundedAmount) !== 0;
    if (bad) {
      doubleCharges.add(1);
      console.error(`değişmez bozuldu ${id}: ${JSON.stringify(p)} total=${b.totalPrice}`);
    }
  }

  const after = confirmedMetric();
  if (data.metricsBefore !== null && after !== null) {
    const delta = after - data.metricsBefore;
    console.log(`metrics: confirmed artışı=${delta}, CONFIRMED rezervasyon=${confirmed}`);
    if (delta > confirmed) doubleCharges.add(delta - confirmed);
  }
  console.log(`payment-race: ${confirmed}/${data.bookings.length} CONFIRMED`);
}
