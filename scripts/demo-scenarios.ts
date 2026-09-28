/**
 * P2-2 demo senaryoları.
 *
 *  - v3 (1–7): ÇALIŞAN yığına HTTP ile karşı uçtan uca doğrulama.
 *  - v4 (8–14): süreç içi servis çağrıları (`scripts/demo/v4-scenarios.ts`) — grup sepeti +
 *    bölünmüş ödeme, hasar talebi + depozito, 7565 kaldırma + SLA, ajan mandate'i, devir
 *    capture hatası, cüzdan (cashback → kredi → iptal); her biri sonunda mizan + mutabakat denetimi. `DATABASE_URL`,
 *    `REDIS_URL` ve `DEMO_MODE=true` gerekir (MockPsp, LLM yok → anahtarsız).
 *
 *   npm run demo:scenarios                 # hepsi
 *   npm run demo:scenarios -- --only=1     # tek senaryo (virgülle birden çok: --only=2,4)
 *   npm run demo:scenarios -- --suite=v4   # yalnız v3 | v4
 *
 * Ortam: BASE_URL (varsayılan http://localhost:3000), DAY_OFFSET (bugünden kaç gün sonra;
 * yoksa 150–339 arası rastgele → tekrar çalıştırmalar birbirinin envanterine çarpmaz).
 * Hesaplar seed'dekilerdir (guest/host@booking.test, parola Password123!).
 *
 * Tutarlar her yerde tamsayı minor-unit'tir (kuruş); API yalnız `*Minor` alanları döner
 * (`totalPriceMinor`, `payment.amountMinor`; ADR 0033).
 *
 * Önkoşul: senaryo 1 tek kullanıcıdan 100 eşzamanlı rezervasyon ister → varsayılan
 * `RATE_LIMIT_BOOKING_MAX=30` ile 429 alınır. Yükseltilmiş limitlerle çalıştırın
 * (bkz. docs/DEMO_SCRIPT.md → "Demo senaryoları (P2-2)").
 */
import { randomBytes } from "node:crypto";
import {
  computeRefund,
  parseSnapshot,
  type PolicySnapshot,
  type RefundDecision,
} from "../src/lib/booking/cancellation";
import { assertCurrency } from "../src/lib/money/money";
import { clockOf, parseIsoDate } from "../src/lib/time/nights";
import { loadEnv } from "../src/lib/config/load-env";

loadEnv();

// ---------------------------------------------------------------------------
// Ayarlar
// ---------------------------------------------------------------------------

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const loginPassword = "Password123!"; // seed demo parolası (README)
const GUEST = "guest@booking.test";
const HOST = "host@booking.test";
/** prisma/seed.ts → UNLICENSED_DEMO_TITLE ile birebir aynı olmalı. */
const UNLICENSED_DEMO_TITLE = "Kadıköy Moda Sahil Dairesi (belge bekliyor)";
const MOCK_3DS_CODE = "123456";
const RUN_ID = randomBytes(4).toString("hex");

const DAY_OFFSET = (() => {
  const raw = process.env.DAY_OFFSET;
  if (raw !== undefined && raw !== "") {
    const n = Number(raw);
    // Envanter ufku 365 gün; en uzun senaryo ofset+22'ye kadar gider.
    if (!Number.isInteger(n) || n < 1 || n > 340) {
      throw new Error(`DAY_OFFSET 1..340 arası tamsayı olmalı (verilen: ${raw})`);
    }
    return n;
  }
  return 150 + Math.floor(Math.random() * 190);
})();

const ONLY: Set<number> | null = (() => {
  const arg = process.argv.find((a) => a.startsWith("--only="));
  if (!arg) return null;
  const ids = arg
    .slice("--only=".length)
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 14);
  if (ids.length === 0) throw new Error(`Geçersiz --only değeri: ${arg} (1..14)`);
  return new Set(ids);
})();

const SUITE: "v3" | "v4" | null = (() => {
  const arg = process.argv.find((a) => a.startsWith("--suite="));
  if (!arg) return null;
  const v = arg.slice("--suite=".length);
  if (v !== "v3" && v !== "v4") throw new Error(`Geçersiz --suite değeri: ${v} (v3|v4)`);
  return v;
})();

// ---------------------------------------------------------------------------
// HTTP yardımcıları (zod'suz, çıplak fetch)
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

interface ApiResponse<T = Json> {
  status: number;
  json: T;
}

let rateLimited = 0;
let networkRetries = 0;

/** fetch hatalarında asıl nedeni (undici `cause`) de gösterir. */
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = (error as Error & { cause?: unknown }).cause;
  const causeText =
    cause instanceof Error
      ? `${(cause as Error & { code?: string }).code ?? cause.name}: ${cause.message}`
      : "";
  return causeText ? `${error.message} (${causeText})` : error.message;
}

