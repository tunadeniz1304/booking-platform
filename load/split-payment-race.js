/* global __ENV, __VU, __ITER */
/**
 * k6 BÖLÜNMÜŞ ÖDEME yarış testi (P1-2 / P2-3) — iki senaryo:
 *
 *  1. `share_race`: organizatör sepeti tutar, eşit 3 pay tanımlar; AYNI paya RACERS farklı hesap
 *     aynı anda (http.batch) öder. Beklenen: tam olarak BİR 200 (authorized), diğerleri 409
 *     (SHARE_ALREADY_PAID / PAYMENT_IN_PROGRESS) — asla iki yetkilendirme. Sonra kalan pay +
 *     organizatör payı ödenir → son ödeme tümünü tahsil eder, plan SETTLED ("confirmed").
 *  2. `deadline_race`: setup'ta DEADLINE_PLANS plan kurulur (organizatör payını öder, 1 pay açık);
 *     her VU açık payı plan süresinin (SPLIT_PAY_DEADLINE_MINUTES=5) ±OFFSET_MS çevresinde öder
 *     — süre sonu işi (void/iade + tutma serbest) ile son ödeme yarışır. Beklenen: 200 döndüyse
 *     plan SETTLED; 409/410 döndüyse plan ABORTED/FALLBACK ve hiçbir pay CAPTURED kalmaz
 *     (kesin kontrol: scripts/load-assert.ts `capturedOnOpenPlan`/`settledMismatch`).
 *
 * Kullanım (docker-compose.load.yml yığını; LOAD_ROOMS `npm run load:seed` çıktısıdır):
 *   docker run --rm -i --network <proj>_default -e BASE_URL=http://app:3000 \
 *     -e LOAD_ACCOUNTS=120 -e LOAD_ROOMS=<p:r,...> -e DAY_OFFSET=30 grafana/k6 run - < load/split-payment-race.js
 *
 * Ortam: BASE_URL, LOAD_ACCOUNTS (load-NNN@load.test hesap sayısı, ≥ 60), PASSWORD, LOAD_ROOMS,
 *   DAY_OFFSET (varsayılan 30), RACE_VUS (10), RACE_ITERATIONS (5, VU başına), RACERS (4),
 *   DEADLINE_PLANS (20; 0 → senaryo kapalı), OFFSET_MS (4000), SETTLE_WAIT_S (75).
 */
import http from "k6/http";
import { check, fail, sleep } from "k6";
import { Counter, Trend } from "k6/metrics";

const BASE = __ENV.BASE_URL || "http://localhost:3000";
const N_ACCOUNTS = Number(__ENV.LOAD_ACCOUNTS || 120);
const loginPassword = __ENV.PASSWORD || "Password123!"; // seed demo parolası (README)
const ROOMS = (__ENV.LOAD_ROOMS || "")
  .split(",")
  .filter(Boolean)
  .map((p) => ({ propertyId: p.split(":")[0], roomTypeId: p.split(":")[1] }));
const DAY_OFFSET = Number(__ENV.DAY_OFFSET || 30);
const RACE_VUS = Number(__ENV.RACE_VUS || 10);
const RACE_ITERATIONS = Number(__ENV.RACE_ITERATIONS || 5);
const RACERS = Math.max(2, Number(__ENV.RACERS || 4));
const DEADLINE_PLANS = Number(__ENV.DEADLINE_PLANS || 20);
const OFFSET_MS = Number(__ENV.OFFSET_MS || 4000);
const SETTLE_WAIT_S = Number(__ENV.SETTLE_WAIT_S || 75);
const CARD = "tok_mock_ok_424242_4242";

// Hesap bölümleri: [0, RACE_VUS) yarış organizatörleri, sonra deadline organizatörleri +
// ödeyicileri, kalan hesaplar yarışçı havuzu.
const DL_ORG0 = RACE_VUS;
const DL_PAYER0 = DL_ORG0 + DEADLINE_PLANS;
const RACER0 = DL_PAYER0 + DEADLINE_PLANS;

const doubleAuth = new Counter("split_double_authorized");
const raceWinners = new Counter("split_race_winner");
const raceLosers = new Counter("split_race_loser");
const settled = new Counter("split_settled");
const notSettled = new Counter("split_not_settled");
const serverErrors = new Counter("split_5xx");
const dlPaid = new Counter("deadline_paid_200");
const dlRejected = new Counter("deadline_rejected");
const dlInconsistent = new Counter("deadline_inconsistent");
const dlFinalSettled = new Counter("deadline_final_settled");
const dlFinalClosed = new Counter("deadline_final_closed");
const payLatency = new Trend("share_pay_duration", true);

