/**
 * P2-2 v4 demo senaryoları — süreç içi (in-process) servis çağrıları.
 *
 * v3 senaryolarından farklı olarak bunlar çalışan HTTP yığınına değil, doğrudan
 * `DATABASE_URL` + `REDIS_URL`'e bağlanır: zaman ileri sarma (SLA, süre sonu, depozito
 * penceresi) ve PSP hata enjeksiyonu (devir capture hatası) HTTP üzerinden yapılamaz.
 * Her senaryo kendi izole verisini kurar ("Demo v4 …" ilanları; bitince pasife alınır),
 * beklenen sonucu ASSERT eder ve sonunda defteri denetler (mizan dengede + ilgili
 * günlerde mutabakat farkı 0).
 *
 * Ödeme her zaman MockPsp'dir (Stripe anahtarı olsa da); LLM çağrısı yoktur → anahtarsız.
 * Yalnızca demo modunda (`DEMO_MODE=true`) çalışır: gerçek bir veritabanına demo verisi
 * yazılmaz.
 */
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import type { AccessClaims } from "@/lib/auth";
import { isDemoMode } from "@/lib/config/demo";
import { createBooking } from "@/lib/booking-service";
import {
  addCartItem,
  confirmShareChallenge,
  createSplitPlan,
  getSplitPlan,
  holdCart,
  payShare,
  processSplitDeadline,
  type ShareOutcome,
  type SplitPlanDTO,
} from "@/lib/cart";
import { receiveTakedown, checkTakedownSla } from "@/lib/compliance/takedown";
import { updateProperty } from "@/lib/host/host-service";
import { signMandate } from "@/lib/agentic/mandate";
import { completeCheckoutSession, createCheckoutSession } from "@/lib/agentic/checkout";
import { confirmPaymentChallenge, payForBooking } from "@/lib/payment/payment-service";
import { MOCK_3DS_CODE } from "@/lib/payment/card-token";
import { setPaymentProviderForTests } from "@/lib/payment";
import { MockPsp } from "@/lib/payment/mock-psp";
import { claimTransfer, listBookingForTransfer } from "@/lib/transfer/transfer-service";
import { isTrialBalanced, reconcile, trialBalance } from "@/lib/ledger";
import { depositWindow, setDepositSetting, sweepDeposits } from "@/lib/resolution/deposit";
import { decideClaim, openClaim } from "@/lib/resolution/claims";
import { releaseAt } from "@/lib/payout/escrow";

export interface V4Outcome {
  ok: boolean;
  detail: string;
  /** (f) defter denetimi özeti — tabloda ayrı sütun. */
  books: string;
}

export interface V4Scenario {
  id: number;
  key: string;
  title: string;
  run: () => Promise<V4Outcome>;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const RUN = randomBytes(3).toString("hex");
let seq = 0;

let prismaClient: PrismaClient | null = null;
function db(): PrismaClient {
  prismaClient ??= new PrismaClient();
  return prismaClient;
}

// ---------------------------------------------------------------------------
// Assert + defter denetimi
// ---------------------------------------------------------------------------

class ScenarioAssertion extends Error {}

function check(cond: unknown, message: string): asserts cond {
  if (!cond) throw new ScenarioAssertion(message);
}

async function expectRejects(
  promise: Promise<unknown>,
  expected: { status?: number; code?: string },
  label: string
): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const e = error as { status?: number; code?: string };
    check(
      (expected.status === undefined || e.status === expected.status) &&
        (expected.code === undefined || e.code === expected.code),
      `${label}: beklenen ${expected.status ?? ""} ${expected.code ?? ""}, gelen ${e.status ?? "?"} ${e.code ?? (error as Error).message}`
    );
    return `${e.status} ${e.code}`;
  }
  throw new ScenarioAssertion(`${label}: hata bekleniyordu, işlem başarılı oldu`);
}

interface Touched {
  payments: Set<string>;
  deposits: Set<string>;
  transfers: Set<string>;
  days: Set<string>;
}