async function api<T = Json>(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {}
): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = { accept: "application/json", ...opts.headers };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  // Docker Desktop port yönlendiricisi (Windows/macOS) çok sayıda eşzamanlı bağlantıda
  // soketi ECONNRESET ile kesebilir; sunucu isteği yine işler. Yalnızca tekrarı güvenli
  // istekler (GET veya idempotency-key taşıyan) yeniden denenir — aynı anahtar aynı kaydı
  // döndürdüğü için sonuç değişmez.
  const retryable = method === "GET" || "idempotency-key" in headers;
  const init = {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  };
  let res: Response;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetch(`${BASE_URL}${path}`, init);
      break;
    } catch (error) {
      if (!retryable || attempt >= 2) throw error;
      networkRetries++;
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  if (res.status === 429) rateLimited++;
  const text = await res.text();
  let json: unknown = {};
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text.slice(0, 200) };
    }
  }
  return { status: res.status, json: json as T };
}

function codeOf(r: ApiResponse<unknown>): string {
  const j = r.json as { code?: unknown; error?: unknown };
  return typeof j.code === "string" ? j.code : typeof j.error === "string" ? j.error : "?";
}

function describe(r: ApiResponse<unknown>): string {
  return `HTTP ${r.status} ${codeOf(r)}`;
}

/** Erişim belirteci 5 dk yaşar; 4 dk'dan eskiyse yeniden giriş (hesap başı giriş limiti 10/dk). */
const tokens = new Map<string, { token: string; at: number }>();

async function tokenFor(email: string): Promise<string> {
  const cached = tokens.get(email);
  if (cached && Date.now() - cached.at < 240_000) return cached.token;
  const r = await api<{ accessToken?: string }>("POST", "/api/auth/login", {
    body: { email, password: loginPassword },
  });
  if (r.status !== 200 || !r.json.accessToken) {
    throw new Error(`Giriş başarısız (${email}): ${describe(r)}`);
  }
  tokens.set(email, { token: r.json.accessToken, at: Date.now() });
  return r.json.accessToken;
}

// ---------------------------------------------------------------------------
// Tarih yardımcıları (UTC takvim günü; tesis "bugün"ünden çok ileride)
// ---------------------------------------------------------------------------

