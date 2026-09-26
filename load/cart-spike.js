/* global __ENV, __VU */
/**
 * k6 GRUP SEPETİ sıçrama testi (P1-1) — N paralel sepet × 2+ oda tipi, tümü-ya-hiç tutma.
 *
 * Her yineleme: hesabın aktif sepetini boşalt → aynı tarihlere K farklı oda tipi ekle →
 * POST /api/cart/:id/hold. Beklenen yanıtlar 200 (hepsi tutuldu) / 409 (dolu, ROOM_BUSY,
 * PRICE_CHANGED) / 429; 5xx YOK. Değişmez (atomiklik): 409 sonrası sepette HELD rezervasyon
 * kalmaz; 200 sonrası TÜM kalemler HELD. Aşırı satış veritabanı kısıtıyla imkânsızdır
 * (`sold + held <= total`; kanıt: tests/integration/v4-cart.test.ts); teardown aday odalar için
 * teklif ister (200/409, 5xx yok).
 *
 * Kullanım (koşturma F8'de):
 *   docker run --rm -i --network <proj>_default -e BASE_URL=http://app:3000 \
 *     -e ACCOUNTS=a@x.test,b@x.test -e DAY_OFFSET=240 grafana/k6 run - < load/cart-spike.js
 *
 * Ortam değişkenleri (hepsi opsiyonel):
 *   BASE_URL        hedef (varsayılan http://localhost:3000)
 *   LOAD_ACCOUNTS   N → seed-load hesapları load-001..N@load.test (ACCOUNTS'u ezer)
 *   LOAD_ROOMS      "<mülk>:<oda>,…" stok sınırlı yük odaları (verilirse arama atlanır)
 *   ACCOUNTS        virgülle e-postası DOĞRULANMIŞ hesaplar (kullanıcı başına tek aktif sepet
 *                   olduğundan gerçek 100 paralel sepet için ≥100 hesap; varsayılan seed misafiri)
 *   PASSWORD        hesap parolası (varsayılan seed demo parolası)
 *   DESTINATION     aday şehir (varsayılan İstanbul) · ROOMS: aday oda tipi sayısı (varsayılan 4)
 *   ITEMS           sepet başına kalem (varsayılan 2) · NIGHTS (varsayılan 2)
 *   DAY_OFFSET      check-in için bugünden gün farkı (varsayılan 240; her koşuda değiştirin)
 *   PAY             "1" → tutulan sepet mock kartla ödenir (varsayılan yalnız tutma + bırakma)
 *   VUS / DURATION  paralel sepet sayısı ve süre (varsayılan 100 / 30s)
 *   P95_MS          tutma p95 eşiği ms (varsayılan 2000)
 *
 * Önkoşul: RATE_LIMIT_BOOKING_MAX ve RATE_LIMIT_AUTH_MAX yükseltilmiş olmalı
 * (docker-compose.load.yml). Değişmez denetimi: scripts/load-assert.ts.
 */
import http from "k6/http";
import { check, fail } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

const BASE = __ENV.BASE_URL || "http://localhost:3000";
// LOAD_ACCOUNTS=N → scripts/seed-load.ts hesapları (load-001@load.test …); yoksa ACCOUNTS listesi.
const LOAD_ACCOUNTS = Number(__ENV.LOAD_ACCOUNTS || 0);
const ACCOUNTS =
  LOAD_ACCOUNTS > 0
    ? Array.from(
        { length: LOAD_ACCOUNTS },
        (_, i) => `load-${String(i + 1).padStart(3, "0")}@load.test`
      )
    : (__ENV.ACCOUNTS || "guest@booking.test")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
// LOAD_ROOMS="<mülk>:<oda tipi>,…" (seed-load çıktısı: stok sınırlı odalar) → arama atlanır.
const LOAD_ROOMS = (__ENV.LOAD_ROOMS || "")
  .split(",")
  .filter(Boolean)
  .map((p) => ({ propertyId: p.split(":")[0], roomTypeId: p.split(":")[1] }));
