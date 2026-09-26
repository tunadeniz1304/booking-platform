/* global __ENV */
/**
 * k6 PSP WEBHOOK FIRTINASI (P2-3) — imzalı mock webhook'lar: tekrarlar + sırasız + geç başarı.
 *
 * setup(): BOOKINGS adet HELD rezervasyon (LOAD_ROOMS'taki stok sınırlı odalar) açar ve her
 * birine 3DS kartıyla ödeme başlatır (202; PSP ref'i MockPsp'nin deterministik şemasından
 * hesaplanır: `pi_mock_` + sha256(`auth:<bookingId>:<key>:<creditMinor>:<token>`)[0:24] + `_3ds`;
 * yük hesaplarının cüzdan kredisi yok → creditMinor = 0).
 * CANCEL_PCT kadarını webhook'tan ÖNCE iptal eder → gelen başarı "geç başarı" olur ve
 * otomatik iade edilmelidir (payment_late_success_total{outcome="refunded"}).
 *
 * Fırtına: her rezervasyon için olaylar KARIŞIK sırayla ve AYNI ANDA (http.batch) gönderilir:
 *   - `payment.succeeded` (aynı olay kimliği DUPS kez — PSP yeniden denemesi),
 *   - `payment.succeeded` farklı kimlikle (PSP'nin çift yayını),
 *   - `payment.failed` (sırasız: başarıdan önce ya da sonra gelebilir),
 *   - INVALID_PCT oranında bozuk imzalı kopya (400 beklenir, etkisiz).
 * Değişmezler: 5xx = 0; teardown'da iptal edilmeyen rezervasyon CONFIRMED (ya da geç başarıyla
 * iade), iptal edilenler CANCELLED kalır. Kesin kontrol (çift capture / defter / aşırı satış):
 * scripts/load-assert.ts.
 *
 * Kullanım: host ortamındaki PSP_WEBHOOK_SECRET değişkenine yığının
 * `/run/booking-secrets/PSP_WEBHOOK_SECRET` dosyasının içeriğini verin (ekrana basmadan), sonra:
 *   docker run --rm -i --network <proj>_default -e BASE_URL=http://app:3000 -e PSP_WEBHOOK_SECRET  *     -e LOAD_ACCOUNTS=120 -e LOAD_ROOMS=<p:r,...> grafana/k6 run - < load/webhook-storm.js
 *
 * Ortam: BOOKINGS (200), DUPS (3), CANCEL_PCT (20), INVALID_PCT (10), VUS (20), DAY_OFFSET (90),
 *   PASSWORD, LOAD_ACCOUNTS (120).
 */
import http from "k6/http";
import crypto from "k6/crypto";
import exec from "k6/execution";
import { check, fail } from "k6";
import { Counter, Trend } from "k6/metrics";

const BASE = __ENV.BASE_URL || "http://localhost:3000";
const WEBHOOK_KEY = __ENV.PSP_WEBHOOK_SECRET || "";
const N_ACCOUNTS = Number(__ENV.LOAD_ACCOUNTS || 120);
const loginPassword = __ENV.PASSWORD || "Password123!"; // seed demo parolası (README)
const ROOMS = (__ENV.LOAD_ROOMS || "")
  .split(",")
  .filter(Boolean)
  .map((p) => ({ propertyId: p.split(":")[0], roomTypeId: p.split(":")[1] }));
const BOOKINGS = Number(__ENV.BOOKINGS || 200);
const DUPS = Math.max(1, Number(__ENV.DUPS || 3));
const CANCEL_PCT = Number(__ENV.CANCEL_PCT || 20);
const INVALID_PCT = Number(__ENV.INVALID_PCT || 10);
const VUS = Number(__ENV.VUS || 20);
const DAY_OFFSET = Number(__ENV.DAY_OFFSET || 90);
const CARD = "tok_mock_3ds_424242_4242";

const sent = new Counter("webhook_sent");
const duplicates = new Counter("webhook_duplicate_ack");
const rejected = new Counter("webhook_invalid_rejected");
const serverErrors = new Counter("webhook_5xx");
const conflicts = new Counter("webhook_409");
const unexpected = new Counter("webhook_unexpected_final_state");
const whLatency = new Trend("webhook_duration", true);

export const options = {
  setupTimeout: "10m",
  scenarios: {
    storm: {
      executor: "shared-iterations",
      vus: VUS,
      iterations: BOOKINGS,
      maxDuration: "10m",
    },
  },
  thresholds: {
    webhook_5xx: ["count==0"],
    webhook_unexpected_final_state: ["count==0"],
    "http_req_duration{name:webhook}": ["p(95)<2000"],
  },
};

