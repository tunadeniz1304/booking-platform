/* global __ENV, __VU */
/**
 * v5 P0-6 kaos betiklerinin ortak parçası (`load/chaos-redis.js`, `load/chaos-pg.js`).
 *
 * - Toxiproxy API yardımcıları (k6 compose iç ağından http://toxiproxy:8474).
 * - İş yükü: her yineleme ya tekil rezervasyon + ödeme (`/api/bookings` → `/pay`) ya da iki
 *   kalemli sepet tutma + ödeme; VU'ların yarısı birini yarısı diğerini koşar.
 * - Her istek, betiğin zaman çizelgesine göre evreyle (`phase`) etiketlenir; yanıtlar sınıflanır:
 *   2xx · 4xx (beklenen iş kuralı: 409/410/422) · 429 · 503/502/504 (bilinçli "şu an yok") ·
 *   500 (beklenmeyen) · 0 (ağ hatası / zaman aşımı).
 *
 * Betikler `-v <repo>/load:/load` ile bağlanıp `k6 run /load/chaos-*.js` olarak koşulur
 * (stdin'den koşulduğunda göreli içe aktarma çalışmaz).
 */
import http from "k6/http";
import { fail, sleep } from "k6";
import { Counter, Trend } from "k6/metrics";

export const BASE = __ENV.BASE_URL || "http://caddy:80";
export const TOXI = __ENV.TOXIPROXY_URL || "http://toxiproxy:8474";
const LOAD_ACCOUNTS = Number(__ENV.LOAD_ACCOUNTS || 60);
const PASSWORD = __ENV.PASSWORD || "Password123!"; // seed-load parolası (README)
const DAY_OFFSET = Number(__ENV.DAY_OFFSET || 300);
const DAY_SPREAD = Number(__ENV.DAY_SPREAD || 30);
const ROOMS = (__ENV.LOAD_ROOMS || "")
  .split(",")
  .filter(Boolean)
  .map((p) => ({ propertyId: p.split(":")[0], roomTypeId: p.split(":")[1] }));

export const statusClass = new Counter("chaos_status");
export const unexpected500 = new Counter("chaos_500");
export const outsideWindow5xx = new Counter("chaos_5xx_outside_window");
export const bookingsPaid = new Counter("chaos_bookings_paid");
export const cartsPaid = new Counter("chaos_carts_paid");
export const reqDuration = new Trend("chaos_req_duration", true);

/**
 * Zaman çizelgesi: [{ name, from, to }] (saniye, test başlangıcından). `from/to` dışı "baseline"
 * ya da "recovery"dir. Kaos penceresinden sonraki `graceS` saniye pencere içi sayılır (bağlantı
 * havuzlarının yeniden kurulması).
 */
export function phaseAt(windows, startedAt, graceS) {
  const t = (Date.now() - startedAt) / 1000;
  // Etkin pencere, önceki pencerenin toparlanma payından önceliklidir (pencereler çakışabilir).
  for (const w of windows) {
    if (t >= w.from && t < w.to) return { phase: w.name, inWindow: true };
  }
  for (const w of [...windows].reverse()) {
    if (t >= w.to && t < w.to + graceS) return { phase: `${w.name}_grace`, inWindow: true };
  }
  const last = windows[windows.length - 1];
  return {
    phase: t < windows[0].from ? "baseline" : t >= last.to ? "recovery" : "between",
    inWindow: false,
  };
}

function classOf(status) {
  if (status >= 200 && status < 300) return "2xx";
  if (status === 429) return "429";
  if (status === 502 || status === 503 || status === 504) return "503";
  if (status >= 500) return "500";
  if (status === 0) return "network";
  return "4xx";
}

export function makeRecorder(windows, startedAt, graceS) {
  return function record(res, name) {
    const { phase, inWindow } = phaseAt(windows, startedAt, graceS);
    const cls = classOf(res.status);
    statusClass.add(1, { phase, cls, name });
    reqDuration.add(res.timings.duration, { phase, name });
    if (cls === "500") {
      unexpected500.add(1, { phase, name });
      console.warn(`500 ${name} (${phase}): ${String(res.body).slice(0, 160)}`);
    }
    if ((cls === "500" || cls === "503" || cls === "network") && !inWindow) {
      outsideWindow5xx.add(1, { phase, name, cls });
    }
    return res;
  };
}