const loginPassword = __ENV.PASSWORD || "Password123!"; // seed demo parolası (README)
const DESTINATION = __ENV.DESTINATION || "İstanbul";
const ROOMS = Math.max(2, Number(__ENV.ROOMS || 4));
const ITEMS = Math.max(2, Number(__ENV.ITEMS || 2));
const NIGHTS = Math.max(1, Number(__ENV.NIGHTS || 2));
const DAY_OFFSET = Number(__ENV.DAY_OFFSET || 240);
const PAY = __ENV.PAY === "1";
const VUS = Number(__ENV.VUS || 100);
const DURATION = __ENV.DURATION || "30s";
const P95_MS = Number(__ENV.P95_MS || 2000);

const held = new Counter("cart_hold_200");
const conflict = new Counter("cart_hold_409");
const limited = new Counter("cart_hold_429");
const serverErrors = new Counter("cart_5xx");
const partialHolds = new Counter("cart_partial_hold");
const paid = new Counter("cart_paid");
const atomic = new Rate("cart_atomic");
const holdLatency = new Trend("cart_hold_duration", true);

export const options = {
  scenarios: {
    spike: { executor: "constant-vus", vus: VUS, duration: DURATION },
  },
  thresholds: {
    cart_5xx: ["count==0"],
    cart_partial_hold: ["count==0"],
    cart_atomic: ["rate==1"],
    "http_req_duration{name:cart_hold}": [`p(95)<${P95_MS}`],
  },
};

function isoDay(offset) {
  return new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
}

function json(token) {
  return { "content-type": "application/json", authorization: `Bearer ${token}` };
}

function record(res) {
  if (res.status >= 500) serverErrors.add(1);
}

export function setup() {
  const tokens = [];
  // 20'lik paralel partiler: 100+ hesapta setup süresini kısaltır.
  for (let start = 0; start < ACCOUNTS.length; start += 20) {
    const batch = ACCOUNTS.slice(start, start + 20);
    const responses = http.batch(
      batch.map((email) => [
        "POST",
        `${BASE}/api/auth/login`,
        JSON.stringify({ email, password: loginPassword }),
        // Oturum çerezleri VU çerez kavanozuna girmesin: Bearer isteklerine çerez eklenirse
        // uygulama Origin'siz çerezli isteği CSRF sayar (403 CSRF_REJECTED).
        { headers: { "content-type": "application/json" }, jar: new http.CookieJar() },
      ])
    );
    responses.forEach((login, i) => {
      if (login.status !== 200) fail(`login başarısız (${batch[i]}): ${login.status}`);
      tokens.push(login.json("accessToken"));
    });
  }

  if (LOAD_ROOMS.length >= ITEMS) {
    console.log(`cart-spike: ${tokens.length} hesap, ${LOAD_ROOMS.length} yük odası, VUS=${VUS}`);
    return { tokens, rooms: LOAD_ROOMS.slice(0, ROOMS) };
  }
  const rooms = [];
  const s = http.get(`${BASE}/api/search?destination=${encodeURIComponent(DESTINATION)}`);
  if (s.status !== 200) fail(`arama başarısız: ${s.status}`);
  for (const p of s.json("results") || []) {
    if (rooms.length >= ROOMS) break;
    const d = http.get(`${BASE}/api/properties/${p.id}`);
    if (d.status !== 200) continue;
    for (const r of d.json("rooms") || []) {
      if (rooms.length >= ROOMS) break;
      rooms.push({ propertyId: p.id, roomTypeId: r.id });
    }
  }
  if (rooms.length < ITEMS) fail("yeterli aday oda yok (seed yüklü mü?)");
  console.log(`cart-spike: ${tokens.length} hesap, ${rooms.length} oda tipi, VUS=${VUS}`);
  return { tokens, rooms };
}