function email(i) {
  return `load-${String(i + 1).padStart(3, "0")}@load.test`;
}
function isoDay(offset) {
  return new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
}
function hdr(token, extra) {
  return Object.assign(
    { "content-type": "application/json", authorization: `Bearer ${token}` },
    extra || {}
  );
}
function sign(body) {
  const t = Math.floor(Date.now() / 1000);
  return `t=${t},v1=${crypto.hmac("sha256", WEBHOOK_KEY, `${t}.${body}`, "hex")}`;
}
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function setup() {
  if (WEBHOOK_KEY.length < 32) fail("PSP_WEBHOOK_SECRET gerekli (yığının secrets hacminden)");
  if (ROOMS.length === 0) fail("LOAD_ROOMS gerekli (npm run load:seed çıktısı)");
  const tokens = [];
  for (let start = 0; start < N_ACCOUNTS; start += 20) {
    const reqs = [];
    for (let i = start; i < Math.min(N_ACCOUNTS, start + 20); i++) {
      reqs.push([
        "POST",
        `${BASE}/api/auth/login`,
        JSON.stringify({ email: email(i), password: loginPassword }),
        // Oturum çerezleri VU çerez kavanozuna girmesin: Bearer isteklerine çerez eklenirse
        // uygulama Origin'siz çerezli isteği CSRF sayar (403 CSRF_REJECTED).
        { headers: { "content-type": "application/json" }, jar: new http.CookieJar() },
      ]);
    }
    for (const res of http.batch(reqs)) {
      if (res.status !== 200) fail(`login başarısız: ${res.status}`);
      tokens.push(res.json("accessToken"));
    }
  }

  const bookings = [];
  let day = 0;
  for (let i = 0; bookings.length < BOOKINGS && i < BOOKINGS * 3; i++) {
    const token = tokens[i % tokens.length];
    const room = ROOMS[i % ROOMS.length];
    // Oda başına gün başına stok sınırlı: her oda turunda bir sonraki güne geç.
    if (i > 0 && i % (ROOMS.length * 4) === 0) day++;
    const create = http.post(
      `${BASE}/api/bookings`,
      JSON.stringify({
        propertyId: room.propertyId,
        roomId: room.roomTypeId,
        checkIn: isoDay(DAY_OFFSET + day),
        checkOut: isoDay(DAY_OFFSET + day + 1),
        guestCount: 1,
      }),
      { headers: hdr(token, { "idempotency-key": `k6-wh-b-${Date.now()}-${i}` }) }
    );
    if (create.status !== 201) continue;
    const bookingId = create.json("booking.id");
    const key = `k6-wh-${bookingId}`;
    const pay = http.post(
      `${BASE}/api/bookings/${bookingId}/pay`,
      JSON.stringify({ cardToken: CARD }),
      {
        headers: hdr(token, { "idempotency-key": key }),
      }
    );
    if (pay.status !== 202) {
      console.warn(`3DS ödeme başlatılamadı: ${pay.status} ${pay.body}`);
      continue;
    }
    const ref = `pi_mock_${crypto.sha256(`auth:${bookingId}:${key}:0:${CARD}`, "hex").slice(0, 24)}_3ds`;
    const cancel = Math.random() * 100 < CANCEL_PCT;
    if (cancel) {
      const del = http.del(`${BASE}/api/bookings/${bookingId}`, null, { headers: hdr(token) });
      if (del.status >= 300) console.warn(`iptal başarısız: ${del.status} ${del.body}`);
    }
    bookings.push({ bookingId, ref, token, cancelled: cancel });
  }
  console.log(
    `webhook-storm: ${bookings.length} rezervasyon (${bookings.filter((b) => b.cancelled).length} iptal)`
  );
  return { bookings };
}

export default function storm(data) {
  const b = data.bookings[exec.scenario.iterationInTest];
  if (!b) return;
  const events = [];
  const ok = JSON.stringify({
    id: `evt_${b.ref}_ok`,
    type: "payment.succeeded",
    data: { providerRef: b.ref },
  });
  for (let d = 0; d < DUPS; d++) events.push({ body: ok, valid: true });
  events.push({
    body: JSON.stringify({
      id: `evt_${b.ref}_ok2`,
      type: "payment.succeeded",
      data: { providerRef: b.ref },
    }),
    valid: true,
  });
  events.push({
    body: JSON.stringify({
      id: `evt_${b.ref}_fail`,
      type: "payment.failed",
      data: { providerRef: b.ref },
    }),
    valid: true,
  });
  if (Math.random() * 100 < INVALID_PCT) events.push({ body: ok, valid: false });

  const responses = http.batch(
    shuffle(events).map((e) => [
      "POST",
      `${BASE}/api/payments/webhook`,
      e.body,
      {
        headers: {
          "content-type": "application/json",
          "x-psp-signature": e.valid
            ? sign(e.body)
            : `t=${Math.floor(Date.now() / 1000)},v1=${"0".repeat(64)}`,
        },
        tags: { name: "webhook" },
      },
    ])
  );
  responses.forEach((res, i) => {
    sent.add(1);
    whLatency.add(res.timings.duration);
    if (res.status >= 500) {
      serverErrors.add(1);
      console.warn(`webhook 5xx: ${res.status} ${res.body}`);
    } else if (res.status === 409) conflicts.add(1);
    else if (res.status === 400) rejected.add(1);
    else if (res.status === 200 && res.json("duplicate") === true) duplicates.add(1);
    check(res, { "webhook 200/400/409 (5xx yok)": (r) => [200, 400, 409].includes(r.status) });
    void i;
  });
}

/** Son durum: iptal edilmeyen → CONFIRMED; iptal edilen → CANCELLED (geç başarı iade edildi). */
export function teardown(data) {
  const summary = {};
  for (const b of data.bookings) {
    const res = http.get(`${BASE}/api/bookings/${b.bookingId}`, { headers: hdr(b.token) });
    const status = res.status === 200 ? res.json("booking.status") : `http_${res.status}`;
    const key = `${b.cancelled ? "iptal" : "aktif"}:${status}`;
    summary[key] = (summary[key] || 0) + 1;
    const expected = b.cancelled ? "CANCELLED" : "CONFIRMED";
    if (status !== expected) unexpected.add(1);
  }
  console.log(`webhook-storm son durum: ${JSON.stringify(summary)}`);
}