const touched = (): Touched => ({
  payments: new Set(),
  deposits: new Set(),
  transfers: new Set(),
  days: new Set([new Date().toISOString().slice(0, 10)]),
});

/**
 * (f) Mizan tüm defterde dengede; senaryonun dokunduğu her gün için mutabakatta dengesiz
 * jurnal 0 ve senaryonun ödeme/depozito/devir öznelerinde fark 0. Aynı günlerdeki diğer
 * (senaryo dışı) farklar bilgi olarak raporlanır.
 */
async function assertBooks(t: Touched): Promise<string> {
  const prisma = db();
  const balanced = isTrialBalanced(await trialBalance(prisma));
  check(balanced, "mizan dengesiz");
  const mine = new Set([...t.payments, ...t.deposits, ...t.transfers]);
  let mineDiff = 0;
  let otherDiff = 0;
  let checked = 0;
  for (const day of t.days) {
    const report = await reconcile(day, prisma);
    check(report.imbalancedEntries === 0, `${day}: dengesiz jurnal ${report.imbalancedEntries}`);
    checked += report.checked;
    for (const d of report.differences) {
      if (mine.has(d.subjectId)) mineDiff++;
      else otherDiff++;
    }
  }
  check(mineDiff === 0, `mutabakat farkı: ${mineDiff} satır`);
  return (
    `mizan dengede; mutabakat farkı 0 (${t.days.size} gün, ${checked} kontrol, ` +
    `${mine.size} özne)` +
    (otherDiff ? `; senaryo dışı fark=${otherDiff}` : "")
  );
}

// ---------------------------------------------------------------------------
// Fixture'lar
// ---------------------------------------------------------------------------

function utcDay(offset: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offset);
  return d;
}
const iso = (d: Date) => d.toISOString().slice(0, 10);

interface DemoUser {
  id: string;
  email: string;
}

async function demoUser(
  tag: string,
  role: "USER" | "HOST" | "ADMIN" = "USER",
  firstName = "Demo"
): Promise<DemoUser> {
  const u = await db().user.create({
    data: {
      email: `demo-v4-${tag}-${RUN}-${++seq}@demo.test`,
      passwordHash: "x",
      firstName,
      lastName: tag,
      role,
      emailVerifiedAt: new Date(),
    },
  });
  return { id: u.id, email: u.email };
}

interface DemoStay {
  hostId: string;
  propertyId: string;
  roomIds: string[];
}

const createdProperties: string[] = [];

/** Doğrulanmış belgeli, `rooms` oda tipli, 90 günlük envanterli demo ilanı. */
async function demoStay(
  tag: string,
  opts: { rooms?: number; units?: number; nightlyMinor?: bigint; host?: DemoUser } = {}
): Promise<DemoStay> {
  const prisma = db();
  const host = opts.host ?? (await demoUser(`${tag}-host`, "HOST", "Ev Sahibi"));
  const location = await prisma.location.upsert({
    where: { city_country: { city: "Demo Senaryo", country: "Türkiye" } },
    update: {},
    create: { city: "Demo Senaryo", country: "Türkiye", latitude: 41.01, longitude: 28.97 },
  });
  const price = opts.nightlyMinor ?? 150_000n;
  const property = await prisma.property.create({
    data: {
      hostId: host.id,
      title: `Demo v4 ${tag} (${RUN})`,
      description: "P2-2 demo senaryosu için otomatik oluşturuldu.",
      propertyType: "HOTEL",
      locationId: location.id,
      basePriceMinor: price,
      cancellationPolicyId: "policy_flexible_v1",
      licenseStatus: "VERIFIED",
      licenseNumber: `DEMO-${RUN}-${++seq}`,
    },
  });
  createdProperties.push(property.id);
  const roomIds: string[] = [];
  for (let r = 0; r < (opts.rooms ?? 1); r++) {
    const room = await prisma.roomType.create({
      data: {
        propertyId: property.id,
        name: `Oda ${r + 1}`,
        maxOccupancy: 2,
        units: opts.units ?? 2,
        bedType: "Çift",
        ratePlans: { create: [{ code: "STANDARD", name: "Standart", isDefault: true }] },
      },
    });
    await prisma.inventoryDay.createMany({
      data: Array.from({ length: 90 }, (_, i) => ({
        roomTypeId: room.id,
        date: utcDay(i + 1),
        priceMinor: price + BigInt(r) * 10_000n,
        total: opts.units ?? 2,
      })),
    });
    roomIds.push(room.id);
  }
  return { hostId: host.id, propertyId: property.id, roomIds };
}