const scenarios = {
  share_race: {
    executor: "per-vu-iterations",
    exec: "shareRace",
    vus: RACE_VUS,
    iterations: RACE_ITERATIONS,
    maxDuration: "5m",
  },
};
if (DEADLINE_PLANS > 0) {
  scenarios.deadline_race = {
    executor: "per-vu-iterations",
    exec: "deadlineRace",
    vus: DEADLINE_PLANS,
    iterations: 1,
    maxDuration: "12m",
  };
}

export const options = {
  setupTimeout: "6m",
  scenarios,
  thresholds: {
    split_double_authorized: ["count==0"],
    split_5xx: ["count==0"],
    deadline_inconsistent: ["count==0"],
    split_not_settled: ["count==0"],
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
function note(res) {
  if (res.status >= 500) serverErrors.add(1);
  return res;
}
function tokenFromUrl(url) {
  return url.split("/pay/share/")[1];
}

function loginAll(count) {
  const tokens = [];
  for (let start = 0; start < count; start += 20) {
    const reqs = [];
    for (let i = start; i < Math.min(count, start + 20); i++) {
      reqs.push([
        "POST",
        `${BASE}/api/auth/login`,
        JSON.stringify({ email: email(i), password: loginPassword }),
        { headers: { "content-type": "application/json" } },
      ]);
    }
    for (const res of http.batch(reqs)) {
      if (res.status !== 200) fail(`login başarısız: ${res.status} ${res.body}`);
      tokens.push(res.json("accessToken"));
    }
  }
  return tokens;
}

function clearCart(token) {
  const res = note(
    http.get(`${BASE}/api/cart`, { headers: hdr(token), tags: { name: "cart_get" } })
  );
  const cart = res.status === 200 ? res.json("cart") : null;
  if (cart) note(http.del(`${BASE}/api/cart/${cart.id}`, null, { headers: hdr(token) }));
}

/** Tek kalemli sepet → tutma → eşit bölünmüş plan. Başarısızsa null. */
function planFor(token, participants, dayOffset) {
  clearCart(token);
  const room = ROOMS[Math.floor(Math.random() * ROOMS.length)];
  const add = note(
    http.post(
      `${BASE}/api/cart/items`,
      JSON.stringify({
        propertyId: room.propertyId,
        roomTypeId: room.roomTypeId,
        checkIn: isoDay(dayOffset),
        checkOut: isoDay(dayOffset + 1),
        adults: 1,
        children: 0,
        quantity: 1,
      }),
      { headers: hdr(token), tags: { name: "cart_add" } }
    )
  );
  if (add.status !== 201) return null;
  const cartId = add.json("cart.id");
  const hold = note(
    http.post(`${BASE}/api/cart/${cartId}/hold`, "{}", {
      headers: hdr(token, { "idempotency-key": `k6-split-hold-${cartId}` }),
      tags: { name: "cart_hold" },
    })
  );
  if (hold.status !== 200) return null;
  const split = note(
    http.post(
      `${BASE}/api/cart/${cartId}/split`,
      JSON.stringify({ mode: "equal", participants: participants.map(() => ({ email: null })) }),
      { headers: hdr(token), tags: { name: "split_create" } }
    )
  );
  if (split.status !== 201) {
    console.warn(`split kurulamadı: ${split.status} ${split.body}`);
    return null;
  }
  return { cartId, plan: split.json("plan") };
}

function payShare(token, shareToken, key) {
  const res = note(
    http.post(`${BASE}/api/pay/share/${shareToken}`, JSON.stringify({ cardToken: CARD }), {
      headers: hdr(token, { "idempotency-key": key }),
      tags: { name: "share_pay" },
    })
  );
  payLatency.add(res.timings.duration);
  if (res.status === 202) {
    // Risk motoru 3DS isterse demo kodu ile onayla.
    return note(
      http.post(`${BASE}/api/pay/share/${shareToken}/confirm`, JSON.stringify({ code: "123456" }), {
        headers: hdr(token),
        tags: { name: "share_confirm" },
      })
    );
  }
  return res;
}

export function setup() {
  if (ROOMS.length === 0) fail("LOAD_ROOMS gerekli (npm run load:seed çıktısı)");
  if (N_ACCOUNTS < RACER0 + RACERS) fail(`LOAD_ACCOUNTS en az ${RACER0 + RACERS} olmalı`);
  const tokens = loginAll(N_ACCOUNTS);
  const deadlinePlans = [];
  for (let i = 0; i < DEADLINE_PLANS; i++) {
    const org = tokens[DL_ORG0 + i];
    const made = planFor(org, [null], DAY_OFFSET + 200 + (i % 60));
    if (!made) continue;
    const own = made.plan.shares.find((s) => s.isOrganizer);
    const open = made.plan.shares.find((s) => !s.isOrganizer);
    const res = payShare(org, tokenFromUrl(own.inviteUrl), `k6-dl-org-${made.plan.id}`);
    if (res.status !== 200) continue;
    deadlinePlans.push({
      cartId: made.cartId,
      planId: made.plan.id,
      deadlineAt: Date.parse(made.plan.deadlineAt),
      share: tokenFromUrl(open.inviteUrl),
      org,
      payer: tokens[DL_PAYER0 + i],
    });
  }
  console.log(
    `split-race: ${tokens.length} hesap, ${ROOMS.length} oda tipi, ${deadlinePlans.length} deadline planı`
  );
  return { tokens, deadlinePlans };
}

export function shareRace(data) {
  const org = data.tokens[__VU - 1];
  const made = planFor(org, [null, null], DAY_OFFSET + ((__VU * 7 + __ITER) % 150));
  if (!made) return;
  const shares = made.plan.shares;
  const contested = shares.find((s) => !s.isOrganizer);
  const other = shares.find((s) => !s.isOrganizer && s.id !== contested.id);
  const own = shares.find((s) => s.isOrganizer);
  const pool = data.tokens.length - RACER0;
  const racers = [];
  for (let r = 0; r < RACERS; r++) {
    racers.push(data.tokens[RACER0 + ((__VU * 13 + __ITER * RACERS + r) % pool)]);
  }
  const shareToken = tokenFromUrl(contested.inviteUrl);
  const responses = http.batch(
    racers.map((t, r) => [
      "POST",
      `${BASE}/api/pay/share/${shareToken}`,
      JSON.stringify({ cardToken: CARD }),
      {
        headers: hdr(t, { "idempotency-key": `k6-race-${made.plan.id}-${r}` }),
        tags: { name: "share_pay_race" },
      },
    ])
  );
  let winners = 0;
  let winner = -1;
  responses.forEach((res, r) => {
    note(res);
    payLatency.add(res.timings.duration);
    if (res.status === 200 || res.status === 202) {
      winners++;
      winner = r;
    } else raceLosers.add(1);
  });
  check(null, { "aynı paya tek yetkilendirme": () => winners <= 1 });
  if (winners > 1) doubleAuth.add(winners - 1);
  if (winners === 1) raceWinners.add(1);
  if (winner >= 0 && responses[winner].status === 202) {
    note(
      http.post(`${BASE}/api/pay/share/${shareToken}/confirm`, JSON.stringify({ code: "123456" }), {
        headers: hdr(racers[winner]),
      })
    );
  }
  // Kalan pay (farklı hesap) + organizatör payı → son ödeme tümünü tahsil eder.
  payShare(racers[(winner + 1) % RACERS], tokenFromUrl(other.inviteUrl), `k6-o-${made.plan.id}`);
  const last = payShare(org, tokenFromUrl(own.inviteUrl), `k6-org-${made.plan.id}`);
  const final = note(http.get(`${BASE}/api/cart/${made.cartId}/split`, { headers: hdr(org) }));
  const status = final.status === 200 ? final.json("plan.status") : null;
  if (status === "SETTLED") settled.add(1);
  else {
    notSettled.add(1);
    console.warn(`plan ${made.plan.id} SETTLED değil: ${status} (son ödeme ${last.status})`);
  }
}

export function deadlineRace(data) {
  const plan = data.deadlinePlans[__VU - 1];
  if (!plan) return;
  // VU'ları süre sonunun [-OFFSET_MS, +OFFSET_MS] aralığına yay.
  const n = Math.max(1, data.deadlinePlans.length - 1);
  const offset = -OFFSET_MS + Math.round((2 * OFFSET_MS * (__VU - 1)) / n);
  const waitMs = plan.deadlineAt + offset - Date.now();
  if (waitMs > 0) sleep(waitMs / 1000);
  const res = payShare(plan.payer, plan.share, `k6-dl-${plan.planId}`);
  const paid = res.status === 200;
  if (paid) dlPaid.add(1);
  else dlRejected.add(1);
  // Süre sonu işi + süpürücü (dakikalık) işini bitirsin.
  sleep(Math.max(0, (plan.deadlineAt + SETTLE_WAIT_S * 1000 - Date.now()) / 1000));
  const final = note(http.get(`${BASE}/api/cart/${plan.cartId}/split`, { headers: hdr(plan.org) }));
  const status = final.status === 200 ? final.json("plan.status") : null;
  if (status === "SETTLED") dlFinalSettled.add(1);
  else dlFinalClosed.add(1);
  const consistent = paid ? status === "SETTLED" : status !== "SETTLED";
  if (!consistent) {
    dlInconsistent.add(1);
    console.warn(
      `deadline tutarsız: plan ${plan.planId} offset ${offset}ms → ödeme ${res.status}, son durum ${status}`
    );
  }
}