function clearCart(token) {
  const res = http.get(`${BASE}/api/cart`, { headers: json(token), tags: { name: "cart_get" } });
  record(res);
  const cart = res.status === 200 ? res.json("cart") : null;
  if (cart) {
    record(
      http.del(`${BASE}/api/cart/${cart.id}`, null, {
        headers: json(token),
        tags: { name: "cart_cancel" },
      })
    );
  }
}

export default function iteration(data) {
  const token = data.tokens[(__VU - 1) % data.tokens.length];
  clearCart(token);

  // Aynı tarihlere K farklı oda tipi; kalem sırası karışık (kilit sırası sunucuda sabittir).
  const picks = [...data.rooms].sort(() => Math.random() - 0.5).slice(0, ITEMS);
  let cartId = null;
  for (const room of picks) {
    const res = http.post(
      `${BASE}/api/cart/items`,
      JSON.stringify({
        propertyId: room.propertyId,
        roomTypeId: room.roomTypeId,
        checkIn: isoDay(DAY_OFFSET),
        checkOut: isoDay(DAY_OFFSET + NIGHTS),
        adults: 1,
        children: 0,
        quantity: 1,
      }),
      { headers: json(token), tags: { name: "cart_add" } }
    );
    record(res);
    if (res.status !== 201) return; // dolu / sınır → bu yineleme tutmaya gitmez
    cartId = res.json("cart.id");
  }
  if (!cartId) return;

  const hold = http.post(`${BASE}/api/cart/${cartId}/hold`, "{}", {
    headers: { ...json(token), "idempotency-key": `k6-${__VU}-${Date.now()}` },
    tags: { name: "cart_hold" },
  });
  holdLatency.add(hold.timings.duration);
  record(hold);
  check(hold, { "tutma 200/409/429 (5xx yok)": (r) => [200, 409, 429].includes(r.status) });

  // Atomiklik: sepetin kalem rezervasyonları ya hepsi HELD ya hiçbiri.
  const after = http.get(`${BASE}/api/cart/${cartId}`, {
    headers: json(token),
    tags: { name: "cart_get" },
  });
  record(after);
  if (after.status === 200) {
    const statuses = (after.json("cart.items") || []).map((i) => i.bookingStatus);
    const heldCount = statuses.filter((s) => s === "HELD").length;
    const ok = heldCount === 0 || heldCount === statuses.length;
    atomic.add(ok);
    if (!ok) partialHolds.add(1);
  }

  if (hold.status === 200) {
    held.add(1);
    if (PAY) {
      const pay = http.post(
        `${BASE}/api/cart/${cartId}/pay`,
        JSON.stringify({ cardToken: "tok_mock_ok_424242_4242" }),
        {
          headers: { ...json(token), "idempotency-key": `k6-pay-${__VU}-${Date.now()}` },
          tags: { name: "cart_pay" },
        }
      );
      record(pay);
      let final = pay;
      if (pay.status === 202) {
        // Risk motoru 3DS isterse demo koduyla onayla.
        final = http.post(
          `${BASE}/api/cart/${cartId}/pay/confirm`,
          JSON.stringify({ code: "123456" }),
          {
            headers: json(token),
            tags: { name: "cart_pay_confirm" },
          }
        );
        record(final);
      }
      if (final.status === 200) paid.add(1);
    } else {
      record(
        http.post(`${BASE}/api/cart/${cartId}/release`, "{}", {
          headers: json(token),
          tags: { name: "cart_release" },
        })
      );
    }
  } else if (hold.status === 409) conflict.add(1);
  else if (hold.status === 429) limited.add(1);
}

/** Aday odalar için son teklif: 200 (yer var) ya da 409 SOLD_OUT; 5xx eşiği kırar. */
export function teardown(data) {
  for (const room of data.rooms) {
    const res = http.get(
      `${BASE}/api/quote?roomId=${room.roomTypeId}&checkIn=${isoDay(DAY_OFFSET)}&checkOut=${isoDay(
        DAY_OFFSET + NIGHTS
      )}&guests=1`
    );
    record(res);
  }
}