/** Demo ilanlarını aramada göstermemek için senaryo sonunda pasife alır. */
export async function retireDemoProperties(): Promise<void> {
  if (createdProperties.length === 0) return;
  await db().property.updateMany({
    where: { id: { in: createdProperties } },
    data: { isActive: false },
  });
}

const claimsOf = (userId: string, role: AccessClaims["role"]): AccessClaims => ({
  userId,
  role,
  jti: `demo-${RUN}`,
  exp: 0,
  tv: 0,
});

/** Rastgele son 4 hane → kart hız kuralı tekrar koşularda 3DS/ret üretmez. */
const card = () => `tok_mock_ok_${String(1000 + Math.floor(Math.random() * 9000))}`;
const ctx = () => ({ ip: `10.77.${seq % 250}.${++seq % 250}` });

async function holdAndPay(userId: string, stay: DemoStay, start: number, nights = 2) {
  const { booking } = await createBooking({
    userId,
    propertyId: stay.propertyId,
    roomId: stay.roomIds[0]!,
    checkIn: iso(utcDay(start)),
    checkOut: iso(utcDay(start + nights)),
    guestCount: 1,
  });
  let out = await payForBooking({
    bookingId: booking.id,
    userId,
    cardToken: card(),
    idempotencyKey: `demo-v4-pay-${RUN}-${booking.id}`,
    context: ctx(),
  });
  if (out.status === "requires_action") {
    out = await confirmPaymentChallenge({ bookingId: booking.id, userId, code: MOCK_3DS_CODE });
  }
  check(out.status === "confirmed", `ödeme onaylanmadı: ${out.status}`);
  const payment = await db().payment.findUniqueOrThrow({ where: { bookingId: booking.id } });
  return { booking, payment };
}

// ---------------------------------------------------------------------------
// (a) Grup sepeti + bölünmüş ödeme
// ---------------------------------------------------------------------------

function shareToken(plan: SplitPlanDTO, position: number): string {
  const url = plan.shares.find((s) => s.position === position)?.inviteUrl;
  check(url, `pay ${position} için davet bağlantısı yok`);
  return decodeURIComponent(url.split("/pay/share/")[1]!);
}

async function payShareAs(token: string, user: DemoUser): Promise<ShareOutcome> {
  let out = await payShare({
    token,
    userId: user.id,
    cardToken: card(),
    idempotencyKey: `demo-v4-share-${RUN}-${++seq}`,
    context: ctx(),
  });
  if (out.status === "requires_action") {
    out = await confirmShareChallenge({ token, userId: user.id, code: MOCK_3DS_CODE });
  }
  return out;
}

async function groupCart(tag: string, start: number) {
  const stay = await demoStay(tag, { rooms: 3, units: 1 });
  const organizer = await demoUser(`${tag}-org`, "USER", "Organizatör");
  for (const roomTypeId of stay.roomIds) {
    await addCartItem(organizer.id, {
      propertyId: stay.propertyId,
      roomTypeId,
      checkIn: iso(utcDay(start)),
      checkOut: iso(utcDay(start + 2)),
      adults: 2,
      children: 0,
      quantity: 1,
    });
  }
  const cart = await holdCart(organizer.id);
  check(cart.status === "HELD", `sepet HELD değil: ${cart.status}`);
  check(cart.items.length === 3, `sepette 3 oda bekleniyordu: ${cart.items.length}`);
  const participants = [await demoUser(`${tag}-p1`), await demoUser(`${tag}-p2`)];
  return { stay, organizer, cart, participants };
}

