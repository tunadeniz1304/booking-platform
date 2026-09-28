/* global __ENV, __VU, __ITER */
/**
 * v5 P2-3 — RNPL tahsilat fırtınası: aynı anda vadesi gelen N (varsayılan 1000) "şimdi rezerve et,
 * sonra öde" tahsilatı. Üç adım (tam komutlar: docs/perf/v5-rnpl-storm.md):
 *
 *   1) MODE=seed  — N hesap-rezervasyonu API'den RNPL ile ödenir (`/pay` `paymentOption: "rnpl"`):
 *                   rezervasyon CONFIRMED, ödeme PENDING, `PaymentSchedule` SCHEDULED + gecikmeli
 *                   `rnpl-charge` işi (vade: gerçek hayatta aylar sonra).
 *   2) scripts/rnpl-storm.ts trigger — hepsinin vadesini "şimdi"ye çeker ve gecikmeli işleri AYNI
 *                   ANDA öne alır (fırtına); worker tahsil eder.
 *   3) MODE=race  — (2) ile eşzamanlı: misafirler RNPL rezervasyonlarının CANCEL_RATIO kadarını
 *                   iptal eder (ücretsiz iptal ↔ tahsilat yarışı; ödeme kilidiyle sıralanır).
 *   4) scripts/rnpl-storm.ts verify — boşalma süresi, sonuç dağılımı ve değişmezler (çift
 *                   tahsilat 0, iptal edilen rezervasyonda iadesiz tahsilat 0, CAPTURED ↔ PAID ↔
 *                   tek jurnal); ardından scripts/load-assert.ts.
 *
 * Ortam: BASE_URL, LOAD_ACCOUNTS (varsayılan 120), LOAD_ROOMS (seed-load çıktısı), N, VUS,
 *        DAY_FROM (varsayılan 60) / DAY_SPAN (varsayılan 300): RNPL için check-in aralığı —
 *        ücretsiz iptal süresi + RNPL_MIN_LEAD_HOURS sağlanmalı; diğer betiklerin tarihleriyle
 *        (DAY_OFFSET ≥ 240 çevresi) çakışmaz. CANCEL_RATIO (varsayılan 0.1).
 */
import http from "k6/http";
import { fail, sleep } from "k6";
import { Counter, Trend } from "k6/metrics";

const BASE = __ENV.BASE_URL || "http://caddy:80";
const MODE = __ENV.MODE || "seed";
const N = Number(__ENV.N || 1000);
const VUS = Number(__ENV.VUS || 20);
const LOAD_ACCOUNTS = Number(__ENV.LOAD_ACCOUNTS || 120);
const loginPassword = __ENV.PASSWORD || "Password123!";
const DAY_FROM = Number(__ENV.DAY_FROM || 60);
const DAY_SPAN = Number(__ENV.DAY_SPAN || 180);
const CANCEL_RATIO = Number(__ENV.CANCEL_RATIO || 0.1);
// race: yalnız bu andan sonra oluşturulan rezervasyonlar (ISO; önceki fırtınaların planları hariç)
const CREATED_AFTER = __ENV.CREATED_AFTER || "";
// race: iptallere başlamadan bekleme (tetikleme ile hizalamak için) ve iptaller arası azami ara (s)
const RACE_DELAY_S = Number(__ENV.RACE_DELAY_S || 0);
const RACE_PACE_S = Number(__ENV.RACE_PACE_S || 0);
const ROOMS = (__ENV.LOAD_ROOMS || "")
  .split(",")
  .filter(Boolean)
  .map((p) => ({ propertyId: p.split(":")[0], roomTypeId: p.split(":")[1] }));

const rnplScheduled = new Counter("rnpl_scheduled");
const rnplUnavailable = new Counter("rnpl_unavailable");
const bookingSoldOut = new Counter("rnpl_booking_409");
const cancelOk = new Counter("rnpl_cancel_200");
const cancelConflict = new Counter("rnpl_cancel_4xx");
const serverErrors = new Counter("rnpl_5xx");
const payLatency = new Trend("rnpl_pay_duration", true);
const cancelLatency = new Trend("rnpl_cancel_duration", true);

export const options = {
  setupTimeout: "300s",
  scenarios:
    MODE === "seed"
      ? { seed: { executor: "shared-iterations", vus: VUS, iterations: N, maxDuration: "20m" } }
      : { race: { executor: "shared-iterations", vus: VUS, iterations: VUS, maxDuration: "10m" } },
  thresholds: { rnpl_5xx: ["count==0"] },
};

function isoDay(offset) {
  return new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
}

function headers(token, extra = {}) {
  return { "content-type": "application/json", authorization: `Bearer ${token}`, ...extra };
}

function record(res) {
  if (res.status >= 500 || res.status === 0) {
    serverErrors.add(1);
    console.warn(`${res.status} ${res.request.url}: ${String(res.body).slice(0, 160)}`);
  }
  return res;
}