function isoDay(offset: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

function stay(startOffset: number, nights: number): { checkIn: string; checkOut: string } {
  return { checkIn: isoDay(startOffset), checkOut: isoDay(startOffset + nights) };
}

function fmtMinor(minor: number, currency: string): string {
  return `${minor} ${currency} minor`;
}

// ---------------------------------------------------------------------------
// Alan yardımcıları
// ---------------------------------------------------------------------------

interface HostRoom {
  id: string;
  name: string;
  maxOccupancy: number;
  units: number;
}

interface HostProperty {
  id: string;
  title: string;
  isActive: boolean;
  licenseStatus: string;
  licenseNumber: string | null;
  rooms: HostRoom[];
}

let hostListing: HostProperty[] | null = null;

/** Ev sahibi görünümü: seed'deki tüm ilanlar host@booking.test'e aittir. */
async function hostProperties(): Promise<HostProperty[]> {
  if (hostListing) return hostListing;
  const r = await api<HostProperty[]>("GET", "/api/host/properties", {
    token: await tokenFor(HOST),
  });
  if (r.status !== 200 || !Array.isArray(r.json)) {
    throw new Error(`Ev sahibi ilanları alınamadı: ${describe(r)}`);
  }
  hostListing = r.json;
  return hostListing;
}

async function findRoom(
  titlePart: string,
  roomName: string
): Promise<{ property: HostProperty; room: HostRoom }> {
  const property = (await hostProperties()).find((p) => p.title.includes(titlePart));
  if (!property) throw new Error(`Seed ilanı bulunamadı: "${titlePart}" (npm run demo:reset?)`);
  const room = property.rooms.find((r) => r.name === roomName);
  if (!room) throw new Error(`Oda bulunamadı: ${property.title} / ${roomName}`);
  return { property, room };
}

interface BookingDto {
  id: string;
  status: string;
  totalMinor: number;
  currency: string;
}

async function hold(
  token: string,
  property: HostProperty,
  room: HostRoom,
  dates: { checkIn: string; checkOut: string },
  idempotencyKey: string
): Promise<ApiResponse<{ booking?: BookingDto; paymentRequired?: boolean }>> {
  return api("POST", "/api/bookings", {
    token,
    headers: { "idempotency-key": idempotencyKey },
    body: {
      propertyId: property.id,
      roomId: room.id,
      ...dates,
      guestCount: Math.min(2, room.maxOccupancy),
    },
  });
}

/** Mock kart belirteci; son 4 hane rastgele → kart hız kuralına (5/saat) takılmaz. */
function mockCard(): string {
  return `tok_mock_ok_${String(1000 + Math.floor(Math.random() * 9000))}`;
}

interface PayBody {
  status?: string;
  paymentId?: string;
  amount?: number;
  currency?: string;
  code?: string;
}

/**
 * Ödeme; dolandırıcılık skoru 3DS isterse (tekrar çalıştırmalarda hız kuralı) mock
 * 3DS koduyla onaylar. Sonuç: son yanıt.
 */
async function payAndConfirm(token: string, bookingId: string): Promise<ApiResponse<PayBody>> {
  const r = await api<PayBody>("POST", `/api/bookings/${bookingId}/pay`, {
    token,
    headers: { "idempotency-key": `demo-pay-${RUN_ID}-${bookingId}` },
    body: { cardToken: mockCard() },
  });
  if (r.status === 202 && r.json.status === "requires_action") {
    return api<PayBody>("POST", `/api/bookings/${bookingId}/pay/confirm`, {
      token,
      body: { code: MOCK_3DS_CODE },
    });
  }
  return r;
}

interface BookingRow {
  id: string;
  status: string;
  checkIn: string;
  createdAt: string;
  currency: string;
  totalPriceMinor: number;
  policySnapshot: unknown;
  property: { timeZone?: string | null; checkInTime?: string | null; checkOutTime?: string | null };
  payment: { id: string; status: string; amountMinor: number } | null;
}

async function getBooking(token: string, id: string): Promise<BookingRow> {
  const r = await api<{ booking?: BookingRow }>("GET", `/api/bookings/${id}`, { token });
  if (r.status !== 200 || !r.json.booking) {
    throw new Error(`Rezervasyon okunamadı (${id}): ${describe(r)}`);
  }
  return r.json.booking;
}

/** Senaryo artığı HELD rezervasyonları bırakmamak için (iade yok: "not_paid"). */
async function cancelQuietly(token: string, ids: readonly string[]): Promise<void> {
  await Promise.all(
    ids.map((id) => api("DELETE", `/api/bookings/${id}`, { token }).catch(() => undefined))
  );
}

interface TaxLine {
  code: string;
  kind: string;
  label: string;
  rateBps?: number;
  amount: number;
  inclusive: boolean;
}

interface QuoteBody {
  quoteId: string;
  currency: string;
  ratePlan: { id: string; priceModifierBps: number };
  nights: { date: string; amount: number }[];
  subtotal: number;
  fees: TaxLine[];
  taxes: TaxLine[];
  total: number;
}

async function quote(
  property: { id: string },
  room: { id: string },
  dates: { checkIn: string; checkOut: string },
  guests = 2
): Promise<ApiResponse<QuoteBody>> {
  const q = new URLSearchParams({
    propertyId: property.id,
    roomId: room.id,
    checkIn: dates.checkIn,
    checkOut: dates.checkOut,
    guests: String(guests),
  });
  return api<QuoteBody>("GET", `/api/quote?${q.toString()}`);
}

// ---------------------------------------------------------------------------
// Senaryolar
// ---------------------------------------------------------------------------

interface Outcome {
  ok: boolean;
  detail: string;
}

/** 1) 3 birimlik oda, aynı tarihler, 100 paralel istek → tam 3 HELD, kalanı 409. */
async function scenario1(): Promise<Outcome> {
  const token = await tokenFor(GUEST);
  const { property, room } = await findRoom("Sultanahmet Pansiyon", "Standart Oda");
  const dates = stay(DAY_OFFSET, 2);
  const N = 100;

  // Her istek AYRI idempotency anahtarı taşır: aynı anahtar (userId, key) aynı rezervasyonu
  // döndürür ve yarışı ölçmez.
  const results = await Promise.all(
    Array.from({ length: N }, (_, i) =>
      hold(token, property, room, dates, `demo-s1-${RUN_ID}-${i}`)
    )
  );

  const held = results.filter((r) => r.status === 201 && r.json.booking?.status === "HELD");
  const heldIds = new Set(held.map((r) => r.json.booking!.id));
  const conflicts = results.filter(
    (r) => r.status === 409 && ["SOLD_OUT", "ROOM_BUSY"].includes(codeOf(r))
  );
  const soldOut = conflicts.filter((r) => codeOf(r) === "SOLD_OUT").length;
  const busy = conflicts.length - soldOut;
  const other = results.filter((r) => !held.includes(r) && !conflicts.includes(r));
  const otherSummary = [...new Set(other.map(describe))].join(", ");

  // İdempotency: kazanan anahtarlardan biri tekrarlanırsa aynı rezervasyon döner.
  let replayOk = true;
  const firstWinner = results.findIndex((r) => held.includes(r));
  if (firstWinner >= 0) {
    const replay = await hold(token, property, room, dates, `demo-s1-${RUN_ID}-${firstWinner}`);
    replayOk = replay.json.booking?.id === results[firstWinner].json.booking?.id;
  }

  await cancelQuietly(token, [...heldIds]);

  const ok =
    room.units === 3 &&
    held.length === 3 &&
    heldIds.size === 3 &&
    conflicts.length === N - 3 &&
    replayOk;
  return {
    ok,
    detail:
      `${property.title} / ${room.name} (birim=${room.units}) ${dates.checkIn}→${dates.checkOut}: ` +
      `${N} istek → HELD=${held.length}, 409 SOLD_OUT=${soldOut}, 409 ROOM_BUSY=${busy}` +
      (other.length ? `, diğer=${other.length} [${otherSummary}]` : "") +
      `; idempotency tekrarı aynı kaydı döndü=${replayOk ? "evet" : "HAYIR"}`,
  };
}

/** 2) İki sekmeden eşzamanlı ödeme → tek tahsilat. */
async function scenario2(): Promise<Outcome> {
  const token = await tokenFor(GUEST);
  const { property, room } = await findRoom("Sultanahmet Pansiyon", "Terash Manzaralı");
  const dates = stay(DAY_OFFSET + 5, 2);
  const h = await hold(token, property, room, dates, `demo-s2-${RUN_ID}`);
  const booking = h.json.booking;
  if (h.status !== 201 || !booking) return { ok: false, detail: `hold alınamadı: ${describe(h)}` };

  // İki "sekme": farklı idempotency anahtarı, farklı istek — aynı rezervasyon.
  const tabs = await Promise.all(
    ["a", "b"].map((tab) =>
      api<PayBody>("POST", `/api/bookings/${booking.id}/pay`, {
        token,
        headers: { "idempotency-key": `demo-s2-${RUN_ID}-tab-${tab}` },
        body: { cardToken: mockCard() },
      })
    )
  );
  let confirmed = tabs.filter((r) => r.status === 200 && r.json.status === "confirmed");
  let challenged = false;
  if (confirmed.length === 0 && tabs.some((r) => r.status === 202)) {
    // Skor 3DS istediyse tek bir onay yeterli olmalı.
    challenged = true;
    const c = await api<PayBody>("POST", `/api/bookings/${booking.id}/pay/confirm`, {
      token,
      body: { code: MOCK_3DS_CODE },
    });
    if (c.status === 200 && c.json.status === "confirmed") confirmed = [c];
  }
  const acceptableLoser = (r: ApiResponse<PayBody>) =>
    (r.status === 200 && r.json.status === "confirmed") ||
    r.status === 202 ||
    (r.status === 409 && ["PAYMENT_IN_PROGRESS", "ALREADY_PAID"].includes(codeOf(r)));

  const row = await getBooking(token, booking.id);
  const currency = assertCurrency(row.currency);
  const bookingMinor = row.totalPriceMinor;
  const paidMinor = row.payment ? row.payment.amountMinor : 0;
  const paymentIds = new Set(confirmed.map((r) => r.json.paymentId));
  const ok =
    confirmed.length >= 1 &&
    paymentIds.size === 1 &&
    row.status === "CONFIRMED" &&
    row.payment?.status === "PAID" &&
    paidMinor === bookingMinor &&
    booking.totalMinor === bookingMinor &&
    confirmed.every((r) => r.json.amount === undefined || r.json.amount === bookingMinor) &&
    tabs.every(acceptableLoser);

  return {
    ok,
    detail:
      `sekmeler: [${tabs.map(describe).join(" | ")}]${challenged ? " + 3DS onayı" : ""}; ` +
      `ödeme kaydı=1 (Booking↔Payment 1:1), paymentId sayısı=${paymentIds.size}, ` +
      `durum=${row.status}/${row.payment?.status ?? "yok"}, ` +
      `tahsilat=${fmtMinor(paidMinor, currency)}, rezervasyon toplamı=${fmtMinor(bookingMinor, currency)}`,
  };
}

/** 3) İstanbul teklifi: KDV + konaklama vergisi kalemleri, toplam = kalemlerin toplamı. */
async function scenario3(): Promise<Outcome> {
  const { property, room } = await findRoom("Sultanahmet Pansiyon", "Standart Oda");
  const dates = stay(DAY_OFFSET + 20, 2);
  const r = await quote(property, room, dates);
  if (r.status !== 200) return { ok: false, detail: `teklif alınamadı: ${describe(r)}` };
  const q = r.json;
  const lines = [...q.taxes, ...q.fees];
  const vat = q.taxes.find((t) => t.code === "VAT");
  const acc = q.taxes.find((t) => t.code === "ACCOMMODATION_TAX");
  const nightsSum = q.nights.reduce((s, n) => s + n.amount, 0);
  const exclusiveSum = lines.filter((l) => !l.inclusive).reduce((s, l) => s + l.amount, 0);
  const allInts = [
    q.subtotal,
    q.total,
    ...q.nights.map((n) => n.amount),
    ...lines.map((l) => l.amount),
  ].every(Number.isSafeInteger);

  const ok =
    !!vat &&
    vat.inclusive &&
    !!acc &&
    !acc.inclusive &&
    allInts &&
    q.subtotal === nightsSum &&
    q.total === q.subtotal + exclusiveSum;

  const lineText = lines
    .map(
      (l) =>
        `${l.label}${l.rateBps !== undefined ? ` %${l.rateBps / 100}` : ""}${l.inclusive ? " (dahil)" : ""}=${l.amount}`
    )
    .join(", ");
  return {
    ok,
    detail:
      `${property.title} ${dates.checkIn}→${dates.checkOut} [${q.currency} minor]: ` +
      `geceler=${q.nights.map((n) => n.amount).join("+")}=${nightsSum}, ara toplam=${q.subtotal}; ` +
      `${lineText || "vergi kalemi YOK"}; toplam=${q.total} ` +
      `(= ara toplam ${q.subtotal} + hariç kalemler ${exclusiveSum})`,
  };
}

/**
 * 4) Tokyo iade penceresi Asia/Tokyo saatine göre.
 *
 * Kaynak API'dir: DELETE /api/bookings/{id} iadeyi sunucuda tesis saatiyle hesaplar ve
 * `refund.hoursBeforeCheckIn` döndürür. Alan fonksiyonu `computeRefund` YALNIZCA
 * kahin (oracle) olarak içe aktarılır: aynı girdilerle Tokyo saatiyle sonucun API'yle
 * eşleştiğini, İstanbul saatiyle ise 6 saat saptığını gösterir.
 */
async function scenario4(): Promise<Outcome> {
  const token = await tokenFor(GUEST);
  const { property, room } = await findRoom("Tokyo Shibuya", "Özel Kabin");
  const dates = stay(DAY_OFFSET + 3, 1);
  const h = await hold(token, property, room, dates, `demo-s4-${RUN_ID}`);
  const booking = h.json.booking;
  if (h.status !== 201 || !booking) return { ok: false, detail: `hold alınamadı: ${describe(h)}` };
  const paid = await payAndConfirm(token, booking.id);
  if (paid.status !== 200) {
    await cancelQuietly(token, [booking.id]);
    return { ok: false, detail: `ödeme başarısız: ${describe(paid)}` };
  }

  const row = await getBooking(token, booking.id);
  const currency = assertCurrency(row.currency);
  const snapshot: PolicySnapshot = parseSnapshot(row.policySnapshot);
  const input = {
    checkIn: parseIsoDate(row.checkIn.slice(0, 10)),
    createdAt: new Date(row.createdAt),
    paidMinor: row.payment ? row.payment.amountMinor : 0,
    currency,
  };
  const tokyoClock = clockOf(row.property);
  const istanbulClock = clockOf({ ...row.property, timeZone: "Europe/Istanbul" });

  const before = new Date();
  const del = await api<{ refund?: RefundDecision & { currency: string } }>(
    "DELETE",
    `/api/bookings/${booking.id}`,
    { token }
  );
  const after = new Date();
  const refund = del.json.refund;
  if (del.status !== 200 || !refund)
    return { ok: false, detail: `iptal başarısız: ${describe(del)}` };

  const tBefore = computeRefund(snapshot, input, before, tokyoClock);
  const tAfter = computeRefund(snapshot, input, after, tokyoClock);
  const ist = computeRefund(snapshot, input, after, istanbulClock);
  const api_h = refund.hoursBeforeCheckIn;
  const inWindow =
    api_h <= tBefore.hoursBeforeCheckIn + 0.01 && api_h >= tAfter.hoursBeforeCheckIn - 0.01;
  const tzGap = ist.hoursBeforeCheckIn - api_h;

  const ok =
    tokyoClock.timeZone === "Asia/Tokyo" &&
    inWindow &&
    Math.abs(tzGap - 6) < 0.05 &&
    refund.refundPercent === tAfter.refundPercent &&
    refund.refundMinor === tAfter.refundMinor &&
    refund.reason === tAfter.reason;

  return {
    ok,
    detail:
      `${property.title} (tz=${tokyoClock.timeZone}, giriş ${tokyoClock.checkInTime}) ${dates.checkIn}; ` +
      `politika=${snapshot.kind}; API: check-in'e ${api_h} saat, iade %${refund.refundPercent} ` +
      `(${refund.reason}) = ${fmtMinor(refund.refundMinor, currency)} / ödenen ${fmtMinor(input.paidMinor, currency)}; ` +
      `kahin Asia/Tokyo=${tAfter.hoursBeforeCheckIn}…${tBefore.hoursBeforeCheckIn} saat, ` +
      `Europe/Istanbul olsaydı=${ist.hoursBeforeCheckIn} saat (fark ${tzGap.toFixed(2)} saat). ` +
      `Not: iade API'de hesaplanır; computeRefund yalnızca karşılaştırma kahinidir.`,
  };
}

interface McpToolResult {
  isError?: boolean;
  content?: { type: string; text?: string }[];
  structuredContent?: unknown;
}

async function mcpCall(
  token: string | undefined,
  name: string,
  args: Json
): Promise<{ status: number; result?: McpToolResult; data?: Json; error?: unknown }> {
  const r = await api<{ result?: McpToolResult; error?: unknown }>("POST", "/api/mcp", {
    token,
    headers: { accept: "application/json, text/event-stream" },
    body: {
      jsonrpc: "2.0",
      id: `${name}-${RUN_ID}-${Math.random().toString(36).slice(2, 8)}`,
      method: "tools/call",
      params: { name, arguments: args },
    },
  });
  const result = r.json.result;
  let data: Json | undefined;
  const text = result?.content?.find((c) => c.type === "text")?.text;
  if (text) {
    try {
      data = JSON.parse(text) as Json;
    } catch {
      data = undefined;
    }
  }
  return { status: r.status, result, data, error: r.json.error };
}

/** 5) MCP (JSON-RPC /api/mcp): kimliksiz 401; search_stays → create_hold → HELD. */
async function scenario5(): Promise<Outcome> {
  const anon = await mcpCall(undefined, "search_stays", { city: "İstanbul" });
  const anonCode = (anon.error as { code?: number } | undefined)?.code;

  const token = await tokenFor(GUEST);
  const dates = stay(DAY_OFFSET + 8, 2);
  const search = await mcpCall(token, "search_stays", {
    city: "İstanbul",
    ...dates,
    guests: 2,
    pageSize: 10,
  });
  if (search.status !== 200 || search.result?.isError || !search.data) {
    return {
      ok: false,
      detail: `kimliksiz=${anon.status}/${anonCode ?? "-"}; search_stays başarısız: HTTP ${search.status} ${JSON.stringify(search.error ?? search.data ?? {}).slice(0, 160)}`,
    };
  }
  const results = (search.data.results ?? []) as {
    propertyId: string;
    title: string;
    quote: { roomId?: string; total?: number; currency?: string } | null;
  }[];
  const candidates = results.filter((r) => r.quote?.roomId);

  // 1 birimli odalar önceki çalıştırmalarca tutulmuş olabilir → birkaç aday dene.
  let heldInfo: {
    title: string;
    id: string;
    status: string;
    totalMinor: number;
    currency: string;
  } | null = null;
  const attempts: string[] = [];
  for (const c of candidates.slice(0, 5)) {
    const holdRes = await mcpCall(token, "create_hold", {
      propertyId: c.propertyId,
      roomId: c.quote!.roomId!,
      ...dates,
      guests: 2,
      idempotencyKey: `demo-s5-${RUN_ID}-${c.propertyId}`,
    });
    const b = holdRes.data?.booking as BookingDto | undefined;
    if (!holdRes.result?.isError && b?.status === "HELD") {
      heldInfo = { title: c.title, ...b };
      break;
    }
    attempts.push(`${c.title}: ${String(holdRes.data?.code ?? holdRes.status)}`);
  }
  if (heldInfo) await cancelQuietly(token, [heldInfo.id]);

  const ok = anon.status === 401 && anonCode === -32001 && heldInfo !== null;
  return {
    ok,
    detail:
      `kimliksiz çağrı → HTTP ${anon.status} (JSON-RPC ${anonCode ?? "-"}); ` +
      `search_stays toplam=${String(search.data.total)}, teklifli sonuç=${candidates.length}; ` +
      (heldInfo
        ? `create_hold → ${heldInfo.status} (${heldInfo.title}, ${fmtMinor(heldInfo.totalMinor, heldInfo.currency)})`
        : `create_hold HELD üretmedi [${attempts.join("; ") || "aday yok"}]`),
  };
}

interface Suggestion {
  id: string;
  roomId: string;
  date: string;
  currency: string;
  currentMinor: number;
  suggestedMinor: number;
  status: string;
}

/** 6) Ev sahibi fiyat önerisini kabul eder → aynı gecenin teklif fiyatı değişir. */
async function scenario6(): Promise<Outcome> {
  const token = await tokenFor(HOST);
  const { property, room } = await findRoom("Galata Loft", "Loft");
  const gen = await api<{ suggestions?: Suggestion[] }>("POST", "/api/host/revenue/suggestions", {
    token,
    body: { roomId: room.id },
  });
  if (gen.status !== 201 || !gen.json.suggestions) {
    return { ok: false, detail: `öneri üretilemedi: ${describe(gen)}` };
  }
  const changing = gen.json.suggestions.filter(
    (s) => s.status === "PENDING" && s.suggestedMinor !== s.currentMinor
  );
  const skipped: string[] = [];
  for (const s of changing) {
    const dates = { checkIn: s.date, checkOut: isoDayAfter(s.date) };
    const before = await quote(property, room, dates);
    if (before.status !== 200) {
      skipped.push(`${s.date}: ${describe(before)}`);
      continue;
    }
    const acc = await api("POST", `/api/host/revenue/suggestions/${s.id}/accept`, { token });
    if (acc.status !== 200 && acc.status !== 201) {
      return { ok: false, detail: `öneri kabul edilemedi (${s.date}): ${describe(acc)}` };
    }
    const after = await quote(property, room, dates);
    if (after.status !== 200)
      return { ok: false, detail: `kabul sonrası teklif: ${describe(after)}` };

    const b = before.json.nights[0].amount;
    const a = after.json.nights[0].amount;
    const expectedDelta = s.suggestedMinor - s.currentMinor;
    const exact = before.json.ratePlan.priceModifierBps === 0;
    const ok =
      a !== b &&
      Math.sign(a - b) === Math.sign(expectedDelta) &&
      (!exact || a - b === expectedDelta);
    return {
      ok,
      detail:
        `${property.title} / ${room.name} ${s.date} [${s.currency} minor]: öneri ${s.currentMinor}→${s.suggestedMinor} ` +
        `(Δ${expectedDelta}); teklif gecesi ${b}→${a} (Δ${a - b})` +
        `${exact ? "" : `, plan bps=${before.json.ratePlan.priceModifierBps} → yalnızca yön karşılaştırıldı`}; ` +
        `teklif toplamı ${before.json.total}→${after.json.total}` +
        (skipped.length ? `; atlanan gece=${skipped.length}` : ""),
    };
  }
  return {
    ok: false,
    detail:
      `uygulanabilir öneri yok: üretilen=${gen.json.suggestions.length}, fiyatı değiştiren=${changing.length}` +
      (skipped.length ? `, teklif alınamayan=[${skipped.slice(0, 3).join("; ")}]` : ""),
  };
}

function isoDayAfter(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** 7) İzin belgesi doğrulanmamış ilan aramada YOK, ev sahibi panelinde VAR. */
async function scenario7(): Promise<Outcome> {
  const listing = (await hostProperties()).find((p) => p.title === UNLICENSED_DEMO_TITLE);
  if (!listing) {
    return {
      ok: false,
      detail: `ev sahibi panelinde "${UNLICENSED_DEMO_TITLE}" yok — seed güncel değil (npm run demo:reset)`,
    };
  }
  const dates = stay(DAY_OFFSET + 15, 2);
  const queries = [
    new URLSearchParams({ destination: "Moda", pageSize: "50" }),
    new URLSearchParams({ destination: "Kadıköy", ...dates, guests: "2", pageSize: "50" }),
    new URLSearchParams({ destination: "İstanbul", pageSize: "50" }),
  ];
  const checks: string[] = [];
  let leaked = false;
  let failed = false;
  for (const q of queries) {
    const r = await api<{ results?: { id: string }[]; total?: number }>(
      "GET",
      `/api/search?${q.toString()}`
    );
    if (r.status !== 200 || !Array.isArray(r.json.results)) {
      failed = true;
      checks.push(`${q.get("destination")}: ${describe(r)}`);
      continue;
    }
    const found = r.json.results.some((x) => x.id === listing.id);
    leaked ||= found;
    checks.push(
      `"${q.get("destination")}" → ${r.json.total ?? r.json.results.length} sonuç, ilan ${found ? "VAR" : "yok"}`
    );
  }
  const ok = listing.isActive && listing.licenseStatus !== "VERIFIED" && !leaked && !failed;
  return {
    ok,
    detail:
      `ev sahibi paneli: "${listing.title}" (isActive=${listing.isActive}, licenseStatus=${listing.licenseStatus}, ` +
      `belge no=${listing.licenseNumber ?? "yok"}); arama: ${checks.join("; ")}`,
  };
}

// ---------------------------------------------------------------------------
// Koşucu
// ---------------------------------------------------------------------------

const SCENARIOS: { id: number; title: string; run: () => Promise<Outcome> }[] = [
  { id: 1, title: "100 paralel rezervasyon, 3 birim → tam 3 HELD", run: scenario1 },
  { id: 2, title: "İki sekmeden ödeme → tek tahsilat", run: scenario2 },
  { id: 3, title: "İstanbul teklifi: KDV + konaklama vergisi, toplam = kalemler", run: scenario3 },
  { id: 4, title: "Tokyo iade penceresi Asia/Tokyo saatine göre", run: scenario4 },
  { id: 5, title: "MCP search_stays → create_hold (kimlik zorunlu)", run: scenario5 },
  { id: 6, title: "Fiyat önerisi kabulü → teklif fiyatı değişir", run: scenario6 },
  { id: 7, title: "Belgesiz ilan aramada yok, ev sahibi panelinde var", run: scenario7 },
];

interface Row {
  id: number;
  title: string;
  ok: boolean;
  ms: number;
  books: string;
}

function printTable(rows: readonly Row[]): void {
  const head = ["#", "Senaryo", "Sonuç", "ms", "Defter (f)"];
  const body = rows.map((r) => [
    String(r.id),
    r.title,
    r.ok ? "PASS" : "FAIL",
    String(r.ms),
    r.books,
  ]);
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((b) => b[i]!.length)));
  const line = (cells: string[]) => `| ${cells.map((c, i) => c.padEnd(widths[i]!)).join(" | ")} |`;
  console.log("");
  console.log("Özet:");
  console.log(line(head));
  console.log(`|${widths.map((w) => "-".repeat(w + 2)).join("|")}|`);
  for (const b of body) console.log(line(b));
}