async function cartBooks(cartId: string, t: Touched): Promise<void> {
  const prisma = db();
  const pays = await prisma.payment.findMany({
    where: { booking: { cartId } },
    select: { id: true },
  });
  for (const p of pays) t.payments.add(p.id);
}

async function scenarioSplitAllPay(): Promise<V4Outcome> {
  const t = touched();
  const prisma = db();
  const { organizer, cart, participants } = await groupCart("grup-hepsi", 10);
  const plan = await createSplitPlan({
    cartId: cart.id,
    userId: organizer.id,
    mode: "equal",
    participants: participants.map((p) => ({ email: p.email })),
  });
  const amounts = plan.shares.map((s) => s.amountMinor);
  check(plan.shares.length === 3, "3 pay bekleniyordu");
  check(amounts.reduce((s, x) => s + x, 0) === cart.totalMinor, "paylar toplamı ≠ sepet toplamı");

  const p1 = await payShareAs(shareToken(plan, 1), participants[0]!);
  const p2 = await payShareAs(shareToken(plan, 2), participants[1]!);
  check(p1.status === "authorized" && p2.status === "authorized", "katılımcı payları yetkilenmedi");
  const midCart = await prisma.cart.findUniqueOrThrow({ where: { id: cart.id } });
  check(midCart.status === "HELD", "son pay gelmeden sepet onaylanmamalı");
  const last = await payShareAs(shareToken(plan, 0), organizer);
  check(last.status === "confirmed", `son pay sonrası onay yok: ${last.status}`);

  const done = await prisma.cart.findUniqueOrThrow({
    where: { id: cart.id },
    include: {
      bookings: true,
      payment: { include: { splitPlans: { include: { shares: true } } } },
    },
  });
  check(done.status === "CHECKED_OUT", `sepet durumu ${done.status}`);
  check(done.bookings.length === 3, `3 rezervasyon bekleniyordu: ${done.bookings.length}`);
  check(
    done.bookings.every((b) => b.status === "CONFIRMED"),
    "tüm rezervasyonlar CONFIRMED değil"
  );
  const shares = done.payment!.splitPlans[0]!.shares;
  check(
    shares.every((s) => s.status === "CAPTURED"),
    "tüm paylar CAPTURED değil"
  );
  await cartBooks(cart.id, t);
  return {
    ok: true,
    detail:
      `3 oda sepeti ${cart.totalMinor} ${cart.currency} minor, paylar [${amounts.join(", ")}]; ` +
      `katılımcılar yetkiledi (sepet HELD kaldı) → organizatör son payı ödedi → ` +
      `3 pay CAPTURED, 3 rezervasyon CONFIRMED, sepet ${done.status}`,
    books: await assertBooks(t),
  };
}