function loginAll() {
  const tokens = [];
  for (let start = 1; start <= LOAD_ACCOUNTS; start += 20) {
    const batch = [];
    for (let i = start; i < Math.min(start + 20, LOAD_ACCOUNTS + 1); i++) {
      batch.push([
        "POST",
        `${BASE}/api/auth/login`,
        JSON.stringify({
          email: `load-${String(i).padStart(3, "0")}@load.test`,
          password: loginPassword,
        }),
        { headers: { "content-type": "application/json" }, jar: new http.CookieJar() },
      ]);
    }
    for (const res of http.batch(batch)) {
      if (res.status !== 200) fail(`login başarısız: ${res.status}`);
      tokens.push(res.json("accessToken"));
    }
  }
  return tokens;
}

/** Hesabın RNPL aralığındaki CONFIRMED rezervasyonları (race modu için). */
function rnplCandidates(token) {
  const out = [];
  const from = isoDay(DAY_FROM);
  const to = isoDay(DAY_FROM + DAY_SPAN + 1);
  let url = `${BASE}/api/bookings?limit=100`;
  for (let page = 0; url && page < 20; page++) {
    const res = record(http.get(url, { headers: headers(token), tags: { name: "list" } }));
    if (res.status !== 200) break;
    for (const b of res.json() || []) {
      const checkIn = String(b.checkIn).slice(0, 10);
      const fresh = !CREATED_AFTER || String(b.createdAt) > CREATED_AFTER;
      if (b.status === "CONFIRMED" && checkIn >= from && checkIn < to && fresh) out.push(b.id);
    }
    const next = res.headers["X-Next-Cursor"];
    url = next ? `${BASE}/api/bookings?limit=100&cursor=${encodeURIComponent(next)}` : null;
  }
  return out;
}

export function setup() {
  if (ROOMS.length === 0) fail("LOAD_ROOMS gerekli (scripts/seed-load.ts çıktısı)");
  const tokens = loginAll();
  if (MODE !== "race") return { tokens };
  const perToken = tokens.map((t) => rnplCandidates(t));
  const total = perToken.reduce((s, l) => s + l.length, 0);
  console.log(`rnpl-race: ${total} aday CONFIRMED rezervasyon`);
  return { tokens, perToken };
}

function seedOne(data) {
  const idx = (__VU - 1) * 100000 + __ITER;
  const token = data.tokens[idx % data.tokens.length];
  const room = ROOMS[Math.floor(Math.random() * ROOMS.length)];
  const start = DAY_FROM + Math.floor(Math.random() * DAY_SPAN);
  const res = record(
    http.post(
      `${BASE}/api/bookings`,
      JSON.stringify({
        propertyId: room.propertyId,
        roomId: room.roomTypeId,
        checkIn: isoDay(start),
        checkOut: isoDay(start + 1),
        guestCount: 1,
      }),
      { headers: headers(token), tags: { name: "booking" } }
    )
  );
  if (res.status === 409) {
    bookingSoldOut.add(1);
    return;
  }
  if (res.status !== 201 && res.status !== 200) return;
  const id = res.json("booking.id");
  const pay = record(
    http.post(
      `${BASE}/api/bookings/${id}/pay`,
      JSON.stringify({
        // Kart başına hız sınırı (FRAUD_VELOCITY_CARD_MAX) tek kartla 1000 ödemede dolar ve
        // RNPL yalnız risk "allow" iken sunulur → her rezervasyon farklı son-4 hanesiyle.
        cardToken: `tok_mock_ok_${1000 + (idx % 9000)}`,
        cardBin: "424242",
        paymentOption: "rnpl",
      }),
      {
        headers: headers(token, { "idempotency-key": `rnpl-storm-${id}` }),
        tags: { name: "pay_rnpl" },
      }
    )
  );
  payLatency.add(pay.timings.duration);
  if (pay.status === 200 && pay.json("status") === "scheduled") rnplScheduled.add(1);
  else if (pay.status === 409) {
    rnplUnavailable.add(1);
    if (Math.random() < 0.05) console.warn(`rnpl 409: ${String(pay.body).slice(0, 200)}`);
  }
}

function raceOne(data) {
  // VU başına bir hesap dilimi: hesabın adaylarından CANCEL_RATIO kadarını iptal eder.
  if (RACE_DELAY_S > 0) sleep(RACE_DELAY_S);
  for (let t = __VU - 1; t < data.tokens.length; t += VUS) {
    const token = data.tokens[t];
    for (const id of data.perToken[t]) {
      if (Math.random() >= CANCEL_RATIO) continue;
      if (RACE_PACE_S > 0) sleep(Math.random() * RACE_PACE_S);
      const res = record(
        http.del(`${BASE}/api/bookings/${id}`, null, {
          headers: headers(token),
          tags: { name: "cancel" },
        })
      );
      cancelLatency.add(res.timings.duration);
      if (res.status === 200) cancelOk.add(1);
      else if (res.status >= 400 && res.status < 500) cancelConflict.add(1);
    }
  }
}

export default function iteration(data) {
  if (MODE === "race") raceOne(data);
  else seedOne(data);
}