// --- Toxiproxy -------------------------------------------------------------------------------

export function toxicAdd(proxy, name, type, attributes, stream = "downstream") {
  const res = http.post(
    `${TOXI}/proxies/${proxy}/toxics`,
    JSON.stringify({ name, type, stream, toxicity: 1, attributes }),
    { headers: { "content-type": "application/json" }, tags: { name: "toxiproxy" } }
  );
  if (res.status !== 200) console.error(`toxic ${proxy}/${name}: ${res.status} ${res.body}`);
  else console.log(`toxic + ${proxy}/${name} ${type} ${JSON.stringify(attributes)}`);
}

export function toxicRemove(proxy, name) {
  const res = http.del(`${TOXI}/proxies/${proxy}/toxics/${name}`, null, {
    tags: { name: "toxiproxy" },
  });
  if (res.status === 204) console.log(`toxic - ${proxy}/${name}`);
}

export function proxyEnabled(proxy, enabled) {
  const res = http.post(`${TOXI}/proxies/${proxy}`, JSON.stringify({ enabled }), {
    headers: { "content-type": "application/json" },
    tags: { name: "toxiproxy" },
  });
  console.log(`proxy ${proxy} enabled=${enabled}: ${res.status}`);
}

/** Tüm toksinleri kaldırır ve proxy'leri açar (teardown / önceki yarım koşum). */
export function toxiReset() {
  http.post(`${TOXI}/reset`, null, { tags: { name: "toxiproxy" } });
}

/** Kontrol VU'su: `steps` = [{ at, run }] (saniye); sırayla bekleyip uygular. */
export function runSchedule(startedAt, steps) {
  for (const step of steps) {
    const wait = step.at - (Date.now() - startedAt) / 1000;
    if (wait > 0) sleep(wait);
    step.run();
  }
}

// --- İş yükü ---------------------------------------------------------------------------------

function isoDay(offset) {
  return new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
}

function headers(token, extra = {}) {
  return { "content-type": "application/json", authorization: `Bearer ${token}`, ...extra };
}

export function chaosSetup() {
  if (ROOMS.length < 2) fail("LOAD_ROOMS gerekli (scripts/seed-load.ts çıktısı)");
  toxiReset();
  const tokens = [];
  for (let start = 1; start <= LOAD_ACCOUNTS; start += 20) {
    const batch = [];
    for (let i = start; i < Math.min(start + 20, LOAD_ACCOUNTS + 1); i++) {
      batch.push([
        "POST",
        `${BASE}/api/auth/login`,
        JSON.stringify({
          email: `load-${String(i).padStart(3, "0")}@load.test`,
          password: PASSWORD,
        }),
        { headers: { "content-type": "application/json" }, jar: new http.CookieJar() },
      ]);
    }
    for (const res of http.batch(batch)) {
      if (res.status !== 200) fail(`login başarısız: ${res.status}`);
      tokens.push(res.json("accessToken"));
    }
  }
  return { tokens, rooms: ROOMS, startedAt: Date.now() };
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Tekil rezervasyon + ödeme (gerekirse 3DS onayı). */
export function bookingFlow(data, record) {
  const token = data.tokens[(__VU - 1) % data.tokens.length];
  const room = pick(data.rooms);
  const start = DAY_OFFSET + Math.floor(Math.random() * DAY_SPREAD);
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
      { headers: headers(token), tags: { name: "booking" }, timeout: "30s" }
    ),
    "booking"
  );
  if (res.status !== 201 && res.status !== 200) return;
  const id = res.json("booking.id");
  const pay = record(
    http.post(
      `${BASE}/api/bookings/${id}/pay`,
      JSON.stringify({ cardToken: "tok_mock_ok_424242_4242", cardBin: "424242" }),
      {
        headers: headers(token, { "idempotency-key": `chaos-pay-${id}` }),
        tags: { name: "pay" },
        timeout: "30s",
      }
    ),
    "pay"
  );
  let final = pay;
  if (pay.status === 202) {
    final = record(
      http.post(`${BASE}/api/bookings/${id}/pay/confirm`, JSON.stringify({ code: "123456" }), {
        headers: headers(token),
        tags: { name: "pay_confirm" },
        timeout: "30s",
      }),
      "pay_confirm"
    );
  }
  if (final.status === 200) bookingsPaid.add(1);
}