async function scenarioSplitFallback(): Promise<V4Outcome> {
  const t = touched();
  const prisma = db();
  const { organizer, cart, participants } = await groupCart("grup-yedek", 20);
  const plan = await createSplitPlan({
    cartId: cart.id,
    userId: organizer.id,
    mode: "equal",
    participants: participants.map((p) => ({ email: p.email })),
  });
  check(plan.fallbackMode === "ORGANIZER_PAYS", `yedek modu ${plan.fallbackMode}`);
  const missingToken = shareToken(plan, 2);
  const missingAmount = plan.shares.find((s) => s.position === 2)!.amountMinor;
  await payShareAs(shareToken(plan, 0), organizer);
  await payShareAs(shareToken(plan, 1), participants[0]!);

  // Zaman ileri sarılır: katılımcı 2 süre sonuna kadar ödemedi.
  await prisma.splitPlan.update({
    where: { id: plan.id },
    data: { deadlineAt: new Date(Date.now() - 1000) },
  });
  const outcome = await processSplitDeadline(plan.id);
  check(outcome === "fallback", `süre sonu sonucu ${outcome}`);
  const after = (await getSplitPlan(cart.id, organizer.id))!;
  const expired = after.shares.find((s) => s.position === 2)!;
  const fallback = after.shares.find((s) => s.isFallback);
  check(expired.status === "EXPIRED", `ödemeyen pay ${expired.status}`);
  check(fallback && fallback.amountMinor === missingAmount, "yedek pay tutarı eşleşmiyor");
  const late = await expectRejects(
    payShareAs(missingToken, participants[1]!),
    { code: "SPLIT_DEADLINE_PASSED" },
    "süresi geçen pay"
  );
  const fb = await payShareAs(shareToken(after, fallback.position), organizer);
  check(fb.status === "confirmed", `yedek pay sonrası onay yok: ${fb.status}`);
  const done = await prisma.cart.findUniqueOrThrow({
    where: { id: cart.id },
    include: { bookings: true },
  });
  check(done.status === "CHECKED_OUT", `sepet durumu ${done.status}`);
  check(
    done.bookings.every((b) => b.status === "CONFIRMED"),
    "tüm rezervasyonlar CONFIRMED değil"
  );
  await cartBooks(cart.id, t);
  return {
    ok: true,
    detail:
      `3 pay; katılımcı 2 ödemedi → süre sonu "${outcome}", pay EXPIRED, ` +
      `organizatöre yedek pay ${fallback.amountMinor} minor; geç ödeme denemesi → ${late}; ` +
      `organizatör ödedi → ${done.bookings.length} rezervasyon CONFIRMED`,
    books: await assertBooks(t),
  };
}

// ---------------------------------------------------------------------------
// (b) Hasar talebi → admin kararı → depozito capture
// ---------------------------------------------------------------------------

async function scenarioDamageClaim(): Promise<V4Outcome> {
  const t = touched();
  const prisma = db();
  const stay = await demoStay("hasar");
  const guest = await demoUser("hasar-misafir");
  const admin = await demoUser("hasar-admin", "ADMIN", "Yönetici");
  const host = claimsOf(stay.hostId, "HOST");
  await setDepositSetting(host, stay.propertyId, { amountMinor: 30_000 });

  const { booking, payment } = await holdAndPay(guest.id, stay, 6);
  t.payments.add(payment.id);
  const b = await prisma.booking.findUniqueOrThrow({
    where: { id: booking.id },
    select: {
      checkIn: true,
      checkOut: true,
      property: { select: { timeZone: true, checkInTime: true, checkOutTime: true } },
    },
  });
  const w = depositWindow(b, b.property);
  const checkInAt = releaseAt(b.checkIn, b.property, 0);
  await sweepDeposits(new Date(w.authorizeAfter.getTime() + 60_000), { bookingIds: [booking.id] });
  const dep = await prisma.damageDeposit.findUniqueOrThrow({ where: { bookingId: booking.id } });
  check(dep.status === "AUTHORIZED", `depozito ${dep.status}`);

  const openedAt = new Date(checkInAt.getTime() + 2 * DAY);
  const claim = await openClaim(
    host,
    {
      bookingId: booking.id,
      type: "HOST_DAMAGE",
      amountMinor: 45_000,
      description: "Kırık sehpa ve halıda şarap lekesi",
    },
    openedAt
  );
  check(claim.status === "AWAITING_RESPONSE", `talep ${claim.status}`);
  const decidedAt = new Date(w.voidAfter.getTime() + 2 * 60_000);
  t.days.add(iso(decidedAt));
  const result = await decideClaim(
    claimsOf(admin.id, "ADMIN"),
    claim.id,
    { decision: "APPROVE", note: "Fotoğraflar hasarı doğruluyor" },
    decidedAt
  );
  check(result.status === "RESOLVED_APPROVED", `karar ${result.status}`);
  check(result.settledMinor === 30_000n, `tahsil edilen ${result.settledMinor}`);
  check(result.uncollectedMinor === 15_000n, `tahsil edilemeyen ${result.uncollectedMinor}`);
  const after = await prisma.damageDeposit.findUniqueOrThrow({ where: { id: dep.id } });
  check(after.status === "CAPTURED" && after.capturedMinor === 30_000n, `depozito ${after.status}`);
  t.deposits.add(dep.id);
  const journal = await prisma.journalEntry.count({
    where: { idempotencyKey: `deposit-captured:${dep.id}` },
  });
  check(journal === 1, "DEPOSIT_CAPTURED jurnali yok");
  return {
    ok: true,
    detail:
      `depozito 30000 minor ön provizyon (AUTHORIZED) → ev sahibi 45000 talep etti → ` +
      `admin APPROVE: ${result.settledMinor} capture (CAPTURED), ${result.uncollectedMinor} ` +
      `yalnız kayıt (defterde alacak yok); jurnal deposit-captured ✓`,
    books: await assertBooks(t),
  };
}