async function main(): Promise<void> {
  const wanted = (id: number) =>
    (!ONLY || ONLY.has(id)) && (!SUITE || (SUITE === "v3" ? id <= 7 : id >= 8));
  const v3 = SCENARIOS.filter((s) => wanted(s.id));
  const v4Wanted = [8, 9, 10, 11, 12, 13, 14].some(wanted);
  console.log(
    `Demo senaryoları — BASE_URL=${BASE_URL}, DAY_OFFSET=${DAY_OFFSET}, çalıştırma=${RUN_ID}`
  );
  const rows: Row[] = [];
  const report = (
    id: number,
    title: string,
    ok: boolean,
    ms: number,
    detail: string,
    books = "—"
  ) => {
    rows.push({ id, title, ok, ms, books });
    console.log(`[${ok ? "PASS" : "FAIL"}] Senaryo ${id} — ${title} (${ms} ms)`);
    console.log(`       ${detail}`);
    if (books !== "—") console.log(`       defter: ${books}`);
  };

  for (const s of v3) {
    const started = Date.now();
    let outcome: Outcome;
    try {
      outcome = await s.run();
    } catch (error) {
      outcome = {
        ok: false,
        detail: `hata: ${describeError(error)}`,
      };
    }
    report(s.id, s.title, outcome.ok, Date.now() - started, outcome.detail);
  }

  if (v4Wanted) {
    // Süreç içi modüller (Prisma/Redis) yalnız v4 istenince yüklenir.
    const v4 = await import("./demo/v4-scenarios");
    const problem = v4.prepareV4();
    for (const s of v4.V4_SCENARIOS.filter((x) => wanted(x.id))) {
      const title = `(${s.key}) ${s.title}`;
      if (problem) {
        report(s.id, title, false, 0, `atlandı: ${problem}`);
        continue;
      }
      const started = Date.now();
      const outcome = await v4.runV4Scenario(s);
      report(s.id, title, outcome.ok, Date.now() - started, outcome.detail, outcome.books);
    }
    await v4.closeV4();
  }

  if (networkRetries > 0) {
    console.log(
      `Not: ${networkRetries} istek ağ hatası (ECONNRESET vb.) sonrası güvenle yeniden denendi.`
    );
  }
  if (rateLimited > 0) {
    console.log(
      `Uyarı: ${rateLimited} istek 429 (rate limit) aldı. RATE_LIMIT_BOOKING_MAX / _SEARCH_MAX / ` +
        `_AGENTIC_MAX / _DEFAULT_MAX değerlerini yükseltin (docs/DEMO_SCRIPT.md, P2-2).`
    );
  }
  printTable(rows);
  const failures = rows.filter((r) => !r.ok).length;
  console.log(
    failures === 0
      ? `Sonuç: ${rows.length}/${rows.length} senaryo geçti.`
      : `Sonuç: ${failures}/${rows.length} senaryo BAŞARISIZ.`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(
    "Demo senaryoları çalıştırılamadı:",
    error instanceof Error ? error.message : error
  );
  process.exit(1);
});