/** İki kalemli sepet: boşalt → ekle → tut → öde. */
export function cartFlow(data, record) {
  const token = data.tokens[(__VU - 1) % data.tokens.length];
  const cur = record(
    http.get(`${BASE}/api/cart`, { headers: headers(token), tags: { name: "cart_get" } }),
    "cart_get"
  );
  const existing = cur.status === 200 ? cur.json("cart") : null;
  if (existing) {
    record(
      http.del(`${BASE}/api/cart/${existing.id}`, null, {
        headers: headers(token),
        tags: { name: "cart_cancel" },
      }),
      "cart_cancel"
    );
  }
  const start = DAY_OFFSET + Math.floor(Math.random() * DAY_SPREAD);
  const picks = [...data.rooms].sort(() => Math.random() - 0.5).slice(0, 2);
  let cartId = null;
  for (const room of picks) {
    const add = record(
      http.post(
        `${BASE}/api/cart/items`,
        JSON.stringify({
          propertyId: room.propertyId,
          roomTypeId: room.roomTypeId,
          checkIn: isoDay(start),
          checkOut: isoDay(start + 1),
          adults: 1,
          children: 0,
          quantity: 1,
        }),
        { headers: headers(token), tags: { name: "cart_add" }, timeout: "30s" }
      ),
      "cart_add"
    );
    if (add.status !== 201) return;
    cartId = add.json("cart.id");
  }
  const hold = record(
    http.post(`${BASE}/api/cart/${cartId}/hold`, "{}", {
      headers: headers(token, { "idempotency-key": `chaos-hold-${cartId}` }),
      tags: { name: "cart_hold" },
      timeout: "30s",
    }),
    "cart_hold"
  );
  if (hold.status !== 200) return;
  const pay = record(
    http.post(
      `${BASE}/api/cart/${cartId}/pay`,
      JSON.stringify({ cardToken: "tok_mock_ok_424242_4242" }),
      {
        headers: headers(token, { "idempotency-key": `chaos-cartpay-${cartId}` }),
        tags: { name: "cart_pay" },
        timeout: "30s",
      }
    ),
    "cart_pay"
  );
  let final = pay;
  if (pay.status === 202) {
    final = record(
      http.post(`${BASE}/api/cart/${cartId}/pay/confirm`, JSON.stringify({ code: "123456" }), {
        headers: headers(token),
        tags: { name: "cart_pay_confirm" },
        timeout: "30s",
      }),
      "cart_pay_confirm"
    );
  }
  if (final.status === 200) cartsPaid.add(1);
}

export function workload(data, windows, graceS) {
  const record = makeRecorder(windows, data.startedAt, graceS);
  if (__VU % 2 === 0) bookingFlow(data, record);
  else cartFlow(data, record);
  sleep(0.2);
}

/**
 * k6 etiketli alt metrikleri yalnız eşiği olanları özete yazar: her (evre, sınıf) çifti için
 * etkisiz (`count>=0`) eşik → özet tablosu evre × sınıf dökümünü gösterir. Gerçek eşikler:
 * pencere dışı 5xx/ağ hatası 0.
 */
export function chaosThresholds(windows) {
  const phases = ["baseline", "between", "recovery"];
  for (const w of windows) phases.push(w.name, `${w.name}_grace`);
  const t = {
    chaos_5xx_outside_window: ["count==0"],
  };
  for (const phase of phases) {
    for (const cls of ["2xx", "4xx", "429", "503", "500", "network"]) {
      t[`chaos_status{phase:${phase},cls:${cls}}`] = ["count>=0"];
    }
    t[`chaos_req_duration{phase:${phase}}`] = ["p(95)>=0"];
  }
  return t;
}