// ---------------------------------------------------------------------------
// (c) 7565 kaldırma → ilan pasif + SLA
// ---------------------------------------------------------------------------

async function scenarioTakedown(): Promise<V4Outcome> {
  const t = touched();
  const prisma = db();
  const stay = await demoStay("7565");
  const admin = await demoUser("7565-admin", "ADMIN", "Yönetici");
  const now = new Date();
  const req = await receiveTakedown(
    {
      source: "MINISTRY_7565",
      propertyId: stay.propertyId,
      reason: "Turizm amaçlı kiralama izin belgesi yok",
      referenceNo: `E-${RUN}`,
    },
    admin.id,
    now
  );
  check(req.status === "ACTIONED", `talep ${req.status}`);
  const slaHours = (req.slaDueAt.getTime() - req.receivedAt.getTime()) / HOUR;
  const property = await prisma.property.findUniqueOrThrow({ where: { id: stay.propertyId } });
  check(!property.isActive, "ilan pasif değil");
  const blocked = await expectRejects(
    updateProperty(claimsOf(stay.hostId, "HOST"), stay.propertyId, { isActive: true }),
    { status: 409, code: "TAKEDOWN_ACTIVE" },
    "ev sahibi yeniden yayın"
  );
  const early = await checkTakedownSla(req.id, new Date(now.getTime() + HOUR));
  check(early === "not_due", `SLA erken kontrol ${early}`);
  const onTime = await checkTakedownSla(req.id, new Date(now.getTime() + 25 * HOUR));
  check(onTime === "ok", `SLA sonucu ${onTime}`);

  // İhlal yolu: kuralı atlayan bir yol ilanı yeniden açmış olsun → SLA bitişinde aşım.
  const second = await receiveTakedown(
    { source: "MINISTRY_7565", propertyId: stay.propertyId, reason: "Tekrar uyarı" },
    admin.id,
    now
  );
  await prisma.property.update({ where: { id: stay.propertyId }, data: { isActive: true } });
  const breach = await checkTakedownSla(second.id, new Date(now.getTime() + 24 * HOUR + 1000));
  check(breach === "breached", `ihlal kontrolü ${breach}`);
  const forced = await prisma.property.findUniqueOrThrow({ where: { id: stay.propertyId } });
  check(!forced.isActive, "ihlal sonrası ilan zorla pasife alınmadı");
  const audit = await prisma.auditLog.count({
    where: { action: "takedown.sla_breach", entityId: stay.propertyId },
  });
  check(audit >= 1, "takedown.sla_breach denetim kaydı yok");
  return {
    ok: true,
    detail:
      `talep ACTIONED, SLA ${slaHours} saat, ilan pasif; ev sahibi yeniden yayın → ${blocked}; ` +
      `SLA +1s "${early}", +25s "${onTime}"; ilan dışarıdan açılınca +24s "${breach}" ` +
      `→ ilan zorla pasif + audit`,
    books: await assertBooks(t),
  };
}

// ---------------------------------------------------------------------------
// (d) Ajan mandate'li rezervasyon + mandate aşımı reddi
// ---------------------------------------------------------------------------

async function scenarioAgentMandate(): Promise<V4Outcome> {
  const t = touched();
  const prisma = db();
  const stay = await demoStay("ajan", { units: 3 });
  const user = await demoUser("ajan-kullanici");
  const session = async (start: number) =>
    (
      await createCheckoutSession(user.id, `demo-v4-acp-${RUN}-${++seq}`, {
        room_id: stay.roomIds[0]!,
        check_in: iso(utcDay(start)),
        check_out: iso(utcDay(start + 1)),
        guests: 1,
      })
    ).session;
  const totalOf = (s: Awaited<ReturnType<typeof session>>) =>
    s.totals.find((x) => x.type === "total")!.amount;

  const s1 = await session(12);
  const { mandate } = await signMandate(user.id, {
    maxAmountMinor: totalOf(s1),
    currency: s1.currency,
    propertyIds: [stay.propertyId],
  });
  const view = await completeCheckoutSession(
    user.id,
    s1.id,
    `demo-v4-acp-done-${RUN}`,
    { token: "spt_mock_ok", mandate },
    ctx()
  );
  check(view.status === "completed", `oturum ${view.status}`);
  const booking = await prisma.booking.findUniqueOrThrow({
    where: { id: view.order!.id },
    include: { payment: true },
  });
  check(booking.status === "CONFIRMED", `rezervasyon ${booking.status}`);
  t.payments.add(booking.payment!.id);

  // Aşım: mandate üst sınırı toplamdan 1 kuruş az → 402 + yeni mandate step-up'ı.
  const s2 = await session(15);
  const small = await signMandate(user.id, {
    maxAmountMinor: totalOf(s2) - 1,
    currency: s2.currency,
  });
  const over = await expectRejects(
    completeCheckoutSession(user.id, s2.id, `demo-v4-acp-over-${RUN}`, {
      token: "spt_mock_ok",
      mandate: small.mandate,
    }),
    { status: 402, code: "MANDATE_AMOUNT_EXCEEDED" },
    "mandate aşımı"
  );
  // Aynı mandate'in başka oturumda tekrarı → 409.
  const replay = await expectRejects(
    completeCheckoutSession(user.id, s2.id, `demo-v4-acp-replay-${RUN}`, {
      token: "spt_mock_ok",
      mandate,
    }),
    { status: 409, code: "MANDATE_REPLAYED" },
    "mandate tekrarı"
  );
  const s2row = await prisma.checkoutSession.findUniqueOrThrow({ where: { id: s2.id } });
  check(s2row.bookingId === null, "reddedilen oturumda rezervasyon açılmamalı");
  return {
    ok: true,
    detail:
      `mandate (üst sınır ${totalOf(s1)} ${s1.currency} minor, ilan kısıtlı) → ACP complete ` +
      `"${view.status}", rezervasyon CONFIRMED; aşan mandate → ${over}; ` +
      `tek kullanımlık mandate tekrarı → ${replay}; reddedilen oturumda rezervasyon yok`,
    books: await assertBooks(t),
  };
}

// ---------------------------------------------------------------------------
// (e) Devir capture hatası (v4#1)
// ---------------------------------------------------------------------------

/** Capture'da hata veren MockPsp: void/refund çağrılarını kaydeder. */
class FailingCapturePsp extends MockPsp {
  voids: string[] = [];
  override async capture(): Promise<never> {
    throw new Error("demo: PSP capture zaman aşımı");
  }
  override async void(ref?: string) {
    if (ref) this.voids.push(ref);
    return super.void();
  }
}

async function scenarioTransferCaptureFailure(): Promise<V4Outcome> {
  const t = touched();
  const prisma = db();
  const stay = await demoStay("devir");
  const seller = await demoUser("devir-satici");
  const buyer = await demoUser("devir-alici");
  const { booking, payment } = await holdAndPay(seller.id, stay, 20);
  t.payments.add(payment.id);
  const ask = Math.floor(booking.totalMinor * 0.8);

  const failing = new FailingCapturePsp();
  setPaymentProviderForTests(failing);
  let failure: string;
  const listed = await listBookingForTransfer(booking.id, seller.id, ask);
  try {
    failure = await expectRejects(
      claimTransfer({ token: listed.claimToken, buyerId: buyer.id, cardToken: card() }),
      { status: 502, code: "TRANSFER_PAYMENT_FAILED" },
      "capture hatalı devir"
    );
  } finally {
    setPaymentProviderForTests(new MockPsp());
  }
  const unchanged = await prisma.booking.findUniqueOrThrow({
    where: { id: booking.id },
    include: { payment: true },
  });
  check(unchanged.userId === seller.id, "sahiplik değişmemeliydi");
  check(unchanged.payment?.userId === seller.id, "ödeme satıcıda kalmalıydı");
  const failed = await prisma.bookingTransfer.findUniqueOrThrow({ where: { id: listed.id } });
  check(
    failed.status === "FAILED" && failed.failureCode === "CAPTURE_FAILED",
    `devir ${failed.status}/${failed.failureCode}`
  );
  check(failing.voids.includes(failed.buyerPaymentRef ?? "-"), "alıcı yetkisi void edilmedi");
  check((await prisma.payout.count({ where: { transferId: listed.id } })) === 0, "payout açıldı");

  // Aynı rezervasyon yeniden listelenir, sağlıklı PSP ile devir tamamlanır.
  const relisted = await listBookingForTransfer(booking.id, seller.id, ask);
  const ok = await claimTransfer({
    token: relisted.claimToken,
    buyerId: buyer.id,
    cardToken: card(),
  });
  check(ok.status === "COMPLETED", `ikinci devir ${ok.status}`);
  const owner = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
  check(owner.userId === buyer.id, "başarılı devirde sahiplik alıcıya geçmeliydi");
  t.transfers.add(relisted.id);
  return {
    ok: true,
    detail:
      `ilan ${ask} minor; capture hatası → ${failure}, devir FAILED/CAPTURE_FAILED, ` +
      `sahiplik+ödeme satıcıda, alıcı yetkisi void, payout 0; yeniden listeleme → ` +
      `sağlıklı PSP ile COMPLETED, sahiplik alıcıda`,
    books: await assertBooks(t),
  };
}

// ---------------------------------------------------------------------------

export const V4_SCENARIOS: V4Scenario[] = [
  {
    id: 8,
    key: "a1",
    title: "Grup sepeti 3 oda + bölünmüş ödeme (3 kişi hepsi öder) → onay",
    run: scenarioSplitAllPay,
  },
  {
    id: 9,
    key: "a2",
    title: "Bölünmüş ödeme: 1 kişi ödemez → organizatör yedek payı → onay",
    run: scenarioSplitFallback,
  },
  {
    id: 10,
    key: "b",
    title: "Hasar talebi → admin kararı → depozito capture",
    run: scenarioDamageClaim,
  },
  { id: 11, key: "c", title: "7565 kaldırma → ilan pasif + 24 saat SLA", run: scenarioTakedown },
  {
    id: 12,
    key: "d",
    title: "Ajan mandate'li rezervasyon + mandate aşımı reddi",
    run: scenarioAgentMandate,
  },
  {
    id: 13,
    key: "e",
    title: "Devir capture hatası (v4#1) → sahiplik değişmez",
    run: scenarioTransferCaptureFailure,
  },
];

/** Ortam kontrolü + MockPsp; hata varsa açıklayıcı mesaj döner. */
export function prepareV4(): string | null {
  if (!isDemoMode()) {
    return "v4 senaryoları veritabanına demo verisi yazar; yalnızca DEMO_MODE=true iken çalışır";
  }
  if (!process.env.DATABASE_URL || !process.env.REDIS_URL) {
    return "v4 senaryoları için DATABASE_URL ve REDIS_URL gerekli";
  }
  setPaymentProviderForTests(new MockPsp());
  return null;
}

export async function runV4Scenario(s: V4Scenario): Promise<V4Outcome> {
  try {
    return await s.run();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const kind = error instanceof ScenarioAssertion ? "assert" : "hata";
    return { ok: false, detail: `${kind}: ${msg}`, books: "—" };
  }
}

export async function closeV4(): Promise<void> {
  await retireDemoProperties().catch(() => undefined);
  await prismaClient?.$disconnect();
}
